import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ArrowLeft, ArrowRight, Baby, Camera, ImagePlus, MapPin, Search, Send, Sparkles, Trash2, UserPlus } from 'lucide-react'
import { Button } from '../../components/Button'
import { RequireRole, SignedInAs } from '../../components/RequireRole'
import { Notice, PageHeader, ProgressDots } from '../../components/ui'
import { StatusChip } from '../../components/CaseBits'
import { ColourPicker } from '../../components/CaseCard'
import { VoiceRecorder } from '../../components/VoiceRecorder'
import { AutofillSummary, AutofillWorking, ChoiceGroup, EMPTY_FIELDS, nameError, requestAutofill, TextField, useAutofillTracking, type AutofillResult } from '../../components/Autofill'
import { Chat } from '../../components/Chat'
import { ReunitedMoment } from '../../components/Reunited'
import type { PickedLocation } from '../../components/LocationPicker'
import { useI18n } from '../../i18n'
import { callFn, errorKey } from '../../lib/api'
import { compressImage, uploadMedia } from '../../lib/media'
import { supabase } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { CASE_COLUMNS, shortId, useLiveCase, type CaseRow } from '../../lib/useLiveCase'
import { useParentMatches } from '../../lib/useMatches'

const LocationPicker = lazy(() => import('../../components/LocationPicker').then((m) => ({ default: m.LocationPicker })))

type Child = { id: string; name: string; birth_year: number | null; gender: 'male' | 'female' | null; photo_path: string | null }

export default function Parent() {
  return (
    <RequireRole roles={['parent', 'finder', 'admin']} roleHint="parent">
      <ParentHome />
      <SignedInAs />
    </RequireRole>
  )
}

function ParentHome() {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const view = params.get('view') ?? 'home'
  const caseId = params.get('case')
  const childId = params.get('child')
  const go = (p: Record<string, string>) => {
    setParams(p)
    window.scrollTo({ top: 0 })
  }

  if (caseId) return <Tracker caseId={caseId} onBack={() => go({})} />
  if (view === 'report') return <LostReport childId={childId} onDone={(id) => go({ case: id })} />
  if (view === 'children') return <SavedChildren onReport={(id) => go({ view: 'report', child: id })} />

  return (
    <div className="space-y-6">
      <PageHeader title={t('parent.title')} lead={t('parent.lead')} />
      <div className="grid gap-3">
        <Button icon={<Search className="size-6" aria-hidden />} onClick={() => go({ view: 'report' })}>
          {t('parent.reportMissing')}
        </Button>
        <Button variant="secondary" icon={<Baby className="size-6" aria-hidden />} onClick={() => go({ view: 'children' })}>
          {t('parent.savedChildren')}
        </Button>
      </div>
      <MyCases onOpen={(id) => go({ case: id })} />
    </div>
  )
}

export function MyCases({ onOpen, kinds = ['lost', 'checkin'], limit = 20 }: { onOpen: (id: string) => void; kinds?: string[]; limit?: number }) {
  const { t } = useI18n()
  const { profile } = useSession()
  const [rows, setRows] = useState<CaseRow[] | null>(null)
  const key = kinds.join(',')

  const load = useCallback(async () => {
    if (!profile) return
    const { data } = await supabase
      .from('cases')
      .select(CASE_COLUMNS)
      .eq('reporter_id', profile.id)
      .in('kind', key.split(','))
      .order('created_at', { ascending: false })
      .limit(limit)
    setRows((data as CaseRow[]) ?? [])
  }, [profile, key, limit])

  useEffect(() => {
    void load()
    const ch = supabase
      .channel(`my-cases-${key}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cases' }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [load, key])

  if (!rows) return <div className="h-24 animate-pulse rounded-2xl bg-sand" />
  if (!rows.length) return <p className="text-ink-soft">{t('parent.noCases')}</p>
  return (
    <section>
      <h2 className="mb-3 text-xl font-bold">{t('parent.myReports')}</h2>
      <ul className="space-y-2">
        {rows.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onOpen(c.id)}
              className="flex min-h-16 w-full items-center gap-3 rounded-2xl border-2 border-sand-deep bg-sand p-3 text-start hover:bg-sand-deep"
            >
              <span className="flex-1">
                <span className="block font-bold">{c.child_name ?? (c.kind === 'found' ? t('geofence.child') : t('parent.yourChild'))} <span className="font-mono text-sm text-ink-soft" dir="ltr">#{shortId(c.id)}</span></span>
                <span className="text-sm text-ink-soft">{t(`parent.kind_${c.kind}`)} · {new Date(c.created_at).toLocaleString()}</span>
              </span>
              <ParentStatusChip status={c.status} kind={c.kind} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Parents see softer wording than staff, and never "matched" details beyond what R2 allows. */
function ParentStatusChip({ status, kind }: { status: string; kind: string }) {
  if (kind === 'checkin' && status === 'reported') {
    return <span className="rounded-full bg-sand-deep px-3 py-1 text-sm font-bold">✓</span>
  }
  return <StatusChip status={status} />
}

// ---------------- Lost report ----------------

type ReportStep = 'photo' | 'voice' | 'details' | 'where'
type DetailErrors = Partial<Record<'name' | 'father' | 'age' | 'gender', string>>

function LostReport({ childId, onDone }: { childId: string | null; onDone: (caseId: string) => void }) {
  const { t, dir } = useI18n()
  const [step, setStep] = useState<ReportStep>('photo')
  const [child, setChild] = useState<Child | null>(null)
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [father, setFather] = useState('')
  const [age, setAge] = useState('')
  const [gender, setGender] = useState<'male' | 'female' | null>(null)
  const [top, setTop] = useState<string | null>(null)
  const [bottom, setBottom] = useState<string | null>(null)
  const [garments, setGarments] = useState<{ top_type: string | null; bottom_type: string | null }>({ top_type: null, bottom_type: null })
  const [voice, setVoice] = useState<Blob | null>(null)
  const [where, setWhere] = useState<PickedLocation | null>(null)
  const [minutesAgo, setMinutesAgo] = useState<number>(15)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ai, setAi] = useState<AutofillResult | null>(null)
  const [analysing, setAnalysing] = useState(false)
  const [errs, setErrs] = useState<DetailErrors>({})
  const tracking = useAutofillTracking()
  const analysedFor = useRef<Blob | null>(null)
  const NextIcon = dir === 'rtl' ? ArrowLeft : ArrowRight
  const BackIcon = dir === 'rtl' ? ArrowRight : ArrowLeft
  const steps: ReportStep[] = ['photo', 'voice', 'details', 'where']

  // Upload the voice note once: autofill and the final submit share the same upload.
  const voiceUpload = useRef<{ blob: Blob; path: Promise<string> } | null>(null)
  const uploadVoice = useCallback((): Promise<string | null> => {
    if (!voice) return Promise.resolve(null)
    if (voiceUpload.current?.blob !== voice) voiceUpload.current = { blob: voice, path: uploadMedia('voice-notes', voice) }
    return voiceUpload.current.path
  }, [voice])

  useEffect(() => {
    if (!childId) return
    void supabase.from('children').select('*').eq('id', childId).maybeSingle().then(({ data }) => {
      if (!data) return
      const c = data as Child
      setChild(c)
      // From the saved profile: the parent already confirmed these, so the AI won't change them.
      setName(c.name)
      tracking.touch('child_name')
      if (c.gender) {
        setGender(c.gender)
        tracking.touch('gender')
      }
      if (c.birth_year) {
        setAge(String(new Date().getFullYear() - c.birth_year))
        tracking.touch('age_est')
      }
      if (c.photo_path) void supabase.storage.from('child-profiles').createSignedUrl(c.photo_path, 300).then((r) => setPhotoUrl(r.data?.signedUrl ?? null))
    })
  }, [childId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!photo) return
    const u = URL.createObjectURL(photo)
    setPhotoUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [photo])

  const goStep = (s: ReportStep) => {
    setError(null)
    setStep(s)
    window.scrollTo({ top: 0 })
  }

  async function analyse() {
    setError(null)
    if (!voice) return goStep('details')
    if (analysedFor.current === voice) return goStep('details')
    setAnalysing(true)
    try {
      const r = await requestAutofill({ voicePath: await uploadVoice(), text: '', kind: 'lost' })
      if (r.ai_status === 'no_speech') {
        setVoice(null)
        return setError('autofill.noSpeech')
      }
      const f = r.fields
      tracking.apply(
        { child_name: f.child_name, father_name: f.father_name, age_est: f.age_est, gender: f.gender, top_color: f.top_color, bottom_color: f.bottom_color },
        (k, v) => {
          if (k === 'child_name') setName((v as string) ?? '')
          if (k === 'father_name') setFather((v as string) ?? '')
          if (k === 'age_est') setAge(v === null ? '' : String(v))
          if (k === 'gender') setGender(v as 'male' | 'female' | null)
          if (k === 'top_color') setTop(v as string | null)
          if (k === 'bottom_color') setBottom(v as string | null)
        },
      )
      setGarments({ top_type: f.top_type, bottom_type: f.bottom_type })
      setAi(r)
      analysedFor.current = voice
      goStep('details')
    } catch (e) {
      const k = errorKey(e)
      if (k === 'errors.bad_media_path') {
        setVoice(null)
        return setError(k)
      }
      setAi({ ai_status: 'failed', text: null, summary_en: null, summary_ur: null, fields: EMPTY_FIELDS, reason: null })
      goStep('details')
    } finally {
      setAnalysing(false)
    }
  }

  function confirmDetails() {
    const e: DetailErrors = {}
    if (!name.trim()) e.name = 'autofill.needName'
    else {
      const n = nameError(name)
      if (n) e.name = n
    }
    const fa = nameError(father)
    if (fa) e.father = fa
    const a = age === '' ? NaN : Number(age)
    if (!Number.isInteger(a) || a < 0 || a > 17) e.age = 'autofill.needAgeNumber'
    if (!gender) e.gender = 'autofill.needGender'
    setErrs(e)
    if (Object.keys(e).length) return
    goStep('where')
  }

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const [photo_path, voice_path] = await Promise.all([photo ? uploadMedia('case-photos', photo) : null, uploadVoice()])
      const r = await callFn<{ case: { id: string } }>('create-case', {
        kind: 'lost',
        fields: {
          child_id: child?.id,
          child_name: name.trim(),
          father_name: father.trim() || null,
          age_est: age === '' ? null : Number(age),
          gender,
          top_color: top,
          top_type: top ? garments.top_type : null,
          bottom_color: bottom,
          bottom_type: bottom ? garments.bottom_type : null,
          photo_path,
          voice_path,
          lat: where?.lat,
          lng: where?.lng,
          minutes_ago: minutesAgo,
        },
      })
      onDone(r.case.id)
    } catch (e) {
      setError(errorKey(e))
    } finally {
      setBusy(false)
    }
  }

  const back = (s: ReportStep) => (
    <button type="button" onClick={() => goStep(s)} className="inline-flex min-h-11 items-center gap-2 font-semibold">
      <BackIcon className="size-5" aria-hidden /> {t('common.back')}
    </button>
  )
  const aiHas = (f: string) => tracking.aiFilled.has(f)
  const clear = (k: keyof DetailErrors) => setErrs((x) => (x[k] ? { ...x, [k]: undefined } : x))

  return (
    <div className="space-y-5">
      <ProgressDots total={steps.length} current={steps.indexOf(step) + 1} />

      {step === 'photo' && (
        <>
          <PageHeader title={t('parent.report.photoTitle')} lead={t('parent.report.photoLead')} />
          {photoUrl && <img src={photoUrl} alt="" className="aspect-[3/4] w-full rounded-2xl border border-sand-deep object-cover" />}
          <label className="flex min-h-14 cursor-pointer items-center justify-center gap-3 rounded-2xl border-2 border-sand-deep bg-sand text-lg font-bold hover:bg-sand-deep">
            <ImagePlus className="size-6" aria-hidden />
            {photoUrl ? t('parent.report.changePhoto') : t('parent.report.fromGallery')}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (!f) return
                if (!f.type.startsWith('image/')) return setError('autofill.notImage')
                setError(null)
                void compressImage(f).then(setPhoto).catch(() => setError('autofill.notImage'))
              }}
            />
          </label>
          {error && <Notice tone="danger">{t(error)}</Notice>}
          <Button icon={<NextIcon className="size-6" aria-hidden />} onClick={() => goStep('voice')}>
            {photoUrl ? t('common.next') : t('parent.report.noPhoto')}
          </Button>
        </>
      )}

      {step === 'voice' && (
        <>
          <PageHeader title={t('parent.report.voiceTitle')} lead={t('parent.report.voiceLead')} />
          <VoiceRecorder value={voice} onChange={setVoice} />
          {error && <Notice tone="danger">{t(error)}</Notice>}
          {analysing ? (
            <AutofillWorking />
          ) : voice ? (
            <Button icon={<Sparkles className="size-6" aria-hidden />} onClick={() => void analyse()}>
              {t('autofill.fillForm')}
            </Button>
          ) : (
            <Button variant="secondary" icon={<NextIcon className="size-6" aria-hidden />} onClick={() => void analyse()}>
              {t('autofill.fillMyself')}
            </Button>
          )}
          {!analysing && back('photo')}
        </>
      )}

      {step === 'details' && (
        <>
          <PageHeader title={t('autofill.reviewTitle')} lead={ai?.summary_en ? t('autofill.reviewLead') : undefined} />
          <AutofillSummary result={ai} />
          <TextField
            label={t('card.name')}
            required
            value={name}
            ai={aiHas('child_name')}
            error={errs.name}
            onChange={(v) => {
              setName(v)
              tracking.touch('child_name')
              clear('name')
            }}
          />
          <TextField
            label={t('card.father')}
            value={father}
            ai={aiHas('father_name')}
            error={errs.father}
            hint={t('autofill.optional')}
            onChange={(v) => {
              setFather(v)
              tracking.touch('father_name')
              clear('father')
            }}
          />
          <TextField
            label={t('card.age')}
            required
            numeric
            value={age}
            ai={aiHas('age_est')}
            error={errs.age}
            onChange={(v) => {
              setAge(v)
              tracking.touch('age_est')
              clear('age')
            }}
          />
          <ChoiceGroup legend={t('finder.about.gender')} ai={aiHas('gender')} error={errs.gender}>
            <div className="grid grid-cols-2 gap-3">
              {(['male', 'female'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={gender === g}
                  onClick={() => {
                    setGender(g)
                    tracking.touch('gender')
                    clear('gender')
                  }}
                  className={`min-h-14 rounded-2xl border-2 text-lg font-bold ${gender === g ? 'border-terracotta bg-terracotta text-white' : 'border-sand-deep bg-sand'}`}
                >
                  {t(`finder.about.${g}`)}
                </button>
              ))}
            </div>
          </ChoiceGroup>
          <ColourPicker
            label={t('parent.report.topColour')}
            value={top}
            ai={aiHas('top_color')}
            onChange={(c) => {
              setTop(c)
              tracking.touch('top_color')
            }}
          />
          <ColourPicker
            label={t('parent.report.bottomColour')}
            value={bottom}
            ai={aiHas('bottom_color')}
            onChange={(c) => {
              setBottom(c)
              tracking.touch('bottom_color')
            }}
          />
          {Object.values(errs).some(Boolean) && <Notice tone="danger">{t('autofill.fixErrors')}</Notice>}
          <Button icon={<NextIcon className="size-6" aria-hidden />} onClick={confirmDetails}>
            {t('autofill.looksRight')}
          </Button>
          {back('voice')}
        </>
      )}

      {step === 'where' && (
        <>
          <PageHeader title={t('parent.report.whereTitle')} />
          <Suspense fallback={<div className="h-[50vh] min-h-72 animate-pulse rounded-2xl bg-sand" />}>
            <LocationPicker value={where} onChange={setWhere} />
          </Suspense>
          <fieldset>
            <legend className="mb-2 font-bold">{t('parent.report.howLong')}</legend>
            <div className="flex flex-wrap gap-2">
              {[5, 15, 30, 60, 120].map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={minutesAgo === m}
                  onClick={() => setMinutesAgo(m)}
                  className={`min-h-12 rounded-full border-2 px-4 font-bold ${minutesAgo === m ? 'border-ink bg-ink text-cream' : 'border-sand-deep bg-white'}`}
                >
                  {m < 60 ? t('parent.report.minAgo', { n: m }) : t('parent.report.hourAgo', { n: m / 60 })}
                </button>
              ))}
            </div>
          </fieldset>
          {error && <Notice tone="danger">{t(error)}</Notice>}
          <Button busy={busy} icon={<Send className="size-6" aria-hidden />} onClick={() => void submit()}>
            {t('parent.report.send')}
          </Button>
          <p className="text-ink-soft">{t('parent.report.privacy')}</p>
          {!busy && back('details')}
        </>
      )}
    </div>
  )
}

// ---------------- Status tracker ----------------

const LADDER = ['searching', 'possible', 'confirmed', 'goto', 'reunited'] as const

function Tracker({ caseId, onBack }: { caseId: string; onBack: () => void }) {
  const { t, lang, dir } = useI18n()
  const live = useLiveCase(caseId)
  const { rows } = useParentMatches([caseId])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const BackIcon = dir === 'rtl' ? ArrowRight : ArrowLeft
  const m = rows.find((r) => r.match_status !== 'blocked') ?? rows[0]

  if (!live) return <div className="h-40 animate-pulse rounded-2xl bg-sand" aria-label={t('common.loading')} />

  const s = live.status
  const stage =
    s === 'reunited' ? 4 : m?.match_status === 'finder_confirmed' || s === 'verifying' ? 3 : s === 'finder_confirmed' ? 2 : s === 'matched' ? 1 : 0
  const spName = m ? (lang === 'ur' ? m.safe_point_name_ur ?? m.safe_point_name_en : m.safe_point_name_en) : null

  async function convert() {
    setBusy(true)
    setError(null)
    try {
      await callFn('case-transition', { case_id: caseId, event: 'convert_to_lost' })
    } catch (e) {
      setError(errorKey(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2 font-semibold">
        <BackIcon className="size-5" aria-hidden /> {t('parent.allReports')}
      </button>
      <PageHeader title={live.child_name ?? t('parent.yourChild')} lead={`#${shortId(caseId)} · ${t(`parent.kind_${live.kind}`)}`} />

      {live.kind === 'checkin' && s === 'reported' ? (
        <section className="space-y-4">
          <Notice>{t('checkin.active', { time: live.expires_at ? new Date(live.expires_at).toLocaleString() : '48h' })}</Notice>
          <p className="font-semibold">{t('checkin.wristReminder')}</p>
          <Button variant="danger" busy={busy} onClick={() => void convert()}>{t('checkin.lostNow')}</Button>
          {error && <Notice tone="danger">{t(error)}</Notice>}
        </section>
      ) : s === 'reunited' && m?.reunited_at ? (
        <ReunitedMoment fromIso={m.found_at} toIso={m.reunited_at} />
      ) : s === 'handover_blocked' ? (
        <Notice tone="danger">{t('parent.blocked')}</Notice>
      ) : s === 'expired' ? (
        <Notice>{t('parent.expired')}</Notice>
      ) : (
        <>
          <ol className="space-y-2" aria-label={t('parent.progress')}>
            {LADDER.map((k, i) => (
              <li key={k} className={`flex items-center gap-3 rounded-xl p-3 ${i === stage ? 'bg-terracotta text-white' : i < stage ? 'bg-sand' : 'border-2 border-dashed border-sand-deep text-ink-soft'}`}>
                <span className={`grid size-8 place-items-center rounded-full text-sm font-bold ${i <= stage ? 'bg-white/90 text-ink' : 'bg-sand-deep'}`}>{i + 1}</span>
                <span className="font-bold">
                  {k === 'goto' && spName ? t('parent.ladder.gotoPlace', { place: spName }) : t(`parent.ladder.${k}`)}
                </span>
              </li>
            ))}
          </ol>
          {s === 'escalated_police' && <Notice tone="danger">{t('parent.escalated')}</Notice>}
          {stage === 1 && <Notice>{t('parent.possibleExplain')}</Notice>}
          {stage >= 3 && spName && m?.safe_point_lat != null && (
            <a
              className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-terracotta text-lg font-bold text-white"
              href={`https://www.openstreetmap.org/?mlat=${m.safe_point_lat}&mlon=${m.safe_point_lng}#map=18/${m.safe_point_lat}/${m.safe_point_lng}`}
              target="_blank"
              rel="noreferrer"
            >
              <MapPin className="size-6" aria-hidden /> {t('parent.openMap', { place: spName })}
            </a>
          )}
          {stage >= 3 && <Notice>{t('parent.bringId')}</Notice>}
          {m && m.match_status === 'finder_confirmed' && <Chat matchId={m.match_id} />}
          <p className="text-sm text-ink-soft">{t('parent.privacyNote')}</p>
        </>
      )}
    </div>
  )
}

// ---------------- Saved children (F1) ----------------

function SavedChildren({ onReport }: { onReport: (childId: string) => void }) {
  const { t } = useI18n()
  const { profile } = useSession()
  const [list, setList] = useState<Child[] | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('children').select('id,name,birth_year,gender,photo_path').order('created_at')
    setList((data as Child[]) ?? [])
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  async function remove(c: Child) {
    if (!window.confirm(t('children.confirmDelete', { name: c.name }))) return
    if (c.photo_path) await supabase.storage.from('child-profiles').remove([c.photo_path])
    await supabase.from('children').delete().eq('id', c.id)
    void load()
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t('children.title')} lead={t('children.lead')} />
      <Notice>{t('checkin.wristReminder')}</Notice>
      {list === null && <div className="h-24 animate-pulse rounded-2xl bg-sand" />}
      {list?.length === 0 && !adding && <p className="text-ink-soft">{t('children.none')}</p>}
      <ul className="space-y-3">
        {list?.map((c) => (
          <li key={c.id} className="flex items-center gap-3 rounded-2xl border-2 border-sand-deep bg-sand p-3">
            <ChildThumb path={c.photo_path} />
            <div className="flex-1">
              <p className="text-lg font-bold">{c.name}</p>
              <p className="text-sm text-ink-soft">
                {[c.gender && t(`finder.about.${c.gender}`), c.birth_year && t('sp.age', { n: new Date().getFullYear() - c.birth_year })].filter(Boolean).join(' · ')}
              </p>
            </div>
            <button type="button" onClick={() => onReport(c.id)} className="min-h-11 rounded-full bg-terracotta px-4 font-bold text-white">
              {t('children.reportMissing')}
            </button>
            <button type="button" onClick={() => void remove(c)} aria-label={t('children.delete')} className="grid size-11 place-items-center rounded-full hover:bg-sand-deep">
              <Trash2 className="size-5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {adding && profile ? (
        <AddChild parentId={profile.id} onDone={() => { setAdding(false); void load() }} />
      ) : (
        <Button variant="secondary" icon={<UserPlus className="size-6" aria-hidden />} onClick={() => setAdding(true)}>
          {t('children.add')}
        </Button>
      )}
    </div>
  )
}

function ChildThumb({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!path) return
    void supabase.storage.from('child-profiles').createSignedUrl(path, 300).then((r) => setUrl(r.data?.signedUrl ?? null))
  }, [path])
  return url ? <img src={url} alt="" className="size-16 rounded-xl object-cover" /> : <div className="grid size-16 place-items-center rounded-xl bg-sand-deep"><Baby className="size-7 text-ink-soft" aria-hidden /></div>
}

function AddChild({ parentId, onDone }: { parentId: string; onDone: () => void }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [year, setYear] = useState('')
  const [gender, setGender] = useState<'male' | 'female' | null>(null)
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const thisYear = new Date().getFullYear()
  async function save() {
    const n = name.trim() ? nameError(name) : 'autofill.needName'
    if (n) return setError(n)
    if (year && (Number(year) < thisYear - 17 || Number(year) > thisYear)) return setError('autofill.badYear')
    setBusy(true)
    setError(null)
    try {
      const photo_path = photo ? await uploadMedia('child-profiles', photo) : null
      const { error: e } = await supabase.from('children').insert({
        parent_id: parentId,
        name: name.trim(),
        birth_year: year ? Number(year) : null,
        gender,
        photo_path,
        consent_at: new Date().toISOString(),
      })
      if (e) throw e
      onDone()
    } catch (e) {
      setError(errorKey(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border-2 border-sand-deep p-4">
      <h2 className="text-lg font-extrabold">{t('children.add')}</h2>
      <label className="flex min-h-14 cursor-pointer items-center justify-center gap-3 rounded-2xl border-2 border-sand-deep bg-sand font-bold">
        <Camera className="size-6" aria-hidden />
        {photo ? t('children.photoAdded') : t('children.addPhoto')}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (!f) return
            if (!f.type.startsWith('image/')) return setError('autofill.notImage')
            void compressImage(f).then(setPhoto).catch(() => setError('autofill.notImage'))
          }}
        />
      </label>
      <TextField label={t('card.name')} required value={name} onChange={setName} />
      <TextField label={t('children.birthYear')} value={year} onChange={setYear} numeric={4} hint={t('autofill.yearHint', { a: thisYear - 17, b: thisYear })} />
      <div className="grid grid-cols-2 gap-3">
        {(['male', 'female'] as const).map((g) => (
          <button key={g} type="button" aria-pressed={gender === g} onClick={() => setGender(g)} className={`min-h-12 rounded-2xl border-2 font-bold ${gender === g ? 'border-ink bg-ink text-cream' : 'border-sand-deep'}`}>
            {t(`finder.about.${g}`)}
          </button>
        ))}
      </div>
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 size-6 accent-[var(--brand-ink)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{t('children.consent')}</span>
      </label>
      {error && <Notice tone="danger">{t(error)}</Notice>}
      <Button busy={busy} disabled={!consent || !name.trim()} onClick={() => void save()}>{t('children.save')}</Button>
    </section>
  )
}

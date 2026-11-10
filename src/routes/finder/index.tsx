import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CircleCheck, Footprints, Hand, Keyboard, MapPin, Send, ShieldCheck } from 'lucide-react'
import { Button } from '../../components/Button'
import { PhotoCapture } from '../../components/PhotoCapture'
import { VoiceRecorder } from '../../components/VoiceRecorder'
import { RequireRole, SignedInAs } from '../../components/RequireRole'
import { Notice, PageHeader, ProgressDots } from '../../components/ui'
import type { PickedLocation } from '../../components/LocationPicker'
import { useI18n } from '../../i18n'
import { callFn, errorKey } from '../../lib/api'
import { compressImage, uploadMedia } from '../../lib/media'
import { nearestSafePoints, walkingMinutes } from '../../lib/geo'
import { useSafePoints } from '../../lib/useSafePoints'
import { shortId, useLiveCase } from '../../lib/useLiveCase'
import { CaseCard } from '../../components/CaseCard'
import { MatchReview } from '../../components/MatchReview'
import { Chat } from '../../components/Chat'
import { ReunitedMoment } from '../../components/Reunited'
import { useFinderMatches } from '../../lib/useMatches'

const LocationPicker = lazy(() => import('../../components/LocationPicker').then((m) => ({ default: m.LocationPicker })))

type Step = 'photo' | 'about' | 'voice' | 'location' | 'card' | 'safepoint' | 'handover'
const DOTS: Step[] = ['photo', 'about', 'voice', 'location', 'card', 'safepoint']
const ACTIVE_CASE_KEY = 'wapsi.finder.activeCase'

type Gender = 'male' | 'female' | null
type AgeBand = 'under4' | '4to8' | '9plus' | null
const AGE_FOR_BAND: Record<Exclude<AgeBand, null>, number | null> = { under4: 3, '4to8': 6, '9plus': 10 }

function readActiveCase(): string | null {
  try {
    return localStorage.getItem(ACTIVE_CASE_KEY)
  } catch {
    return null
  }
}
function writeActiveCase(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_CASE_KEY, id)
    else localStorage.removeItem(ACTIVE_CASE_KEY)
  } catch {
    /* ignore */
  }
}

export default function Finder() {
  return (
    <RequireRole roles={['finder', 'parent', 'sp_staff', 'admin']} roleHint="finder">
      <FinderFlow />
      <SignedInAs />
    </RequireRole>
  )
}

function FinderFlow() {
  const { t, dir } = useI18n()
  const [caseId, setCaseId] = useState<string | null>(readActiveCase)
  const [step, setStep] = useState<Step>(caseId ? 'handover' : 'photo')

  const [photo, setPhoto] = useState<Blob | null>(null)
  const [gender, setGender] = useState<Gender>(null)
  const [ageBand, setAgeBand] = useState<AgeBand>(null)
  const [voice, setVoice] = useState<Blob | null>(null)
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState('')
  const [location, setLocation] = useState<PickedLocation | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Uploads start the moment media is captured, so "Send" only waits for whatever is left.
  const uploads = useRef<Record<'photo' | 'voice', Promise<string> | null>>({ photo: null, voice: null })

  const onPhoto = useCallback((f: File | null) => {
    if (!f) return
    void compressImage(f).then((b) => {
      setPhoto(b)
      uploads.current.photo = uploadMedia('case-photos', b)
      uploads.current.photo.catch(() => {}) // surfaced on submit
    })
  }, [])
  const onVoice = useCallback((b: Blob | null) => {
    setVoice(b)
    uploads.current.voice = b ? uploadMedia('voice-notes', b) : null
    uploads.current.voice?.catch(() => {})
  }, [])

  const BackIcon = dir === 'rtl' ? ArrowRight : ArrowLeft
  const NextIcon = dir === 'rtl' ? ArrowLeft : ArrowRight
  const go = (s: Step) => {
    setError(null)
    setStep(s)
    window.scrollTo({ top: 0 })
  }

  async function submit() {
    if (!location) return
    setBusy(true)
    setError(null)
    try {
      const [photo_path, voice_path] = await Promise.all([uploads.current.photo, uploads.current.voice])
      const { case: c } = await callFn<{ case: { id: string } }>('create-case', {
        kind: 'found',
        fields: {
          gender,
          under_4: ageBand === 'under4',
          age_est: ageBand ? AGE_FOR_BAND[ageBand] : null,
          typed_text: text,
          photo_path,
          voice_path,
          lat: location.lat,
          lng: location.lng,
          location_approx: location.approx,
        },
      })
      setCaseId(c.id)
      writeActiveCase(c.id)
      go('card')
    } catch (e) {
      setError(errorKey(e))
    } finally {
      setBusy(false)
    }
  }

  function startOver() {
    writeActiveCase(null)
    setCaseId(null)
    setPhoto(null)
    setGender(null)
    setAgeBand(null)
    setVoice(null)
    setText('')
    setTyping(false)
    setLocation(null)
    uploads.current = { photo: null, voice: null }
    go('photo')
  }

  const dotIndex = DOTS.indexOf(step)
  const back = (s: Step) => (
    <button type="button" onClick={() => go(s)} className="inline-flex min-h-11 items-center gap-2 font-semibold">
      <BackIcon className="size-5" aria-hidden /> {t('common.back')}
    </button>
  )

  return (
    <div>
      {dotIndex >= 0 && <ProgressDots total={DOTS.length} current={dotIndex + 1} />}

      {step === 'photo' && (
        <section className="space-y-5">
          <PageHeader title={t('finder.photo.title')} lead={t('finder.photo.lead')} />
          <PhotoCapture value={photo} onChange={onPhoto} label={t('finder.photo.take')} />
          {photo && (
            <Button icon={<NextIcon className="size-6" aria-hidden />} onClick={() => go('about')}>
              {t('common.next')}
            </Button>
          )}
        </section>
      )}

      {step === 'about' && (
        <section className="space-y-6">
          <PageHeader title={t('finder.about.title')} />
          <fieldset>
            <legend className="mb-3 text-lg font-bold">{t('finder.about.gender')}</legend>
            <div className="grid grid-cols-2 gap-3">
              {(['male', 'female'] as const).map((g) => (
                <Choice key={g} selected={gender === g} onClick={() => setGender(gender === g ? null : g)}>
                  {t(`finder.about.${g}`)}
                </Choice>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-3 text-lg font-bold">{t('finder.about.age')}</legend>
            <div className="grid grid-cols-3 gap-3">
              {(['under4', '4to8', '9plus'] as const).map((a) => (
                <Choice key={a} selected={ageBand === a} onClick={() => setAgeBand(ageBand === a ? null : a)}>
                  {t(`finder.about.age_${a}`)}
                </Choice>
              ))}
            </div>
          </fieldset>
          {gender === 'female' && <Notice>{t('finder.about.girlNote', { desk: t('brand.womenDesk') })}</Notice>}
          {ageBand === 'under4' && <Notice>{t('finder.about.under4Note')}</Notice>}
          <Button icon={<NextIcon className="size-6" aria-hidden />} onClick={() => go('voice')}>
            {t('common.next')}
          </Button>
          {back('photo')}
        </section>
      )}

      {step === 'voice' && (
        <section className="space-y-6">
          <PageHeader title={t('finder.voice.title')} lead={t('finder.voice.lead')} />
          {!typing ? (
            <VoiceRecorder value={voice} onChange={onVoice} />
          ) : (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder={t('finder.voice.typePlaceholder')}
              className="w-full rounded-2xl border-2 border-sand-deep bg-white p-4 text-lg outline-none focus:border-terracotta"
              autoFocus
            />
          )}
          <button
            type="button"
            onClick={() => setTyping((v) => !v)}
            className="inline-flex min-h-11 items-center gap-2 font-semibold underline-offset-4 hover:underline"
          >
            <Keyboard className="size-5" aria-hidden />
            {typing ? t('finder.voice.recordInstead') : t('finder.voice.typeInstead')}
          </button>
          <Button icon={<NextIcon className="size-6" aria-hidden />} onClick={() => go('location')}>
            {voice || text.trim() ? t('common.next') : t('finder.voice.skip')}
          </Button>
          {back('about')}
        </section>
      )}

      {step === 'location' && (
        <section className="space-y-5">
          <PageHeader title={t('finder.location.title')} />
          <Suspense fallback={<div className="h-[50vh] min-h-72 animate-pulse rounded-2xl bg-sand" />}>
            <LocationPicker value={location} onChange={setLocation} />
          </Suspense>
          {error && <Notice tone="danger">{t(error)}</Notice>}
          <Button busy={busy} disabled={!location} icon={<Send className="size-6" aria-hidden />} onClick={() => void submit()}>
            {t('finder.location.send')}
          </Button>
          <p className="text-ink-soft">{t('finder.location.privacy')}</p>
          {!busy && back('voice')}
        </section>
      )}

      {step === 'card' && caseId && <CardStep caseId={caseId} onNext={() => go('safepoint')} />}

      {step === 'safepoint' && caseId && (
        <ChooseSafePoint caseId={caseId} gender={gender} from={location} onChosen={() => go('handover')} />
      )}

      {step === 'handover' && caseId && <Handover caseId={caseId} onDone={startOver} onChoose={() => go('safepoint')} />}
    </div>
  )
}

function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`min-h-16 rounded-2xl border-2 px-3 text-lg font-bold transition-colors ${
        selected ? 'border-terracotta bg-terracotta text-white' : 'border-sand-deep bg-sand hover:bg-sand-deep'
      }`}
    >
      {children}
    </button>
  )
}

function ChooseSafePoint({
  caseId,
  gender,
  from,
  onChosen,
}: {
  caseId: string
  gender: Gender
  from: PickedLocation | null
  onChosen: () => void
}) {
  const { t, lang } = useI18n()
  const { state } = useSafePoints()
  const live = useLiveCase(caseId)
  const g = gender ?? live?.gender ?? null
  const origin = from ?? (live?.lat != null && live?.lng != null ? { lat: live.lat, lng: live.lng } : null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const options = useMemo(
    () => (state.status === 'ready' && origin ? nearestSafePoints(state.points, origin, g, 3) : []),
    [state, origin, g],
  )

  async function choose(id: string) {
    setBusyId(id)
    setError(null)
    try {
      await callFn('case-transition', { case_id: caseId, event: 'safe_point_chosen', safe_point_id: id })
      onChosen()
    } catch (e) {
      setError(errorKey(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="space-y-5">
      <Notice>
        <span className="flex items-center gap-3">
          <ShieldCheck className="size-6 shrink-0 text-reunited" aria-hidden />
          {t('finder.safepoint.reported', { id: shortId(caseId) })}
        </span>
      </Notice>
      <PageHeader title={t('finder.safepoint.title')} lead={g === 'female' ? t('finder.safepoint.girlsOnly', { desk: t('brand.womenDesk') }) : undefined} />
      {state.status === 'loading' && <div className="h-40 animate-pulse rounded-2xl bg-sand" />}
      {state.status === 'error' && <Notice tone="danger">{t('admin.loadError')}</Notice>}
      {state.status === 'ready' && options.length === 0 && <Notice tone="danger">{t('finder.safepoint.none')}</Notice>}
      <ul className="space-y-3">
        {options.map((p, i) => (
          <li key={p.id} className="rounded-2xl border-2 border-sand-deep bg-sand p-4">
            <p className="text-xl font-bold">{lang === 'ur' && p.name_ur ? p.name_ur : p.name_en}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-soft">
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-4" aria-hidden />
                {p.distance_m < 1000 ? `${Math.round(p.distance_m)} m` : `${(p.distance_m / 1000).toFixed(1)} km`}
              </span>
              <span className="inline-flex items-center gap-1">
                <Footprints className="size-4" aria-hidden />
                {t('finder.safepoint.walk', { n: walkingMinutes(p.distance_m) })}
              </span>
              {p.women_staff && <span className="font-semibold text-ink">♀ {t('brand.womenDesk')}</span>}
            </p>
            <Button
              className="mt-3"
              variant={i === 0 ? 'primary' : 'secondary'}
              busy={busyId === p.id}
              disabled={!!busyId}
              onClick={() => void choose(p.id)}
            >
              {t('finder.safepoint.takeHere')}
            </Button>
          </li>
        ))}
      </ul>
      {error && <Notice tone="danger">{t(error)}</Notice>}
    </section>
  )
}

function CardStep({ caseId, onNext }: { caseId: string; onNext: () => void }) {
  const { t, dir } = useI18n()
  const live = useLiveCase(caseId)
  const NextIcon = dir === 'rtl' ? ArrowLeft : ArrowRight
  return (
    <section className="space-y-5">
      <Notice>
        <span className="flex items-center gap-3">
          <ShieldCheck className="size-6 shrink-0 text-ink" aria-hidden />
          {t('finder.safepoint.reported', { id: shortId(caseId) })}
        </span>
      </Notice>
      <PageHeader title={t('finder.card.title')} lead={t('finder.card.lead')} />
      {live ? <CaseCard c={live} /> : <div className="h-40 animate-pulse rounded-2xl bg-sand" />}
      <Button icon={<NextIcon className="size-6" aria-hidden />} onClick={onNext}>
        {t('finder.card.next')}
      </Button>
    </section>
  )
}

function Handover({ caseId, onDone, onChoose }: { caseId: string; onDone: () => void; onChoose: () => void }) {
  const { t, lang } = useI18n()
  const live = useLiveCase(caseId)
  const { state } = useSafePoints()
  const { rows: matches, reload } = useFinderMatches([caseId])
  const sp = state.status === 'ready' ? state.points.find((p) => p.id === live?.safe_point_id) : undefined
  const spName = sp ? (lang === 'ur' && sp.name_ur ? sp.name_ur : sp.name_en) : '…'
  const under4 = live?.flags?.includes('under_4')

  // A resumed case that never got a safe point goes back to choosing one.
  useEffect(() => {
    if (live && live.status === 'reported' && !live.safe_point_id) onChoose()
  }, [live, onChoose])

  if (!live) return <div className="h-40 animate-pulse rounded-2xl bg-sand" aria-label={t('common.loading')} />

  const s = live.status
  const suggested = matches.find((m) => m.match_status === 'suggested')
  const confirmed = matches.find((m) => m.match_status === 'finder_confirmed' || m.match_status === 'reunited')

  if (s === 'reunited' && live.reunited_at) {
    return (
      <section className="space-y-5">
        <ReunitedMoment fromIso={live.created_at} toIso={live.reunited_at} />
        <p className="text-center text-ink-soft">{t('finder.handover.reunitedThanks')}</p>
        <Button variant="secondary" onClick={onDone}>{t('finder.handover.newReport')}</Button>
      </section>
    )
  }

  if (s === 'handover_blocked') {
    return (
      <section className="space-y-5">
        <Notice tone="danger">{t('finder.handover.blocked')}</Notice>
        <Button variant="secondary" onClick={onDone}>{t('finder.handover.newReport')}</Button>
      </section>
    )
  }

  if (s === 'reported' || s === 'awaiting_safe_point') {
    return (
      <section className="space-y-5">
        <PageHeader title={t('finder.handover.walkTitle', { place: spName })} lead={t('finder.handover.walkLead')} />
        <div className="flex items-center gap-4 rounded-2xl border-2 border-sand-deep bg-sand p-5">
          <Hand className="size-10 shrink-0 text-terracotta" aria-hidden />
          <p className="text-lg font-semibold">{t('finder.handover.waiting', { id: shortId(caseId) })}</p>
        </div>
        {under4 && <Notice>{t('finder.about.under4Note')}</Notice>}
        <p className="text-ink-soft">{t('finder.handover.policeInformed')}</p>
        <CaseCard c={live} />
      </section>
    )
  }

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-4 rounded-2xl bg-sand p-4">
        <CircleCheck className="size-10 shrink-0 text-ink" aria-hidden />
        <div>
          <p className="text-lg font-bold">{t('finder.handover.safeLead', { place: spName })}</p>
          <p className="text-ink-soft">{t('finder.handover.policeInformed')}</p>
        </div>
      </div>

      {s === 'escalated_police' && <Notice tone="danger">{t('finder.handover.escalated')}</Notice>}

      {under4 ? (
        <Notice>{t('finder.handover.under4Thanks')}</Notice>
      ) : suggested ? (
        <MatchReview m={suggested} onDecided={() => void reload()} />
      ) : confirmed ? (
        <>
          <Notice>{s === 'verifying' ? t('finder.handover.verifying') : t('finder.handover.parentComing', { place: spName })}</Notice>
          <Chat matchId={confirmed.match_id} open={confirmed.match_status === 'finder_confirmed'} />
        </>
      ) : (
        <>
          <PageHeader title={t('finder.handover.searching')} lead={t('finder.handover.thanks')} />
          <CaseCard c={live} />
        </>
      )}
    </section>
  )
}

import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeft, ArrowRight, CircleCheck, PenLine, UserPlus } from 'lucide-react'
import { Button } from '../../components/Button'
import { PhotoCapture } from '../../components/PhotoCapture'
import { ColourPicker } from '../../components/CaseCard'
import { RequireRole, SignedInAs } from '../../components/RequireRole'
import { Notice, PageHeader, ProgressDots } from '../../components/ui'
import { useI18n } from '../../i18n'
import { callFn, errorKey } from '../../lib/api'
import { compressImage, uploadMedia } from '../../lib/media'
import { MyCases } from '../parent'
import { nameError } from '../../components/Autofill'
import { brand } from '../../config/brand'

const GATE = { lat: 30.2002, lng: 71.469 } // Shrine Gate (demo event gate)

export default function Checkin() {
  return (
    <RequireRole roles={['parent', 'finder', 'admin']} roleHint="parent">
      <CheckinFlow />
      <SignedInAs />
    </RequireRole>
  )
}

/** "Aaj ki Tasveer": one photo in today's clothes at the event gate. Deleted after 48 hours (R9). */
function CheckinFlow() {
  const { t, lang, dir } = useI18n()
  const navigate = useNavigate()
  const [step, setStep] = useState<'photo' | 'details' | 'done'>('photo')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [name, setName] = useState('')
  const [age, setAge] = useState('')
  const [gender, setGender] = useState<'male' | 'female' | null>(null)
  const [top, setTop] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const NextIcon = dir === 'rtl' ? ArrowLeft : ArrowRight

  const onPhoto = useCallback((f: File | null) => f && void compressImage(f).then(setPhoto), [])

  function another() {
    setPhoto(null)
    setName('')
    setAge('')
    setGender(null)
    setTop(null)
    setError(null)
    setStep('photo')
    window.scrollTo({ top: 0 })
  }

  async function submit() {
    const n = name.trim() ? nameError(name) : 'autofill.needName'
    if (n) return setError(n)
    if (age !== '' && Number(age) > 17) return setError('autofill.needAgeNumber')
    setBusy(true)
    setError(null)
    try {
      const photo_path = photo ? await uploadMedia('case-photos', photo) : null
      const where = await new Promise<{ lat: number; lng: number }>((resolve) => {
        if (!navigator.geolocation) return resolve(GATE)
        navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(GATE), { timeout: 5000 })
      })
      await callFn('create-case', {
        kind: 'checkin',
        fields: { child_name: name, age_est: age === '' ? null : Number(age), gender, top_color: top, photo_path, ...where },
      })
      setStep('done')
    } catch (e) {
      setError(errorKey(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      {step !== 'done' && <ProgressDots total={2} current={step === 'photo' ? 1 : 2} />}

      {step === 'photo' && (
        <>
          <PageHeader title={lang === 'ur' ? brand.checkinNameUr : brand.checkinName} lead={t('checkin.lead')} />
          <PhotoCapture value={photo} onChange={onPhoto} label={t('checkin.takePhoto')} />
          {photo && <Button icon={<NextIcon className="size-6" aria-hidden />} onClick={() => setStep('details')}>{t('common.next')}</Button>}
        </>
      )}

      {step === 'details' && (
        <>
          <PageHeader title={t('checkin.detailsTitle')} />
          <label className="block">
            <span className="mb-1 block font-bold">{t('checkin.firstName')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="h-14 w-full rounded-2xl border-2 border-sand-deep bg-white px-4 text-lg outline-none focus:border-terracotta" />
          </label>
          <label className="block">
            <span className="mb-1 block font-bold">{t('card.age')}</span>
            <input value={age} inputMode="numeric" onChange={(e) => setAge(e.target.value.replace(/\D/g, '').slice(0, 2))} className="h-14 w-full rounded-2xl border-2 border-sand-deep bg-white px-4 text-lg outline-none focus:border-terracotta" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            {(['male', 'female'] as const).map((g) => (
              <button key={g} type="button" aria-pressed={gender === g} onClick={() => setGender(gender === g ? null : g)} className={`min-h-14 rounded-2xl border-2 text-lg font-bold ${gender === g ? 'border-terracotta bg-terracotta text-white' : 'border-sand-deep bg-sand'}`}>
                {t(`finder.about.${g}`)}
              </button>
            ))}
          </div>
          <ColourPicker label={t('checkin.topColour')} value={top} onChange={setTop} />
          {error && <Notice tone="danger">{t(error)}</Notice>}
          <Button busy={busy} disabled={!name.trim()} onClick={() => void submit()}>{t('checkin.save')}</Button>
          {!busy && (
            <button type="button" onClick={() => setStep('photo')} className="inline-flex min-h-11 items-center gap-2 font-semibold">
              {dir === 'rtl' ? <ArrowRight className="size-5" aria-hidden /> : <ArrowLeft className="size-5" aria-hidden />} {t('common.back')}
            </button>
          )}
        </>
      )}

      {step === 'done' && (
        <section className="space-y-5 text-center">
          <div className="mx-auto grid size-20 place-items-center rounded-full bg-sand"><CircleCheck className="size-12 text-ink" aria-hidden /></div>
          <PageHeader title={t('checkin.doneTitle')} lead={t('checkin.doneLead')} />
          <div className="flex items-center gap-3 rounded-2xl border-2 border-terracotta bg-sand p-4 text-start">
            <PenLine className="size-8 shrink-0 text-terracotta" aria-hidden />
            <p className="text-lg font-bold">{t('checkin.wristReminder')}</p>
          </div>
          <Button variant="secondary" icon={<UserPlus className="size-6" aria-hidden />} onClick={another}>
            {t('checkin.another')}
          </Button>
        </section>
      )}

      <MyCases kinds={['checkin']} onOpen={(id) => navigate(`/p?case=${id}`)} />
    </div>
  )
}

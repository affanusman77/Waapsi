import { useState, type FormEvent } from 'react'
import { MapPinPlus, UserPlus } from 'lucide-react'
import { Button } from '../../components/Button'
import { Notice } from '../../components/ui'
import { useI18n } from '../../i18n'
import { callFn, errorKey } from '../../lib/api'
import { supabase, type SafePoint } from '../../lib/supabase'
import { DEMO_CENTER } from '../../lib/geo'
import type { CaseRow } from '../../lib/useLiveCase'

const KINDS = ['shop', 'mosque', 'edhi', 'police_desk', 'event_desk'] as const
const IN_CARE = new Set(['awaiting_safe_point', 'at_safe_point', 'matched', 'finder_confirmed', 'verifying', 'escalated_police'])

/** F2: safe point list with live load, add / deactivate points, and onboard staff by phone. */
export function SafePointsAdmin({ points, cases }: { points: SafePoint[]; cases: CaseRow[] }) {
  const { t, lang } = useI18n()
  const [all, setAll] = useState<SafePoint[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [staffFor, setStaffFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const list = all ?? points

  async function refresh() {
    const { data } = await supabase.from('safe_points').select('*').order('name_en')
    setAll((data as SafePoint[]) ?? [])
  }

  async function toggle(p: SafePoint) {
    setError(null)
    const { error: e } = await supabase.from('safe_points').update({ active: !p.active }).eq('id', p.id)
    if (e) setError(errorKey(e))
    void refresh()
  }

  return (
    <section className="space-y-4 rounded-2xl border border-sand-deep p-4">
      <h2 className="text-xl font-bold">{t('admin.safePointsManage')}</h2>
      {error && <Notice tone="danger">{t(error)}</Notice>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-start">
          <thead className="text-sm text-ink-soft">
            <tr>
              <th className="p-2 text-start">{t('admin.sp.name')}</th>
              <th className="p-2 text-start">{t('admin.sp.kind')}</th>
              <th className="p-2 text-start">{t('admin.sp.load')}</th>
              <th className="p-2 text-start" />
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-deep">
            {list.map((p) => {
              const load = cases.filter((c) => c.safe_point_id === p.id && IN_CARE.has(c.status)).length
              return (
                <tr key={p.id} className={p.active ? '' : 'opacity-50'}>
                  <td className="p-2 font-semibold">
                    {lang === 'ur' && p.name_ur ? p.name_ur : p.name_en} {p.women_staff && <span title={t('admin.behanDesk')}>♀</span>}
                  </td>
                  <td className="p-2">{t(`kinds.${p.kind}`)}</td>
                  <td className="p-2">
                    <span className={`rounded-full px-3 py-1 text-sm font-bold tabular-nums ${load >= 3 ? 'bg-danger-soft text-danger' : 'bg-sand'}`}>{load}</span>
                  </td>
                  <td className="space-x-2 p-2 text-end rtl:space-x-reverse">
                    <button type="button" className="min-h-10 rounded-full border border-sand-deep px-3 text-sm font-semibold" onClick={() => setStaffFor(staffFor === p.id ? null : p.id)}>
                      {t('admin.sp.addStaff')}
                    </button>
                    <button type="button" className="min-h-10 rounded-full border border-sand-deep px-3 text-sm font-semibold" onClick={() => void toggle(p)}>
                      {p.active ? t('admin.sp.deactivate') : t('admin.sp.activate')}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {staffFor && <StaffForm safePointId={staffFor} onDone={() => setStaffFor(null)} />}
      {adding ? (
        <AddSafePoint onDone={() => { setAdding(false); void refresh() }} />
      ) : (
        <div className="max-w-xs">
          <Button variant="secondary" icon={<MapPinPlus className="size-5" aria-hidden />} onClick={() => setAdding(true)}>{t('admin.sp.add')}</Button>
        </div>
      )}
    </section>
  )
}

function AddSafePoint({ onDone }: { onDone: () => void }) {
  const { t } = useI18n()
  const [f, setF] = useState({ name_en: '', name_ur: '', kind: 'shop', lat: String(DEMO_CENTER.lat), lng: String(DEMO_CENTER.lng), women_staff: false })
  const [error, setError] = useState<string | null>(null)
  async function save(e: FormEvent) {
    e.preventDefault()
    const { error: err } = await supabase.from('safe_points').insert({ ...f, lat: Number(f.lat), lng: Number(f.lng), name_ur: f.name_ur || null })
    if (err) return setError(errorKey(err))
    onDone()
  }
  const input = 'h-12 w-full rounded-xl border-2 border-sand-deep bg-white px-3 outline-none focus:border-terracotta'
  return (
    <form onSubmit={save} className="grid gap-3 rounded-xl bg-sand p-4 sm:grid-cols-2">
      <label>{t('admin.sp.nameEn')}<input required className={input} value={f.name_en} onChange={(e) => setF({ ...f, name_en: e.target.value })} /></label>
      <label>{t('admin.sp.nameUr')}<input className={input} dir="rtl" value={f.name_ur} onChange={(e) => setF({ ...f, name_ur: e.target.value })} /></label>
      <label>{t('admin.sp.kind')}
        <select className={input} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          {KINDS.map((k) => <option key={k} value={k}>{t(`kinds.${k}`)}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-3 pt-6">
        <input type="checkbox" className="size-6" checked={f.women_staff} onChange={(e) => setF({ ...f, women_staff: e.target.checked })} />
        {t('admin.behanDesk')}
      </label>
      <label>Lat<input required inputMode="decimal" className={input} dir="ltr" value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} /></label>
      <label>Lng<input required inputMode="decimal" className={input} dir="ltr" value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} /></label>
      {error && <div className="sm:col-span-2"><Notice tone="danger">{t(error)}</Notice></div>}
      <div className="sm:col-span-2"><Button type="submit">{t('admin.sp.save')}</Button></div>
    </form>
  )
}

function StaffForm({ safePointId, onDone }: { safePointId: string; onDone: () => void }) {
  const { t } = useI18n()
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [gender, setGender] = useState<'male' | 'female' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await callFn('staff-assign', { phone, display_name: name, gender, safe_point_id: safePointId })
      onDone()
    } catch (err) {
      setError(errorKey(err))
    } finally {
      setBusy(false)
    }
  }
  const input = 'h-12 w-full rounded-xl border-2 border-sand-deep bg-white px-3 outline-none focus:border-terracotta'
  return (
    <form onSubmit={save} className="grid gap-3 rounded-xl bg-sand p-4 sm:grid-cols-3">
      <label>{t('login.phoneLabel')}<input required type="tel" dir="ltr" className={input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03XX XXXXXXX" /></label>
      <label>{t('admin.sp.staffName')}<input className={input} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <fieldset className="flex items-end gap-2">
        {(['female', 'male'] as const).map((g) => (
          <button key={g} type="button" aria-pressed={gender === g} onClick={() => setGender(g)} className={`h-12 flex-1 rounded-xl border-2 font-bold ${gender === g ? 'border-ink bg-ink text-cream' : 'border-sand-deep bg-white'}`}>
            {t(`admin.sp.${g}`)}
          </button>
        ))}
      </fieldset>
      {error && <div className="sm:col-span-3"><Notice tone="danger">{t(error)}</Notice></div>}
      <div className="sm:col-span-3"><Button type="submit" busy={busy} disabled={!gender} icon={<UserPlus className="size-5" aria-hidden />}>{t('admin.sp.assign')}</Button></div>
    </form>
  )
}

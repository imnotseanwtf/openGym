// The meal log (lib/meal-log.js). The point of the screen is the fast path: tap Snap, pick or take
// a photo, done — the meal is saved as a photo with nothing written about it, and waits in the
// "details later" list until you (or an analysis, one day) fill it in. Everything else is
// optional: a name, calories, a time, a note.
//
// The photo goes through the very same ingest as a workout's (lib/media-ingest.js) in its compact
// mode: a still only, WebP where the browser can write it, at most 1280 px at quality 0.6 — a plate
// is a few dozen to ~150 KB. The bytes live in the media store and on the server, never in the state.
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate, todayISO } from '../lib/format.js'
import {
  mealsOn, pendingMeals, dayTotals, isPending, readMeal, withMeal, withoutMeal, addMealMedia, mealMediaOf,
  nowHHMM, NAME_MAX, NOTE_MAX, MEAL_MEDIA_MAX
} from '../lib/meal-log.js'
import { syncMedia } from '../lib/media-sync.js'
import { useMediaPicker } from '../components/CustomMediaField.jsx'
import { CustomThumb, MediaView } from '../components/CustomMedia.jsx'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

const toast = m => useUI.getState().toast(m)
const write = fn => useStore.getState().update(fn)

const shiftDay = (iso, n) => {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function openPhoto(m, label) {
  useUI.getState().openSheet(close => (
    <div className="mviewer" role="dialog" aria-modal="true" aria-label={t('Photo')}>
      <div className="mviewer-bar">
        <button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
        <span className="mviewer-count">{label}</span>
        <span style={{ width: 36 }} />
      </div>
      <div className="mviewer-stage"><MediaView m={m} cls="exmedia viewer" /></div>
    </div>
  ), { kind: 'viewer' })
}

/** The line under a meal's title: time, calories, a bit of the note. */
function metaLine(m) {
  return [m.tm, m.kcal ? t('{0} kcal', m.kcal) : null, m.note ? m.note.slice(0, 60) : null].filter(Boolean).join(' · ')
}

/** Details of one meal: write what you ate, fix the time, add or drop photos, delete it. */
function MealSheet({ id, d, close }) {
  const rec = useStore(s => (id ? s.S.mealLog?.[id] : null) || null)
  const meal = readMeal(rec)
  const [name, setName] = useState(meal?.name || '')
  const [kcal, setKcal] = useState(meal?.kcal ? String(meal.kcal) : '')
  const [tm, setTm] = useState(meal?.tm || nowHHMM())
  const [note, setNote] = useState(meal?.note || '')
  const { pick, busy, canAdd, showAdd } = useMediaPicker({ compact: true })
  const fileRef = useRef(null)
  const day = meal?.d || d
  const photos = mealMediaOf(rec)

  // The photos are written straight onto the saved meal, so no file is ever picked into a draft
  // that could be abandoned; a meal that does not exist yet is saved first, by the details.
  const addPhotos = async ev => {
    const files = [...(ev.target.files || [])].slice(0, MEAL_MEDIA_MAX)
    ev.target.value = ''
    let added = 0
    for (const file of files) {
      const got = await pick(file)
      if (!got) continue
      write(s => {
        const cur = s.mealLog?.[id]
        if (!cur) return
        const media = addMealMedia(cur, got)
        if (media.length === mealMediaOf(cur).length) return
        const r = withMeal(s.mealLog, id, { ...cur, media }, Date.now())
        if (r) { s.mealLog = r.map; added++ }
      })
    }
    if (added) syncMedia({ force: true })
    else if (files.length) toast(t('Up to {0} photos per meal.', MEAL_MEDIA_MAX))
  }
  const dropPhoto = hash => {
    write(s => {
      const cur = s.mealLog?.[id]
      if (!cur) return
      const media = mealMediaOf(cur).filter(m => m.hash !== hash)
      const r = withMeal(s.mealLog, id, { ...cur, media }, Date.now())
      s.mealLog = r ? r.map : withoutMeal(s.mealLog, id)   // nothing left to keep: the meal goes
    })
  }
  const save = () => {
    const r = withMeal(useStore.getState().S.mealLog, id, { d: day, tm, name, note, kcal, media: photos }, Date.now())
    if (!r) { close(); return }
    write(s => { s.mealLog = r.map })
    toast(t('Meal saved'))
    close()
  }
  const remove = () => {
    if (id) write(s => { s.mealLog = withoutMeal(s.mealLog, id) })
    toast(t('Meal deleted'))
    close()
  }

  return <>
    <h3 style={{ marginBottom: 2 }}>{id ? t('Meal details') : t('Add a meal')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{fmtDate(day, true)}</div>

    {id && <div className="wmedia-grid" style={{ marginBottom: 12 }}>
      {photos.map((m, i) => (
        <div key={m.hash} style={{ position: 'relative' }}>
          <button type="button" className="wmedia-item" data-swipe-ignore
            aria-label={t('Photo {0} of {1}', i + 1, photos.length)} onClick={() => openPhoto(m, fmtDate(day, true, true))}>
            <CustomThumb ex={{ custom: true, media: m }} />
          </button>
          <button type="button" className="iconbtn" style={{ position: 'absolute', top: 2, insetInlineEnd: 2 }}
            aria-label={t('Remove photo')} onClick={() => dropPhoto(m.hash)}><Icon name="xmark" /></button>
        </div>
      ))}
      {showAdd && photos.length < MEAL_MEDIA_MAX && (
        <button type="button" className="wmedia-add" disabled={!canAdd} onClick={() => fileRef.current?.click()}>
          <Icon name={busy ? 'image' : 'camera'} /><span>{busy ? t('Loading…') : t('Add photo')}</span>
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={addPhotos} />
    </div>}

    <input className="input" value={name} maxLength={NAME_MAX} placeholder={t('What did you eat? (optional)')}
      onChange={e => setName(e.target.value)} />
    <div className="row" style={{ gap: 8, margin: '8px 0' }}>
      <input className="input" inputMode="numeric" value={kcal} placeholder={t('Calories (optional)')}
        onChange={e => setKcal(e.target.value.replace(/[^\d]/g, '').slice(0, 5))} />
      <input type="time" className="input" value={tm} aria-label={t('Time')}
        onChange={e => e.target.value && setTm(e.target.value)} />
    </div>
    <textarea className="input" rows={3} maxLength={NOTE_MAX} value={note} placeholder={t('Notes (optional)')}
      onChange={e => setNote(e.target.value)} />
    <div style={{ height: 16 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {id && <><div style={{ height: 10 }} /><Button variant="ghost" icon="trash" onClick={remove}>{t('Delete meal')}</Button></>}
  </>
}
const openMeal = (id, d) => useUI.getState().openSheet(close => <MealSheet id={id} d={d} close={close} />)

function MealRow({ m }) {
  const pending = isPending(m)
  const title = m.name || (pending ? t('Photo, details later') : m.note || t('Meal'))
  return (
    <button type="button" className="lrow tap" onClick={() => openMeal(m.id, m.d)}>
      <span className="lrow-i">{m.media.length ? <CustomThumb ex={{ custom: true, media: m.media[0] }} /> : <Icon name="flame" />}</span>
      <span className="lrow-m">
        <span className="lrow-t">{title}</span>
        <span className="lrow-s">{[pending ? t('To analyze later') : null, metaLine(m)].filter(Boolean).join(' · ')}</span>
      </span>
      {m.media.length > 1 && <span className="lrow-v">{m.media.length} <Icon name="image" /></span>}
    </button>
  )
}

/** Meals of one day, as the Home card and this screen both read them. */
export default function Meals() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [day, setDay] = useState(todayISO())
  const [waiting, setWaiting] = useState(false)
  const { pick, busy, canAdd, showAdd, note } = useMediaPicker({ compact: true })
  const fileRef = useRef(null)
  const today = todayISO()

  const meals = useMemo(() => mealsOn(S, day), [S.mealLog, day])
  const pending = useMemo(() => pendingMeals(S), [S.mealLog])
  const totals = dayTotals(S, day)

  // The fast path: every photo picked becomes its own meal, a photo and nothing else.
  const snap = async ev => {
    const files = [...(ev.target.files || [])]
    ev.target.value = ''
    let saved = 0
    for (const file of files) {
      const got = await pick(file)
      if (!got) continue
      write(s => {
        const r = withMeal(s.mealLog, null, { d: day, tm: nowHHMM(), media: [got] }, Date.now())
        if (r) { s.mealLog = r.map; saved++ }
      })
    }
    if (saved) { toast(t('Saved. Add details whenever you like.')); syncMedia({ force: true }) }
  }

  const list = waiting ? pending : meals
  const groups = waiting
    ? pending.reduce((acc, m) => { const g = acc[acc.length - 1]; if (g && g.d === m.d) g.items.push(m); else acc.push({ d: m.d, items: [m] }); return acc }, [])
    : null

  return <>
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}>
        <h1>{t('Meals')}</h1>
        <div className="sub">{totals.count
          ? [t('Meals: {0}', totals.count), totals.kcal ? t('{0} kcal', totals.kcal) : null].filter(Boolean).join(' · ')
          : t('Nothing logged')}</div>
      </div>
    </div>

    <div className="row" style={{ gap: 8, marginBottom: 12 }}>
      {showAdd && <Button variant="primary" icon={busy ? 'image' : 'camera'} disabled={!canAdd} onClick={() => fileRef.current?.click()}>
        {busy ? t('Saving…') : t('Snap a meal')}
      </Button>}
      <Button variant="tinted" icon="plus" onClick={() => openMeal(null, day)}>{t('Add')}</Button>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={snap} />
    </div>
    {note && <div className="small dim" style={{ marginBottom: 12 }}>{note}</div>}

    {pending.length > 0 && <button type="button" className={'chip nocap' + (waiting ? ' on' : '')} aria-pressed={waiting}
      style={{ marginBottom: 12 }} onClick={() => setWaiting(w => !w)}>
      <Icon name="image" /> {t('Waiting for details: {0}', pending.length)}
    </button>}

    {!waiting && <div className="row between" style={{ alignItems: 'center', marginBottom: 8 }}>
      <button className="iconbtn" aria-label={t('Previous day')} onClick={() => setDay(shiftDay(day, -1))}><Icon name="chevronLeft" /></button>
      <button type="button" className="small muted" onClick={() => setDay(today)}>{day === today ? t('Today') : fmtDate(day, true, true)}</button>
      <button className="iconbtn" aria-label={t('Next day')} disabled={day >= today} onClick={() => setDay(shiftDay(day, 1))}><Icon name="chevronRight" /></button>
    </div>}

    {!list.length
      ? <div className="empty"><div className="ico"><Icon name="camera" /></div>
          {waiting ? t('Nothing waiting. Every photo has its details.') : t('No meals yet. Snap a photo now and fill in the details whenever you like.')}
        </div>
      : waiting
        ? groups.map(g => (
          <div key={g.d} style={{ marginBottom: 14 }}>
            <div className="small muted" style={{ marginBottom: 6 }}>{fmtDate(g.d, true, true)}</div>
            <div className="list">{g.items.map(m => <MealRow key={m.id} m={m} />)}</div>
          </div>))
        : <div className="list">{list.map(m => <MealRow key={m.id} m={m} />)}</div>}
  </>
}

/** The card on Home: today's count, and the one-tap way in. */
export function MealsCard() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const totals = dayTotals(S, todayISO())
  const waiting = pendingMeals(S).length
  return (
    <div className="card row between" style={{ alignItems: 'center', gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: 0 }}>{t('Meals')}</h2>
        <div className="muted small" style={{ marginTop: 4 }}>
          {totals.count ? t('Meals today: {0}', totals.count) : t('Snap a photo of your meal.')}
          {waiting > 0 ? ' · ' + t('Waiting for details: {0}', waiting) : ''}
        </div>
      </div>
      <Button size="sm" variant="tinted" icon="camera" style={{ flexShrink: 0 }} onClick={() => nav('/meals')}>{t('Open')}</Button>
    </div>
  )
}

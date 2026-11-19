// The meal log: what you ate and when, and — on purpose — a photo with nothing else.
//
// Stored the way a day's note is (lib/day-notes.js): one entry per meal in a map, each with the
// time it was last written, so two devices that each logged a meal keep both and the same meal
// keeps its later edit (lib/sync-merge.js mergeStampedMap, STAMPED_MAPS). Deleting a meal is a
// stamped empty entry (`{ _ts }`), not a deleted key: a delete would come straight back from the
// other device's copy on the next sync.
//
//   S.mealLog = { '<id>': { d: '2026-11-19', tm: '12:41', name?, note?, kcal?, media?: [MediaRef], _ts }, … }
//
// A meal may be just `media`: a snap now, the details (or an analysis) later. Such a meal is
// "pending" (isPending) and the screen lists it as waiting. The photo is a MediaRef like a
// workout's: the bytes live in the media store and on the server, never in the state.
import { normalizeMediaRef } from './media-refs.js'

export const MEAL_MEDIA_MAX = 3
export const NAME_MAX = 80
export const NOTE_MAX = 500
export const KCAL_MAX = 20000

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const ISO = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const kcalOf = v => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= KCAL_MAX ? Math.round(n) : null
}

/** The photos of a meal as they may be shown: each passes normalizeMediaRef (stills only), a file
 *  listed twice shows once, never more than MEAL_MEDIA_MAX. */
export function mealMediaOf(meal) {
  const raw = isMap(meal) && Array.isArray(meal.media) ? meal.media : []
  const out = []
  const seen = new Set()
  for (const r of raw) {
    const m = normalizeMediaRef(r)
    if (!m || m.kind === 'video' || seen.has(m.hash)) continue
    seen.add(m.hash)
    out.push(m)
    if (out.length >= MEAL_MEDIA_MAX) break
  }
  return out
}

/** A stored entry read back — { d, tm, name, note, kcal, media } with the junk left out — or null
 *  for a deleted one, one with no date, or one holding nothing at all. */
export function readMeal(entry) {
  if (!isMap(entry) || !ISO.test(String(entry.d || ''))) return null
  const out = {
    d: entry.d,
    tm: HHMM.test(String(entry.tm || '')) ? entry.tm : '',
    name: str(entry.name, NAME_MAX),
    note: str(entry.note, NOTE_MAX),
    kcal: kcalOf(entry.kcal),
    media: mealMediaOf(entry)
  }
  return out.name || out.note || out.kcal || out.media.length ? out : null
}

/** A meal with a photo and nothing written about it: kept to be looked at (or analysed) later. */
export const isPending = meal => !!meal && meal.media.length > 0 && !meal.name && !meal.note && !meal.kcal

/** The meals of `iso`, earliest first, each as readMeal gives it plus its `id`. */
export function mealsOn(S, iso) {
  const out = []
  for (const [id, e] of Object.entries(isMap(S?.mealLog) ? S.mealLog : {})) {
    const m = readMeal(e)
    if (m && m.d === iso) out.push({ id, ...m, _ts: Number(e._ts) || 0 })
  }
  return out.sort((a, b) => (a.tm < b.tm ? -1 : a.tm > b.tm ? 1 : a._ts - b._ts))
}

/** Every pending meal, newest day first: the "analyse later" queue. */
export function pendingMeals(S) {
  const out = []
  for (const [id, e] of Object.entries(isMap(S?.mealLog) ? S.mealLog : {})) {
    const m = readMeal(e)
    if (isPending(m)) out.push({ id, ...m })
  }
  return out.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : a.tm < b.tm ? 1 : -1))
}

/** What the day's meals add up to: { kcal, count } — count is every meal, kcal only the ones that say. */
export function dayTotals(S, iso) {
  const meals = mealsOn(S, iso)
  return { count: meals.length, kcal: meals.reduce((n, m) => n + (m.kcal || 0), 0) }
}

/** The current time as HH:MM, for a new meal. */
export const nowHHMM = (now = new Date()) => String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')

/** A fresh id: time-ordered and random enough that two devices never collide. */
export const newMealId = (now = Date.now()) => now.toString(36) + Math.random().toString(36).slice(2, 8)

function clean(fields, now) {
  const e = { d: fields.d }
  if (HHMM.test(String(fields.tm || ''))) e.tm = fields.tm
  const name = str(fields.name, NAME_MAX); if (name) e.name = name
  const note = str(fields.note, NOTE_MAX); if (note) e.note = note
  const kcal = kcalOf(fields.kcal); if (kcal) e.kcal = kcal
  const media = mealMediaOf(fields); if (media.length) e.media = media
  e._ts = now
  return e
}

/**
 * S.mealLog with a meal written: a new one when `id` is not in it, else that meal replaced by
 * `fields` ({ d, tm?, name?, note?, kcal?, media? }), stamped `now`. Returns { map, id }, or null
 * when the result would hold nothing to keep (use removeMeal for that) or `d` is not a date.
 */
export function withMeal(map, id, fields, now = Date.now()) {
  if (!isMap(fields) || !ISO.test(String(fields.d || ''))) return null
  const e = clean(fields, now)
  if (!readMeal(e)) return null
  const key = id || newMealId(now)
  return { map: { ...(isMap(map) ? map : {}), [key]: e }, id: key }
}

/** S.mealLog with `id` deleted — written as a cleared, stamped entry so the deletion syncs. Its
 *  photos are no longer referenced, so the stores' clean-ups can take them. */
export const withoutMeal = (map, id, now = Date.now()) => ({ ...(isMap(map) ? map : {}), [id]: { _ts: now } })

/** `meal` with the photo `ref` added (a no-op past the cap or for a file it already has). */
export function addMealMedia(meal, ref) {
  const have = mealMediaOf(meal)
  const m = normalizeMediaRef(ref)
  if (!m || m.kind === 'video' || have.length >= MEAL_MEDIA_MAX || have.some(x => x.hash === m.hash)) return have
  return [...have, m]
}

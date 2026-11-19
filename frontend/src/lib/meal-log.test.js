import { describe, it, expect } from 'vitest'
import { mergeStates } from './sync-merge.js'
import { referencedHashes } from './media-refs.js'
import { sanitizeCustomMedia } from './backup-media.js'
import { compactEncoder, COMPACT_EDGE, COMPACT_QUALITY } from './media-ingest.js'
import {
  readMeal, isPending, mealsOn, pendingMeals, dayTotals, withMeal, withoutMeal, addMealMedia, mealMediaOf, MEAL_MEDIA_MAX
} from './meal-log.js'

const H = c => c.repeat(64)
const ref = (c, extra = {}) => ({ kind: 'image', hash: H(c), mime: 'image/webp', size: 90000, width: 1280, height: 960, at: 1, ...extra })
const D = '2026-11-19'

describe('a meal can be just a photo', () => {
  it('is kept with no name, note or calories, and reads as pending', () => {
    const w = withMeal({}, null, { d: D, tm: '12:41', media: [ref('a')] }, 100)
    expect(w).not.toBeNull()
    const m = readMeal(w.map[w.id])
    expect(m.media).toHaveLength(1)
    expect(isPending(m)).toBe(true)
  })
  it('stops being pending once anything is written about it', () => {
    const { map, id } = withMeal({}, null, { d: D, media: [ref('a')] }, 100)
    const next = withMeal(map, id, { d: D, media: [ref('a')], name: 'Chicken rice' }, 200)
    expect(isPending(readMeal(next.map[id]))).toBe(false)
    expect(next.map[id]._ts).toBe(200)
  })
  it('is not made from nothing: no photo and no text is refused', () => {
    expect(withMeal({}, null, { d: D }, 1)).toBeNull()
    expect(withMeal({}, null, { d: D, name: '   ' }, 1)).toBeNull()
    expect(withMeal({}, null, { d: 'yesterday', name: 'x' }, 1)).toBeNull()
  })
})

describe('reading the log back', () => {
  const S = { mealLog: {} }
  const add = (id, f, now) => { S.mealLog = withMeal(S.mealLog, id, f, now).map }
  add('b', { d: D, tm: '19:00', name: 'Dinner', kcal: '650' }, 3)
  add('a', { d: D, tm: '08:00', name: 'Oats', kcal: 400 }, 1)
  add('c', { d: D, tm: '13:00', media: [ref('c')] }, 2)
  add('z', { d: '2026-11-18', media: [ref('d')] }, 4)
  it('lists a day earliest first and totals only the calories that were given', () => {
    expect(mealsOn(S, D).map(m => m.id)).toEqual(['a', 'c', 'b'])
    expect(dayTotals(S, D)).toEqual({ count: 3, kcal: 1050 })
  })
  it('queues the photo-only meals, newest first', () => {
    expect(pendingMeals(S).map(m => m.id)).toEqual(['c', 'z'])
  })
  it('drops junk: bad calories, bad time, over-long text', () => {
    const m = readMeal({ d: D, tm: '25:99', name: 'x'.repeat(500), kcal: -5 })
    expect(m.tm).toBe('')
    expect(m.name).toHaveLength(80)
    expect(m.kcal).toBeNull()
  })
  it('ignores videos and bogus refs, dedupes, and caps the photos', () => {
    const many = [ref('a'), ref('a'), ref('b'), ref('c'), ref('d'), { hash: 'nope' }, ref('e', { kind: 'video', mime: 'video/mp4' })]
    expect(mealMediaOf({ media: many }).map(m => m.hash)).toEqual([H('a'), H('b'), H('c')].slice(0, MEAL_MEDIA_MAX))
    expect(addMealMedia({ media: [ref('a'), ref('b'), ref('c')] }, ref('d'))).toHaveLength(3)
  })
})

describe('deleting', () => {
  it('writes a stamped empty entry that reads as no meal and frees the photo', () => {
    const { map, id } = withMeal({}, null, { d: D, media: [ref('a')] }, 1)
    const gone = withoutMeal(map, id, 2)
    expect(readMeal(gone[id])).toBeNull()
    expect(referencedHashes({ mealLog: gone }).size).toBe(0)
    expect(referencedHashes({ mealLog: map }).has(H('a'))).toBe(true)
  })
})

describe('across two devices', () => {
  const base = { workouts: [], routines: [], customEx: [], bodyweight: [], unit: 'kg' }
  it('keeps a meal from each side, the later edit of a shared one, and a deletion', () => {
    const phone = { ...base, _ts: 10, mealLog: { p: { d: D, name: 'phone meal', _ts: 10 }, s: { d: D, name: 'old', _ts: 5 } } }
    const laptop = { ...base, _ts: 20, mealLog: { l: { d: D, name: 'laptop meal', _ts: 20 }, s: { d: D, name: 'new', _ts: 15 } } }
    const out = mergeStates(laptop, phone)
    expect(Object.keys(out.mealLog).sort()).toEqual(['l', 'p', 's'])
    expect(out.mealLog.s.name).toBe('new')
    const deleted = mergeStates({ ...base, _ts: 30, mealLog: { p: { _ts: 30 } } }, phone)
    expect(readMeal(deleted.mealLog.p)).toBeNull()
  })
})

describe('imports', () => {
  it('sanitising a backup keeps valid stills and removes the rest', () => {
    const S = sanitizeCustomMedia({ mealLog: { a: { d: D, media: [ref('a'), { hash: 'x' }] }, b: { d: D, name: 'x', media: [{ hash: 'x' }] } } })
    expect(S.mealLog.a.media).toHaveLength(1)
    expect('media' in S.mealLog.b).toBe(false)
  })
})

describe('compact encoding', () => {
  it('never encodes above the compact edge or quality', async () => {
    const calls = []
    const enc = compactEncoder(async (...a) => { calls.push(a.slice(1, 3)); return {} })
    await enc({}, 1600, 0.85); await enc({}, 480, 0.8); await enc({}, 960, 0.5)
    expect(calls).toEqual([[COMPACT_EDGE, COMPACT_QUALITY], [480, COMPACT_QUALITY], [960, 0.5]])
  })
})

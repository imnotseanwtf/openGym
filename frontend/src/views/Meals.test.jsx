// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const H = c => c.repeat(64)
const ref = c => ({ kind: 'image', hash: H(c), mime: 'image/webp', size: 70000, width: 1280, height: 960, at: 1 })

const mocks = vi.hoisted(() => ({ pickArgs: [], next: [] }))
vi.mock('../components/CustomMediaField.jsx', () => ({
  useMediaPicker: opts => {
    mocks.pickArgs.push(opts)
    return { pick: async () => mocks.next.shift() ?? null, busy: false, canAdd: true, showAdd: true, note: null }
  }
}))
vi.mock('../lib/media-sync.js', () => ({ syncMedia: vi.fn() }))
vi.mock('../components/CustomMedia.jsx', () => ({ CustomThumb: () => <i className="thumb" />, MediaView: () => null }))

import { useStore } from '../store/useStore.js'
import { syncMedia } from '../lib/media-sync.js'
import { pendingMeals, mealsOn } from '../lib/meal-log.js'
import { todayISO } from '../lib/format.js'
import Meals from './Meals.jsx'

let root, host
const mount = async () => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<MemoryRouter><Meals /></MemoryRouter>) })
}
const pickFiles = async n => {
  const input = host.querySelector('input[type=file]')
  Object.defineProperty(input, 'files', { value: Array.from({ length: n }, () => new File(['x'], 'a.jpg')), configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
}

beforeEach(() => {
  mocks.pickArgs.length = 0
  mocks.next = []
  syncMedia.mockClear()
  useStore.setState(s => ({ S: { ...s.S, mealLog: {} } }))
})
afterEach(() => { act(() => root?.unmount()); host?.remove() })

describe('Meals', () => {
  it('asks the picker for compact stills', async () => {
    await mount()
    expect(mocks.pickArgs.every(o => o?.compact === true)).toBe(true)
  })

  it('shows an empty day with the way in', async () => {
    await mount()
    expect(host.textContent).toContain('No meals yet')
    expect(host.textContent).toContain('Snap a meal')
  })

  it('saves a snapped photo as a meal with nothing else, waiting for details, and uploads it', async () => {
    mocks.next = [ref('a'), ref('b')]
    await mount()
    await pickFiles(2)
    const S = useStore.getState().S
    expect(mealsOn(S, todayISO())).toHaveLength(2)
    expect(pendingMeals(S)).toHaveLength(2)
    expect(syncMedia).toHaveBeenCalledWith({ force: true })
    expect(host.textContent).toContain('Waiting for details: 2')
    expect(host.textContent).toContain('Photo, details later')
  })

  it('saves nothing when the picked file was refused', async () => {
    mocks.next = [null]
    await mount()
    await pickFiles(1)
    expect(Object.keys(useStore.getState().S.mealLog)).toHaveLength(0)
    expect(syncMedia).not.toHaveBeenCalled()
  })
})

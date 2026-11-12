import { expect, it } from 'vitest'
import { legacyVirtualPaperProgress } from '../src/pdf/legacyVirtualPaperProgress'

const pages = [1, 2, 3].map((pageNumber) => ({
  pageNumber,
  width: 600,
  height: 2000
}))

it.each([0.5, 1, 1.5])(
  'interprets scaled legacy geometry with the same safe line (%s)',
  (scale) => {
    const inset = 80
    const y = inset - inset / scale - (12 + 2000 + 12 + 2000 * 0.65) * scale
    expect(
      legacyVirtualPaperProgress({ x: -40, y, scale }, pages, inset)
    ).toEqual({ pageNumber: 2, verticalPercentage: 65 })
  }
)

it('uses the widest cropped width, not each source page width', () => {
  const mixed = [
    { pageNumber: 3, width: 400, height: 800 },
    { pageNumber: 4, width: 600, height: 1000 }
  ]
  const crop = { all: { top: 0.1, bottom: 0.1 } }
  expect(
    legacyVirtualPaperProgress(
      { x: 0, y: -(12 + 960 + 12 + 400), scale: 1 },
      mixed,
      0,
      crop
    )
  ).toEqual({ pageNumber: 4, verticalPercentage: 50 })
})

it('clamps whitespace and out-of-document positions without mutating the record', () => {
  const state = Object.freeze({ x: 0, y: -99999, scale: 1 })
  expect(legacyVirtualPaperProgress(state, pages)).toEqual({
    pageNumber: 3,
    verticalPercentage: 100
  })
  expect(legacyVirtualPaperProgress({ ...state, y: 40 }, pages)).toEqual({
    pageNumber: 1,
    verticalPercentage: 0
  })
  expect(legacyVirtualPaperProgress({ ...state, y: -2018 }, pages)).toEqual({
    pageNumber: 2,
    verticalPercentage: 0
  })
  expect(state.y).toBe(-99999)
})

it.each([0, -1, NaN, Infinity])('ignores unusable scale %s', (scale) => {
  expect(
    legacyVirtualPaperProgress({ x: 0, y: -100, scale }, pages)
  ).toBeUndefined()
})

it('ignores invalid coordinates or unavailable page geometry', () => {
  expect(
    legacyVirtualPaperProgress({ x: NaN, y: -100, scale: 1 }, pages)
  ).toBeUndefined()
  expect(
    legacyVirtualPaperProgress({ x: 0, y: -Infinity, scale: 1 }, pages)
  ).toBeUndefined()
  expect(
    legacyVirtualPaperProgress({ x: 0, y: -100, scale: 1 }, [])
  ).toBeUndefined()
})

import type { FoliateBook, FoliateRenderer } from './view.js'

/** reader patch: manual-navigation disables gesture/selection/focus navigation.
 * before-reflow is emitted before viewport, font or image layout changes.
 */
export class Paginator extends HTMLElement implements FoliateRenderer {
  open: FoliateRenderer['open']
  destroy: FoliateRenderer['destroy']
  goTo: FoliateRenderer['goTo']
  scrollToAnchor: NonNullable<FoliateRenderer['scrollToAnchor']>
  setStyles: NonNullable<FoliateRenderer['setStyles']>
  getContents: FoliateRenderer['getContents']
  next: FoliateRenderer['next']
  prev: FoliateRenderer['prev']
  sections: FoliateBook['sections']
}

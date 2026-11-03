/** Internal state shared by controls; layout and anchors belong to each adapter. */
export type ViewportNavigationState = {
  readonly canPrevious: boolean
  readonly canNext: boolean
  readonly busy: boolean
}

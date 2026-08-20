import path from 'node:path'
import * as sass from 'sass'
import { describe, expect, it } from 'vitest'

describe('reader styles', () => {
  it('keeps the demo shell inside its containing block', () => {
    // Given: the demo reader styles are compiled as shipped.
    const readerStyles = sass.compile(
      path.resolve(__dirname, '../src/styles/reader.scss')
    ).css

    // When: the demo shell width contract is inspected.
    const demoShellRule = readerStyles.match(
      /\.hamster-demo-shell\s*\{[^}]*\}/s
    )

    // Then: the shell does not extend a viewport width beyond body margins.
    expect(demoShellRule?.[0]).toContain('width: 100%')
    expect(demoShellRule?.[0]).not.toContain('width: 100vw')
  })

  it('colors the actual text viewer surface in dark mode', () => {
    // Given: the reader styles are compiled as shipped.
    const readerStyles = sass.compile(
      path.resolve(__dirname, '../src/styles/reader.scss')
    ).css

    // When: the text-mode dark theme selectors are inspected.
    const darkTextSurfaceRule = readerStyles.match(
      /\.hamster-reader--dark-text \.hamster-reader__content,[^{]*\.hamster-reader--dark-text \.hamster-reader__intermediate-page--flow\s*\{[^}]*\}/s
    )

    // Then: the concrete scrolling viewer cannot retain its light surface.
    expect(darkTextSurfaceRule?.[0]).toContain(
      '.hamster-reader--dark-text .hamster-reader__intermediate-text-viewer'
    )
    expect(darkTextSurfaceRule?.[0]).toContain('background: #000000')
    expect(darkTextSurfaceRule?.[0]).toContain('color: #ffffff')
  })

  it('directly inverts layout pages while restoring colored overlays', () => {
    // Given: the reader styles are compiled as shipped.
    const readerStyles = sass.compile(
      path.resolve(__dirname, '../src/styles/reader.scss')
    ).css

    // When: the Layout dark-mode filter rules are inspected.
    const articleFilterRule = readerStyles.match(
      /\.hamster-reader--dark-layout \.hamster-note-document-gutter\s*\{[^}]*\}/s
    )
    const mediaFilterRule = readerStyles.match(
      /\.hamster-reader--dark-layout \.hamster-note-document-gutter \.hamster-reader__intermediate-page-image,[^{]*\.hamster-reader__drawing-layer\s*\{[^}]*\}/s
    )
    const selectionFilterRule = readerStyles.match(
      /\.hamster-reader--dark-layout \.hamster-note-document-gutter \.hsn-selection-overlay,[^{]*\.hsn-selection-percent-overlay\s*\{[^}]*\}/s
    )
    const selectionHandleRule = readerStyles.match(
      /\.hamster-reader--dark-layout \.hamster-note-document-gutter \.hsn-selection-handle\s*\{[^}]*\}/s
    )
    const layoutSurfaceRule = readerStyles.match(
      /\.hamster-reader--dark-layout \.hamster-reader__content,[^{]*\.hamster-reader__intermediate-document-viewer\s*\{[^}]*\}/s
    )

    // Then: pages use exact inversion, embedded media and selection overlays keep
    // their colors, and page base images remain part of the page inversion.
    expect(articleFilterRule?.[0]).toContain('filter: invert(1)')
    expect(mediaFilterRule?.[0]).toContain('filter: invert(1)')
    expect(selectionFilterRule?.[0]).toContain('filter: invert(1)')
    expect(selectionFilterRule?.[0]).toContain('.hsn-selection-percent-overlay')
    expect(selectionHandleRule?.[0]).toContain('filter: invert(1)')
    expect(mediaFilterRule?.[0]).toContain(
      '.hamster-reader__intermediate-flow-image img'
    )
    expect(mediaFilterRule?.[0]).not.toContain(
      '.hamster-reader__intermediate-page-base-image'
    )
    expect(layoutSurfaceRule?.[0]).toContain('background: #000000')
    expect(readerStyles).not.toContain('hue-rotate(180deg)')
    expect(readerStyles).not.toMatch(
      /\.hamster-reader--dark-layout \.hamster-reader__content\s*\{[^}]*filter:/s
    )
  })

  it('themes the page browser and loading chrome in both dark modes', () => {
    // Given: the reader styles are compiled as shipped.
    const readerStyles = sass.compile(
      path.resolve(__dirname, '../src/styles/reader.scss')
    ).css

    // When: the Page Browser dark-mode surface is inspected.
    const pageBrowserRule = readerStyles.match(
      /\.hamster-reader--dark-layout \.hamster-reader__page-browser,\s*\.hamster-reader--dark-text \.hamster-reader__page-browser\s*\{[^}]*\}/s
    )
    const loadingProgressRule = readerStyles.match(
      /\.hamster-reader--dark-layout \.hamster-reader__loading-progress,\s*\.hamster-reader--dark-text \.hamster-reader__loading-progress\s*\{[^}]*\}/s
    )

    // Then: the browser uses dark surfaces and borders instead of its light defaults.
    expect(pageBrowserRule?.[0]).toContain('color: #e2e8f0')
    expect(pageBrowserRule?.[0]).toContain('background: #0f172a')
    expect(pageBrowserRule?.[0]).toContain('border-right-color: #334155')
    expect(loadingProgressRule?.[0]).toContain('background: #1e293b')
    expect(loadingProgressRule?.[0]).toContain('border-color: #475569')
  })

  it('mixes populated page-browser states against the active theme surface', () => {
    // Given: the reader styles are compiled as shipped.
    const readerStyles = sass.compile(
      path.resolve(__dirname, '../src/styles/reader.scss')
    ).css

    // When: colored, selected, bookmark, and comment states are inspected.
    const darkColoredRule = readerStyles.match(
      /\.hamster-reader--dark-layout \.hamster-reader__highlight-item--colored,\s*\.hamster-reader--dark-text \.hamster-reader__highlight-item--colored\s*\{[^}]*\}/s
    )

    // Then: dynamic marker colors mix into dark chrome, never an inline white surface.
    expect(darkColoredRule?.[0]).toContain(
      'var(--hamster-reader-highlight-color) 20%'
    )
    expect(darkColoredRule?.[0]).toContain('#1e293b')
    expect(readerStyles).toContain(
      '.hamster-reader--dark-layout .hamster-reader__highlight-comment-badge'
    )
    expect(readerStyles).toContain(
      '.hamster-reader--dark-text .hamster-reader__bookmark-toggle[aria-pressed=true]'
    )
  })

  it('keeps legacy popovers borderless and borders only explicit light mode', () => {
    // Given: omitted darkMode must preserve the pre-existing dark Popover surface.
    const readerStyles = sass.compile(
      path.resolve(__dirname, '../src/styles/reader.scss')
    ).css

    // When: the base and explicit-light Popover rules are inspected.
    const basePopoverRule = readerStyles.match(
      /\.hamster-reader-popover\s*\{[^}]*\}/s
    )
    const lightPopoverRule = readerStyles.match(
      /\.hamster-reader-popover--light\s*\{[^}]*\}/s
    )

    // Then: only the new light variant introduces the light-theme border.
    expect(basePopoverRule?.[0]).toContain('border: 0')
    expect(lightPopoverRule?.[0]).toContain(
      'border: 1px solid var(--hamster-reader-popover-border)'
    )
  })
})

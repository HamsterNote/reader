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
})

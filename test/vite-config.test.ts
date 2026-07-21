// @vitest-environment node

import { fileURLToPath } from 'node:url'
import { resolveConfig } from 'vite'
import { describe, expect, it } from 'vitest'

describe('Vite OCR dependency handling', () => {
  it('serves PaddleOCR from its package so its relative worker asset remains reachable', async () => {
    // Given: Vite resolves the demo's development configuration.
    const configFile = fileURLToPath(
      new URL('../vite.config.ts', import.meta.url)
    )

    // When: the effective serve configuration is loaded.
    const config = await resolveConfig({ configFile }, 'serve', 'development')

    // Then: PaddleOCR bypasses dependency prebundling, preserving its dist/assets URL.
    expect(config.optimizeDeps.include).not.toContain('@paddleocr/paddleocr-js')
    expect(config.optimizeDeps.exclude).toContain('@paddleocr/paddleocr-js')
    expect(config.optimizeDeps.include).toContain('@techstark/opencv-js')
  })
})

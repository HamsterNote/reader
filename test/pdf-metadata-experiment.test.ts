import { fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPdfMetadataExperiment } from '../webview/src/pdfMetadataExperiment'
import { parsePdfMetadataExperimentConfig } from '../webview/src/pdfMetadataExperimentConfig'
import { createPdfTextModeDocument } from '../src/pdf/pdfTextModeDocument'
import type { PDFDocumentProxy, PDFPageProxy } from '../src/pdf/pdfjsRuntime'

afterEach(() => vi.restoreAllMocks())

describe('metadata diagnostic build opt-in', () => {
  it('defaults to the original all-pages path without pause hooks', () => {
    const config = parsePdfMetadataExperimentConfig({})
    expect(config).toEqual({
      enabled: false,
      metadataOnly: false,
      batchSize: 0
    })
    const experiment = createPdfMetadataExperiment(config, {
      event: vi.fn(),
      viewer: vi.fn()
    })
    expect(experiment.openOptions.loadPdfPages).toBeUndefined()
    expect(experiment.openOptions.afterPdfOpen).toBeUndefined()
    expect(experiment.openOptions.afterPdfMetadata).toBeUndefined()
    expect(screen.queryByRole('region')).toBeNull()
    experiment.cancel()
  })

  it.each(['8', '1'])(
    'rejects batch %s without the explicit diagnostics master switch',
    (batch) => {
      expect(() =>
        parsePdfMetadataExperimentConfig({
          VITE_READER_PDF_METADATA_BATCH_SIZE: batch
        })
      ).toThrow('DIAGNOSTICS=1')
    }
  )

  it.each(['-1', '2', '8.0', 'NaN', ''])(
    'rejects invalid batch size %s',
    (batch) => {
      expect(() =>
        parsePdfMetadataExperimentConfig({
          VITE_READER_PDF_METADATA_DIAGNOSTICS: '1',
          VITE_READER_PDF_METADATA_BATCH_SIZE: batch
        })
      ).toThrow('BATCH_SIZE')
    }
  )

  it('requires the master switch for metadata-only, and validates boolean flags', () => {
    expect(() =>
      parsePdfMetadataExperimentConfig({ VITE_READER_PDF_METADATA_ONLY: '1' })
    ).toThrow('DIAGNOSTICS=1')
    expect(() =>
      parsePdfMetadataExperimentConfig({
        VITE_READER_PDF_METADATA_DIAGNOSTICS: 'yes'
      })
    ).toThrow('DIAGNOSTICS/ONLY')
    expect(() =>
      parsePdfMetadataExperimentConfig({
        VITE_READER_PDF_METADATA_DIAGNOSTICS: '1',
        VITE_READER_PDF_METADATA_ONLY: 'yes'
      })
    ).toThrow('DIAGNOSTICS/ONLY')
  })
})

describe('bounded metadata loader', () => {
  it.each([0, 8, 1] as const)(
    'retains all ordered page geometry with batch=%s and leaves text lazy',
    async (batchSize) => {
      const event = vi.fn()
      const experiment = createPdfMetadataExperiment(
        { enabled: true, metadataOnly: false, batchSize },
        { event, viewer: vi.fn() }
      )
      let active = 0
      let peak = 0
      const getTextContent = vi.fn()
      const getPage = vi.fn(async (pageNumber: number) => {
        active++
        peak = Math.max(peak, active)
        await Promise.resolve()
        active--
        return {
          getViewport: () => ({ width: pageNumber * 100, height: 200 }),
          getTextContent
        } as unknown as PDFPageProxy
      })
      const pdf = { numPages: 19, getPage } as unknown as PDFDocumentProxy
      const facade = await createPdfTextModeDocument(
        pdf,
        'metadata-test',
        experiment.openOptions.loadPdfPages
      )
      expect(getPage.mock.calls.map(([number]) => number)).toEqual(
        Array.from({ length: 19 }, (_, index) => index + 1)
      )
      expect(peak).toBe(batchSize || 19)
      expect(getTextContent).not.toHaveBeenCalled()
      expect(facade.document.getPageSizeByPageNumber(19)).toEqual({
        x: 1900,
        y: 200
      })
      expect(event).toHaveBeenCalledWith('metadata-experiment-config', {
        batchSize,
        metadataOnly: false
      })
      experiment.cancel()
    }
  )

  it('does not start later batches after cancellation', async () => {
    const experiment = createPdfMetadataExperiment(
      { enabled: true, metadataOnly: false, batchSize: 1 },
      { event: vi.fn(), viewer: vi.fn() }
    )
    let finish!: (page: PDFPageProxy) => void
    const getPage = vi.fn(
      () =>
        new Promise<PDFPageProxy>((resolve) => {
          finish = resolve
        })
    )
    const pending = experiment.openOptions.loadPdfPages!({
      numPages: 19,
      getPage
    } as unknown as PDFDocumentProxy)
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError'
    })
    experiment.cancel()
    finish({} as PDFPageProxy)
    await rejected
    expect(getPage).toHaveBeenCalledOnce()
  })
})

describe('metadata-only manual gates', () => {
  it('stays paused at each checkpoint until the explicit button, and cleans up on cancel', async () => {
    const event = vi.fn()
    const experiment = createPdfMetadataExperiment(
      { enabled: true, metadataOnly: true, batchSize: 8 },
      { event, viewer: vi.fn() }
    )
    const resumed = vi.fn()
    const first = experiment.openOptions.afterPdfOpen!().then(resumed)
    await Promise.resolve()
    expect(resumed).not.toHaveBeenCalled()
    expect(screen.getByRole('region')).toHaveAttribute(
      'data-pdf-metadata-checkpoint',
      'open'
    )
    expect(event).toHaveBeenCalledWith('metadata-only-open-paused', {
      batchSize: 8
    })
    fireEvent.click(screen.getByText('开始元数据'))
    await first
    expect(resumed).toHaveBeenCalledOnce()
    expect(screen.queryByRole('region')).toBeNull()
    const second = experiment.openOptions.afterPdfMetadata!()
    const rejected = expect(second).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(screen.getByRole('region')).toHaveAttribute(
      'data-pdf-metadata-checkpoint',
      'complete'
    )
    experiment.cancel()
    await rejected
    expect(screen.queryByRole('region')).toBeNull()
    expect(() => experiment.openOptions.afterPdfOpen!()).toThrow()
  })
})

// @vitest-environment node
//
// HAM-89 / tasks.md 3.5：损坏文件错误、取消加载、worker 销毁、切文件竞态。
// 用真实 pdfjs-dist 在 node 环境验证（不渲染页面，只走加载/销毁链路）。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'
import {
  pdfWithIsolatedContents,
  readBrokenOperatorList
} from './range-failure'
import { PDFDataRangeTransport } from 'pdfjs-dist'
import * as pdfjsRuntime from '../../src/pdf/pdfjsRuntime'

import {
  PdfDocumentOpenError,
  PdfDocumentSession,
  PdfSessionManager,
  classifyPdfOpenError
} from '../../src/pdf/pdfDocumentSession'

const FIXTURE_ROOT = join(__dirname, '../compat/fixtures')

function readFixture(relativePath: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURE_ROOT, relativePath)))
}

class TestRange extends PDFDataRangeTransport {
  fail!: (reason: Error) => void
  readonly failure = new Promise<never>((_, reject) => {
    this.fail = reject
  })
  override abort = vi.fn()
  override requestDataRange = vi.fn((begin: number, end: number) => {
    queueMicrotask(() => this.onDataRange(begin, this.bytes.slice(begin, end)))
  })
  constructor(private readonly bytes: Uint8Array) {
    super(bytes.length, bytes.slice(0, 128), true)
  }
}

describe('PdfDocumentSession', () => {
  it.each([
    { mode: 'standalone', concurrent: false, errors: 2 },
    { mode: 'concurrent', concurrent: true, errors: 4 }
  ])(
    'rejects the $mode operator list on page two with the range error',
    async ({ concurrent, errors }) => {
      expect(await readBrokenOperatorList(concurrent)).toEqual({
        originalErrors: errors,
        aborts: 1,
        disposed: true
      })
    }
  )
  it('rejects a pending text read and finishes disposal on the first post-open range failure', async () => {
    const range = new TestRange(await pdfWithIsolatedContents())
    const session = await PdfDocumentSession.open(
      { createRange: () => range },
      {
        documentOptions: { disableStream: true, disableAutoFetch: true }
      }
    )
    const page = await session.document.getPage(2)
    const error = new Error('snapshot replaced after open')
    range.requestDataRange.mockImplementation(() => range.fail(error))
    const other = await PdfDocumentSession.open({
      data: readFixture('pdf/rotated.pdf')
    })
    try {
      const reads = [
        page.getTextContent(),
        page.getTextContent(),
        session.document.getDownloadInfo()
      ]
      for (const read of await Promise.allSettled(reads)) {
        expect(read).toEqual({ status: 'rejected', reason: error })
      }
      expect(session.isDisposed).toBe(true)
      const closing = session.dispose()
      expect(session.dispose()).toBe(closing)
      await closing
      expect(range.abort).toHaveBeenCalledOnce()
      expect((await other.document.getPage(1)).pageNumber).toBe(1)
    } finally {
      await other.dispose()
      await session.dispose()
    }
  })

  it('aborts a pre-rejected range before PDF.js takes ownership', async () => {
    const range = new TestRange(readFixture('pdf/two-column.pdf'))
    const error = new Error('already failed')
    range.fail(error)
    await expect(
      PdfDocumentSession.open({ createRange: () => range })
    ).rejects.toMatchObject({ cause: error })
    expect(range.requestDataRange).not.toHaveBeenCalled()
    expect(range.abort).toHaveBeenCalledOnce()
  })

  it('shares cleanup when range failure races external cancellation', async () => {
    const range = new TestRange(readFixture('pdf/two-column.pdf'))
    const controller = new AbortController()
    range.requestDataRange.mockImplementation(() => {
      range.fail(new Error('snapshot replaced'))
      controller.abort()
    })
    const getDocument = pdfjsRuntime.getDocument
    const load = vi
      .spyOn(pdfjsRuntime, 'getDocument')
      .mockImplementation((input) => {
        const task = getDocument(input)
        vi.spyOn(task, 'destroy')
        return task
      })
    try {
      await expect(
        PdfDocumentSession.open(
          { createRange: () => range },
          { signal: controller.signal }
        )
      ).rejects.toBeInstanceOf(PdfDocumentOpenError)
      expect(range.abort).toHaveBeenCalledOnce()
      expect(load.mock.results[0].value.destroy).toHaveBeenCalledOnce()
    } finally {
      load.mockRestore()
    }
  })

  it('区间读取失败会结束等待并释放 PDF.js 传输', async () => {
    const { PDFDataRangeTransport } = await import('pdfjs-dist')
    class UnavailableRange extends PDFDataRangeTransport {
      private reject!: (error: Error) => void
      failure = new Promise<never>((_, reject) => {
        this.reject = reject
      })
      override requestDataRange() {
        this.reject(new Error('snapshot replaced'))
      }
      override abort = vi.fn()
    }
    const range = new UnavailableRange(200_000, new Uint8Array(), true)
    await expect(
      PdfDocumentSession.open({ createRange: () => range })
    ).rejects.toMatchObject({ message: 'snapshot replaced' })
    expect(range.abort).toHaveBeenCalledOnce()
  })

  it('正常打开：页数可读，dispose 后文档销毁且幂等', async () => {
    const session = await PdfDocumentSession.open({
      data: readFixture('pdf/two-column.pdf')
    })
    expect(session.document.numPages).toBe(2)

    await session.dispose()
    expect(session.isDisposed).toBe(true)
    // 销毁后文档不可用（worker 已销毁；pdf.js 此处为同步抛错）。
    expect(() => session.document.getPage(1)).toThrow()

    // 重复 dispose 幂等，不抛错。
    await session.dispose()
    expect(session.isDisposed).toBe(true)
  })

  it('损坏文件：kind=corrupt，message 可读', async () => {
    const garbage = new TextEncoder().encode('not a pdf at all')
    const error = await PdfDocumentSession.open({ data: garbage }).catch(
      (cause: unknown) => cause
    )
    expect(error).toBeInstanceOf(PdfDocumentOpenError)
    expect((error as PdfDocumentOpenError).kind).toBe('corrupt')
    expect((error as PdfDocumentOpenError).message.length).toBeGreaterThan(0)
  })

  it('打开前已 abort：立即以 cancelled 拒绝', async () => {
    const controller = new AbortController()
    controller.abort()
    const error = await PdfDocumentSession.open(
      { data: readFixture('pdf/two-column.pdf') },
      { signal: controller.signal }
    ).catch((cause: unknown) => cause)
    expect((error as PdfDocumentOpenError).kind).toBe('cancelled')
  })

  it('加载中 abort：取消加载并以 cancelled 拒绝', async () => {
    const controller = new AbortController()
    const pending = PdfDocumentSession.open(
      { data: readFixture('pdf/two-column.pdf') },
      { signal: controller.signal }
    )
    controller.abort()
    const error = await pending.catch((cause: unknown) => cause)
    expect((error as PdfDocumentOpenError).kind).toBe('cancelled')
  })

  it('classifyPdfOpenError 覆盖已知错误名', () => {
    expect(classifyPdfOpenError({ name: 'InvalidPDFException' })).toBe(
      'corrupt'
    )
    expect(classifyPdfOpenError({ name: 'PasswordException' })).toBe(
      'password-required'
    )
    expect(classifyPdfOpenError({ name: 'AbortException' })).toBe('cancelled')
    expect(classifyPdfOpenError({ name: 'MissingPDFException' })).toBe(
      'network'
    )
    expect(classifyPdfOpenError(new Error('boom'))).toBe('unknown')
  })
})

describe('PdfSessionManager 切文件竞态', () => {
  it('加载 A 后立即切 B：旧结果销毁且不交付，B 正常可用', async () => {
    const manager = new PdfSessionManager()
    const openA = manager.open({ data: readFixture('pdf/two-column.pdf') })
    const openB = manager.open({ data: readFixture('pdf/ligature.pdf') })

    const [resultA, resultB] = await Promise.allSettled([openA, openB])

    // A 被 B 取代：要么 cancelled 拒绝，要么其 session 已被销毁。
    if (resultA.status === 'rejected') {
      expect((resultA.reason as PdfDocumentOpenError).kind).toBe('cancelled')
    } else {
      expect(resultA.value.session.isDisposed).toBe(true)
    }

    expect(resultB.status).toBe('fulfilled')
    const sessionB = (
      resultB as PromiseFulfilledResult<{ session: PdfDocumentSession }>
    ).value.session
    expect(sessionB.document.numPages).toBe(1)
    expect(manager.currentSession).toBe(sessionB)
    expect(manager.currentSession!.isDisposed).toBe(false)

    await manager.dispose()
    expect(sessionB.isDisposed).toBe(true)
  })

  it('open 失败保留旧会话（不得清空既有内容）', async () => {
    const manager = new PdfSessionManager()
    const { session: sessionA } = await manager.open({
      data: readFixture('pdf/rotated.pdf')
    })

    const error = await manager
      .open({ data: new TextEncoder().encode('corrupted') })
      .catch((cause: unknown) => cause)
    expect((error as PdfDocumentOpenError).kind).toBe('corrupt')

    // 旧会话仍然存活，管理器仍持有它。
    expect(manager.currentSession).toBe(sessionA)
    expect(sessionA.isDisposed).toBe(false)

    await manager.dispose()
  })

  it('close 释放当前会话但管理器可继续打开', async () => {
    const manager = new PdfSessionManager()
    const { session } = await manager.open({
      data: readFixture('pdf/two-column.pdf')
    })
    await manager.close()
    expect(session.isDisposed).toBe(true)
    expect(manager.currentSession).toBeNull()

    const reopened = await manager.open({
      data: readFixture('pdf/ligature.pdf')
    })
    expect(reopened.session.document.numPages).toBe(1)
    await manager.dispose()
  })

  it('dispose waits for an in-flight open and its eventual resource destruction', async () => {
    const destroyed = vi.spyOn(PdfDocumentSession.prototype, 'dispose')
    try {
      const manager = new PdfSessionManager()
      const opening = manager
        .open({ data: readFixture('pdf/two-column.pdf') })
        .catch((error) => error)
      await manager.dispose()
      expect((await opening).kind).toBe('cancelled')
      expect(destroyed).toHaveBeenCalledOnce()
      expect(manager.currentSession).toBeNull()
    } finally {
      destroyed.mockRestore()
    }
  })

  it('dispose 后拒绝新的 open', async () => {
    const manager = new PdfSessionManager()
    await manager.dispose()
    const error = await manager
      .open({ data: readFixture('pdf/two-column.pdf') })
      .catch((cause: unknown) => cause)
    expect((error as PdfDocumentOpenError).kind).toBe('cancelled')
  })
})

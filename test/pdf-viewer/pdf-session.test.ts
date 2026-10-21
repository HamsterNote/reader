// @vitest-environment node
//
// HAM-89 / tasks.md 3.5：损坏文件错误、取消加载、worker 销毁、切文件竞态。
// 用真实 pdfjs-dist 在 node 环境验证（不渲染页面，只走加载/销毁链路）。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

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

describe('PdfDocumentSession', () => {
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

  it('dispose 后拒绝新的 open', async () => {
    const manager = new PdfSessionManager()
    await manager.dispose()
    const error = await manager
      .open({ data: readFixture('pdf/two-column.pdf') })
      .catch((cause: unknown) => cause)
    expect((error as PdfDocumentOpenError).kind).toBe('cancelled')
  })
})

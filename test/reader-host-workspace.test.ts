import { describe, expect, it, vi } from 'vitest'
import { createReaderHostWorkspace } from '../src/host/readerHostWorkspace'
import {
  parseReaderSessionReplacement,
  type ReaderSessionReplacement
} from '../src/bridge/sessionReplacement'
import type { BridgeMessage } from '../src/bridge/protocol'

const raw = (sessionId: string, type: string, payload: unknown = {}) =>
  JSON.stringify({
    version: 1,
    sourceToken: 'trusted',
    sessionId,
    requestId: `${sessionId}-${type}`,
    type,
    payload
  })
const descriptor = {
  fileId: 'a',
  format: 'pdf' as const,
  fileUrl: 'file:///a.pdf'
}

describe('same-container bridge rollover', () => {
  it('waits for old ACK/close, then starts a new isolated document session', async () => {
    const sent: BridgeMessage[] = [],
      replacements: ReaderSessionReplacement[] = []
    const workspace = createReaderHostWorkspace({
      sessionId: 'a',
      sourceToken: 'trusted',
      reload: async () => {},
      descriptor,
      confirmedSnapshot: null,
      persist: async () => {},
      sendToWeb: (message) => sent.push(message),
      sendReplacement: (message) => replacements.push(message)
    })
    await workspace.handleRawMessage(raw('a', 'ready'))
    const replacing = workspace.replaceDocument(
      {
        sessionId: 'b',
        descriptor: { ...descriptor, fileId: 'b', format: 'epub' },
        confirmedSnapshot: null,
        persist: async () => {}
      },
      1000
    )
    expect(sent.at(-1)?.type).toBe('command')
    expect(replacements).toEqual([])
    await workspace.handleRawMessage(raw('a', 'ready'))
    await vi.waitFor(() => expect(replacements).toHaveLength(1))
    await expect(
      workspace.replaceDocument({
        sessionId: 'c',
        descriptor,
        confirmedSnapshot: null,
        persist: async () => {}
      })
    ).rejects.toThrow('pending')
    await workspace.handleRawMessage(raw('b', 'document-ready'))
    expect(await replacing).toEqual({ status: 'replaced' })
    expect(sent.at(-1)?.type).toBe('dispose')
    expect(replacements).toHaveLength(1)
    expect(
      parseReaderSessionReplacement(replacements[0], {
        sessionId: 'a',
        sourceToken: 'trusted'
      })
    ).not.toBeNull()
    expect(
      (
        await workspace.handleRawMessage(
          raw('a', 'change', { revision: 1, data: { stale: true } })
        )
      ).accepted
    ).toBe(false)
    await workspace.handleRawMessage(raw('b', 'ready'))
    expect(sent.slice(-2).map((message) => message.type)).toEqual([
      'open',
      'restore'
    ])
    expect(sent.at(-1)?.sessionId).toBe('b')
    expect(workspace.getSession().getSnapshot().data).toBeNull()
  })
  it('does not replace or dispose when saving cannot be confirmed', async () => {
    const sent: BridgeMessage[] = [],
      replacements: ReaderSessionReplacement[] = []
    const workspace = createReaderHostWorkspace({
      sessionId: 'a',
      sourceToken: 'trusted',
      reload: async () => {},
      descriptor,
      confirmedSnapshot: null,
      persist: async () => {},
      sendToWeb: (message) => sent.push(message),
      sendReplacement: (message) => replacements.push(message)
    })
    await workspace.handleRawMessage(raw('a', 'ready'))
    expect(
      await workspace.replaceDocument(
        {
          sessionId: 'b',
          descriptor,
          confirmedSnapshot: null,
          persist: async () => {}
        },
        5
      )
    ).toMatchObject({ status: 'unconfirmed' })
    expect(replacements).toEqual([])
    expect(sent.some((message) => message.type === 'dispose')).toBe(false)
    expect(
      (
        await workspace.handleRawMessage(
          raw('a', 'change', { data: { retained: true }, revision: 1 })
        )
      ).accepted
    ).toBe(true)
  })
  it('only current document failures reload once; close errors and stale messages do not', async () => {
    const reload = vi.fn(async () => {})
    const workspace = createReaderHostWorkspace({
      sessionId: 'a',
      sourceToken: 'trusted',
      descriptor,
      confirmedSnapshot: null,
      persist: async () => {},
      sendToWeb: () => {},
      sendReplacement: () => {},
      reload
    })
    await workspace.handleRawMessage(raw('a', 'ready'))
    await workspace.handleRawMessage(
      raw('old', 'error', {
        code: 'ENGINE_FAILURE',
        stage: 'document',
        message: 'stale'
      })
    )
    await workspace.handleRawMessage(
      raw('a', 'error', { code: 'ENGINE_FAILURE', message: 'save timeout' })
    )
    expect(reload).not.toHaveBeenCalled()
    await workspace.handleRawMessage(
      raw('a', 'error', {
        code: 'ENGINE_FAILURE',
        stage: 'document',
        message: 'load failed'
      })
    )
    await workspace.handleRawMessage(
      raw('a', 'error', {
        code: 'ENGINE_FAILURE',
        stage: 'document',
        message: 'duplicate'
      })
    )
    expect(reload).toHaveBeenCalledExactlyOnceWith(descriptor, 'load failed')
  })
  it('new document restore failure falls back once and never reports replacement success', async () => {
    const reload = vi.fn(async () => {}),
      replacement = vi.fn()
    const workspace = createReaderHostWorkspace({
      sessionId: 'a',
      sourceToken: 'trusted',
      descriptor,
      confirmedSnapshot: null,
      persist: async () => {},
      sendToWeb: () => {},
      sendReplacement: replacement,
      reload
    })
    await workspace.handleRawMessage(raw('a', 'ready'))
    const replacing = workspace.replaceDocument({
      sessionId: 'b',
      descriptor,
      confirmedSnapshot: null,
      persist: async () => {}
    })
    await workspace.handleRawMessage(raw('a', 'ready'))
    await vi.waitFor(() => expect(replacement).toHaveBeenCalledOnce())
    await workspace.handleRawMessage(
      raw('b', 'error', {
        code: 'ENGINE_FAILURE',
        stage: 'document',
        message: 'restore failed'
      })
    )
    expect(await replacing).toEqual({ status: 'reloaded' })
    expect(reload).toHaveBeenCalledOnce()
    await workspace.handleRawMessage(
      raw('b', 'error', {
        code: 'ENGINE_FAILURE',
        stage: 'document',
        message: 'duplicate'
      })
    )
    expect(reload).toHaveBeenCalledOnce()
  })
  it('rejects forged source, stale generation, repeated session and malformed messages', () => {
    const message = {
      type: 'reader:replace-session',
      version: 1,
      previousSessionId: 'a',
      sessionId: 'b',
      requestId: 'r',
      sourceToken: 'trusted'
    }
    const current = { sessionId: 'a', sourceToken: 'trusted' }
    for (const invalid of [
      null,
      '{',
      { ...message, sourceToken: 'foreign' },
      { ...message, previousSessionId: 'old' },
      { ...message, sessionId: 'a' },
      { ...message, version: 2 }
    ])
      expect(parseReaderSessionReplacement(invalid, current)).toBeNull()
    expect(
      parseReaderSessionReplacement(JSON.stringify(message), current)
    ).toEqual(message)
  })
})

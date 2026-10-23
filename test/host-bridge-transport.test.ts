import { describe, expect, it } from 'vitest'

import { parseHostBridgeTransport } from '../src/host/bridgeTransport'

const sourceToken = 'test-token'

function envelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    sessionId: 'session-1',
    requestId: 'request-1',
    type: 'ready',
    payload: {},
    sourceToken,
    ...overrides
  })
}

describe('parseHostBridgeTransport', () => {
  it('accepts a well-formed envelope with the host token', () => {
    const result = parseHostBridgeTransport(envelope(), { sourceToken })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.message.type).toBe('ready')
      expect(result.message.sessionId).toBe('session-1')
    }
  })

  it('rejects a forged message without the host token', () => {
    const result = parseHostBridgeTransport(
      envelope({ sourceToken: 'attacker' }),
      { sourceToken }
    )
    expect(result).toMatchObject({ ok: false, code: 'INVALID_MESSAGE' })
  })

  it('rejects unknown types and missing envelope fields', () => {
    expect(
      parseHostBridgeTransport(envelope({ type: 'persistWhatever' }), {
        sourceToken
      })
    ).toMatchObject({ ok: false, code: 'INVALID_MESSAGE' })
    expect(
      parseHostBridgeTransport(envelope({ sessionId: '' }), { sourceToken })
    ).toMatchObject({ ok: false, code: 'INVALID_MESSAGE' })
  })

  it('rejects malformed JSON, arrays and non-string input', () => {
    for (const input of ['{', '[]', null, 42, { type: 'ready' }]) {
      expect(parseHostBridgeTransport(input, { sourceToken })).toMatchObject({
        ok: false,
        code: 'INVALID_MESSAGE'
      })
    }
  })

  it('rejects oversized payloads before parsing', () => {
    const huge = envelope({ payload: { blob: 'x'.repeat(1024) } })
    expect(
      parseHostBridgeTransport(huge, {
        sourceToken,
        maxBytes: 512
      })
    ).toMatchObject({ ok: false, code: 'INVALID_MESSAGE' })
  })
})

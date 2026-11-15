import { describe, expect, it, vi } from 'vitest'
import { enqueueRecoverableSave } from '../../src/nativePdf/persistence'

describe('native snapshot persistence queue', () => {
  it('does not poison retry after a failed write', async () => {
    const save = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('injected failure'))
      .mockResolvedValueOnce(2)

    const first = enqueueRecoverableSave(Promise.resolve(), save)
    await expect(first).rejects.toThrow('injected failure')

    const retry = enqueueRecoverableSave(first, save)
    await expect(retry).resolves.toBe(2)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('keeps writes ordered when a retry follows a failed attempt', async () => {
    const order: string[] = []
    const first = enqueueRecoverableSave(Promise.resolve(), async () => {
      order.push('failed')
      throw new Error('failed')
    })
    await first.catch(() => undefined)

    const retry = enqueueRecoverableSave(first, async () => {
      order.push('retried')
    })
    await retry
    expect(order).toEqual(['failed', 'retried'])
  })
})

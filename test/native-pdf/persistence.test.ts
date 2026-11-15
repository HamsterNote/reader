import { describe, expect, it, vi } from 'vitest'
import {
  enqueueRecoverableSave,
  NativeOperationQueue
} from '../../src/nativePdf/persistence'

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

  it('keeps failed and later operations ordered while sharing a retry attempt', async () => {
    const order: string[] = []
    let fail = true
    const queue = new NativeOperationQueue<string>({
      onConfirmed: (operation) =>
        order.push(`confirmed:${operation.operationId}`),
      onFailed: (operation) => order.push(`failed:${operation.operationId}`)
    })
    const first = queue.add('first', async () => {
      order.push('execute:first')
      if (fail) throw new Error('failed')
      return 'first-result'
    })
    const second = queue.add('second', async () => {
      order.push('execute:second')
      return 'second-result'
    })
    await expect(queue.drain()).rejects.toThrow('failed')
    expect(queue.head?.operationId).toBe('first')
    expect(second.status).toBe('pending')

    fail = false
    const retry = queue.retry()
    expect(queue.retry()).toBe(retry)
    await retry
    await queue.drain()
    expect(first.attempt).toBe(2)
    expect(second.attempt).toBe(1)
    expect(queue.pending).toBe(0)
    expect(order).toEqual([
      'execute:first',
      'failed:first',
      'execute:first',
      'confirmed:first',
      'execute:second',
      'confirmed:second'
    ])
  })
})

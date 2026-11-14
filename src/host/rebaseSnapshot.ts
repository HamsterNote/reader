import type { BridgeHostSnapshot } from '../bridge/hostSession'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const equal = (left: unknown, right: unknown): boolean => {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return Object.is(left, right)
  }
}

function patchValue(
  current: unknown,
  previous: unknown,
  next: unknown
): unknown {
  if (!isRecord(previous) || !isRecord(next)) return next
  const result = isRecord(current) ? { ...current } : {}
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)])
  for (const key of keys) {
    const hadNext = Object.prototype.hasOwnProperty.call(next, key)
    const hadPrevious = Object.prototype.hasOwnProperty.call(previous, key)
    if (hadNext && (!hadPrevious || !equal(next[key], previous[key]))) {
      result[key] = patchValue(result[key], previous[key], next[key])
    } else if (!hadNext && hadPrevious) {
      delete result[key]
    }
  }
  return result
}

/** Apply only fields changed by a stale session onto the latest snapshot. */
export function rebaseSnapshot(
  current: BridgeHostSnapshot,
  previous: BridgeHostSnapshot,
  next: BridgeHostSnapshot
): BridgeHostSnapshot {
  return {
    data: equal(next.data, previous.data)
      ? current.data
      : patchValue(current.data, previous.data, next.data),
    progress: equal(next.progress, previous.progress)
      ? current.progress
      : next.progress,
    revision: current.revision + 1
  }
}

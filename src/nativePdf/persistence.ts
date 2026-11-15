/**
 * Chain a snapshot write after the previous attempt, regardless of whether
 * that attempt rejected. A rejected promise must not poison the queue: the
 * next user retry still has to reach the storage adapter.
 */
export function enqueueRecoverableSave<T>(
  previous: Promise<unknown>,
  task: () => Promise<T>
): Promise<T> {
  return previous.catch(() => undefined).then(task)
}

/**
 * Simple async mutex for TON wallet transactions.
 * Ensures the seqno read → sendTransfer sequence is atomic,
 * preventing two concurrent calls from getting the same seqno.
 */
let pending: Promise<void> = Promise.resolve();

export function withTxLock<T>(fn: () => Promise<T>): Promise<T> {
  // There is no safe way to time out fn(): wallet SDK calls do not expose a
  // cancellation guarantee. Releasing the mutex early lets a second operation
  // reuse seqno while the first one is still broadcasting. Hold it until the
  // underlying operation actually settles; network calls own their timeouts.
  const execute = pending.then(fn, fn);
  pending = execute.then(
    () => {},
    () => {}
  );
  return execute;
}

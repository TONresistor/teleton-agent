/**
 * Simple async mutex for TON wallet transactions.
 * Ensures the seqno read → sendTransfer sequence is atomic,
 * preventing two concurrent calls from getting the same seqno.
 */
let pending: Promise<void> = Promise.resolve();

export function withTxLock<T>(fn: () => Promise<T>): Promise<T> {
  const execute = pending.then(fn, fn);
  pending = execute.then(
    () => {},
    () => {}
  );
  return execute;
}

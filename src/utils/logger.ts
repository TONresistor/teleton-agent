/**
 * Verbose logger - suppresses debug logs unless TELETON_LOG=verbose or toggled via /verbose
 */
let _verbose = process.env.TELETON_LOG === "verbose";

export function verbose(...args: unknown[]): void {
  if (_verbose) console.log(...args);
}

export function setVerbose(v: boolean): void {
  _verbose = v;
}

export function isVerbose(): boolean {
  return _verbose;
}

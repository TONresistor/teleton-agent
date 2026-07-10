/**
 * Prefixed logger for plugin output.
 * All methods prepend the plugin name automatically.
 */
export interface PluginLogger {
  /** Log informational message. Output: [plugin-name] message */
  info(...args: unknown[]): void;
  /** Log warning. Output: [plugin-name] message */
  warn(...args: unknown[]): void;
  /** Log error. Output: [plugin-name] message */
  error(...args: unknown[]): void;
  /** Log debug message (only visible when DEBUG or VERBOSE env vars are set) */
  debug(...args: unknown[]): void;
}

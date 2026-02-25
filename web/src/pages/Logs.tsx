import { useEffect, useRef, useSyncExternalStore } from 'react';
import { logStore } from '../lib/log-store';

export function Logs() {
  const logs = useSyncExternalStore(
    (cb) => logStore.subscribe(cb),
    () => logStore.getLogs()
  );
  const connected = useSyncExternalStore(
    (cb) => logStore.subscribe(cb),
    () => logStore.isConnected()
  );
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logStore.connect();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div>
      <div className="header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>Live Logs</h1>
            <p>
              <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
              {connected ? 'Connected' : 'Disconnected'}
            </p>
          </div>
          <button onClick={() => logStore.clear()}>Clear</button>
        </div>
      </div>

      <div style={{ height: 'calc(100vh - 160px)', overflow: 'auto' }}>
        {logs.length === 0 ? (
          <div className="empty">Waiting for logs...</div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="log-entry">
              <span className={`badge ${log.level === 'warn' ? 'warn' : log.level === 'error' ? 'error' : 'info'}`}>
                {log.level.toUpperCase()}
              </span>{' '}
              <span style={{ color: 'var(--text-tertiary)' }}>
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>{' '}
              {log.message}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

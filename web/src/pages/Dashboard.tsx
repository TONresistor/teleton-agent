import { useEffect, useState } from 'react';
import { api, StatusData, MemoryStats } from '../lib/api';

export function Dashboard() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getStatus(), api.getMemoryStats()])
      .then(([statusRes, statsRes]) => {
        setStatus(statusRes.data);
        setStats(statsRes.data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return <div className="alert error">{error}</div>;
  if (!status || !stats) return <div className="alert error">Failed to load dashboard data</div>;

  return (
    <div>
      <div className="header">
        <h1>Dashboard</h1>
        <p>System status and statistics</p>
      </div>

      <div className="stats">
        <div className="stat-card">
          <h3>Uptime</h3>
          <div className="value">{Math.floor(status.uptime / 60)}m</div>
        </div>
        <div className="stat-card">
          <h3>Model</h3>
          <div className="value" style={{ fontSize: '14px' }}>
            {status.model}
          </div>
        </div>
        <div className="stat-card">
          <h3>Sessions</h3>
          <div className="value">{status.sessionCount}</div>
        </div>
        <div className="stat-card">
          <h3>Tools</h3>
          <div className="value">{status.toolCount}</div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Memory</div>
        <div className="stats" style={{ marginBottom: 0 }}>
          <div className="stat-card">
            <h3>Knowledge</h3>
            <div className="value">{stats.knowledge}</div>
          </div>
          <div className="stat-card">
            <h3>Messages</h3>
            <div className="value">{stats.messages}</div>
          </div>
          <div className="stat-card">
            <h3>Chats</h3>
            <div className="value">{stats.chats}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

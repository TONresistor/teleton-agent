import { useEffect, useState } from 'react';
import { api, type TokenActivityBucket, type TokenActivityPeriod } from '../lib/api';

const PERIODS: { value: TokenActivityPeriod; label: string; count: number }[] = [
  { value: 'day', label: 'Daily', count: 24 },
  { value: 'week', label: 'Weekly', count: 168 },
  { value: 'month', label: '30 days', count: 30 },
];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function level(tokens: number, max: number): number {
  if (tokens <= 0 || max <= 0) return 0;
  return Math.max(1, Math.ceil((tokens / max) * 4));
}

function Square({ bucket, max }: { bucket: TokenActivityBucket; max: number }) {
  const label = `${bucket.label} · ${bucket.tokens.toLocaleString()} tokens`;
  return (
    <span
      className={`dash-token-square level-${level(bucket.tokens, max)}`}
      title={label}
      aria-label={label}
    />
  );
}

export function TokenActivity() {
  const [period, setPeriod] = useState<TokenActivityPeriod>('week');
  const [buckets, setBuckets] = useState<TokenActivityBucket[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setBuckets(null);
    setError(false);
    const refresh = () => {
      api.getTokenActivity(period)
        .then((result) => {
          if (active) { setBuckets(result.data ?? []); setError(false); }
        })
        .catch(() => { if (active) setError(true); });
    };
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [period]);

  const expected = PERIODS.find((option) => option.value === period)?.count ?? 0;
  const cells = buckets ?? Array.from({ length: expected }, () => ({ label: '', tokens: 0 }));
  const max = Math.max(0, ...cells.map((bucket) => bucket.tokens));
  const total = cells.reduce((sum, bucket) => sum + bucket.tokens, 0);

  return (
    <div className="dash-token-activity">
      <div className="dash-token-activity-head">
        <span className="dash-token-activity-title">Token activity</span>
        <div className="dash-token-periods" role="group" aria-label="Token activity period">
          {PERIODS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={period === option.value ? 'active' : ''}
              aria-pressed={period === option.value}
              onClick={() => setPeriod(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="dash-token-plot">
        {period === 'week' ? (
          <div className="dash-token-week">
            {Array.from({ length: 7 }, (_, day) => {
              const row = cells.slice(day * 24, (day + 1) * 24);
              return (
                <div className="dash-token-week-row" key={day}>
                  <span className="dash-token-week-label">{WEEKDAYS[day]}</span>
                  <div className="dash-token-squares dash-token-squares--week">
                    {row.map((bucket, hour) => <Square key={hour} bucket={bucket} max={max} />)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="dash-token-scroll">
            <div className={`dash-token-squares dash-token-squares--${period}`}>
              {cells.map((bucket, index) => <Square key={index} bucket={bucket} max={max} />)}
            </div>
            <div className="dash-token-axis">
              <span>{period === 'day' ? '00:00' : cells[0]?.label.slice(5) || '30 days ago'}</span>
              <span>{period === 'day' ? '23:00' : cells.at(-1)?.label.slice(5) || 'Today'}</span>
            </div>
          </div>
        )}
      </div>

      <div className="dash-token-activity-footer">
        <span>{error ? 'Activity unavailable' : buckets ? `${total.toLocaleString()} input + output tokens` : 'Loading activity…'}</span>
        <span className="dash-token-legend" aria-hidden="true">Less <i className="level-0" /><i className="level-1" /><i className="level-2" /><i className="level-3" /><i className="level-4" /> More</span>
      </div>
    </div>
  );
}

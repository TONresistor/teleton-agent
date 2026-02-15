import { useState } from 'react';
import { api, SearchResult } from '../lib/api';

export function Memory() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const search = async () => {
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const res = await api.searchKnowledge(query);
      setResults(res.data);
      setHasSearched(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="header">
        <h1>Memory</h1>
        <p>Search knowledge base</p>
      </div>

      <div className="card">
        <div className="form-group">
          <label>Search query</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              placeholder="Enter search query..."
              style={{ flex: 1 }}
            />
            <button onClick={search} disabled={loading}>
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>

        {error && <div className="alert error">{error}</div>}

        {hasSearched && results.length === 0 && !error && (
          <div style={{ marginTop: '16px', color: 'var(--text-secondary)', textAlign: 'center' }}>No results found</div>
        )}

        {results.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <div className="section-title">Results ({results.length})</div>
            {results.map((result, i) => (
              <div key={result.id || i} className="result-item">
                <div className="result-meta">
                  {result.source} &middot; Score: {result.score?.toFixed(3) ?? '—'}
                </div>
                <div className="result-text">{result.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

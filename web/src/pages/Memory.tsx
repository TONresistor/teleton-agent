import { useState, useEffect, Fragment } from 'react';
import { api, MemorySourceFile, SearchResult } from '../lib/api';
import { formatDate, errMsg } from '../lib/utils';
import { SearchBar } from '../components/SearchBar';
import { List, ListRow } from '../components/List';
import { MemoryDocument } from '../components/MemoryDocument';
import { useResource } from '../hooks/useResource';
import { RefreshButton } from '../components/RefreshButton';
import { Alert } from '../components/Alert';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import memoryFolder from '../assets/memory-folder.svg';

async function readMemoryFile(source: string): Promise<string> {
  return (await api.getMemoryFile(source)).data?.content ?? '';
}

export function Memory() {
  const [filter, setFilter] = useState('');

  const { data: sources, loading, error, reload, setError } = useResource<MemorySourceFile[]>(
    () => api.getMemorySources().then((r) => r.data ?? []),
    [],
  );

  const [openedFile, setOpenedFile] = useState<{ source: string; content: string | null; loading: boolean } | null>(null);

  // Semantic search state (wired to GET /memory/search)
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const query = filter.trim();

  // Debounced semantic search across indexed knowledge (hybrid vector + keyword).
  useEffect(() => {
    if (!query) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.searchKnowledge(query, 50, true);
        if (!cancelled) setResults(res.data ?? []);
      } catch (err) {
        if (!cancelled) setError(errMsg(err));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const toggleSource = async (sourceKey: string) => {
    if (openedFile?.source === sourceKey) {
      setOpenedFile(null);
      return;
    }
    setOpenedFile({ source: sourceKey, content: null, loading: true });
    try {
      const content = await readMemoryFile(sourceKey);
      setOpenedFile((current) => current?.source === sourceKey ? { source: sourceKey, content, loading: false } : current);
    } catch (err) {
      setError(errMsg(err));
      setOpenedFile((current) => current?.source === sourceKey ? { source: sourceKey, content: null, loading: false } : current);
    }
  };

  const allSources = (sources ?? []).filter((source) => source.source.toLowerCase().endsWith('.md'));
  const matchedSources = new Set(results.map((result) => result.source));
  const visibleSources = query ? allSources.filter((source) => matchedSources.has(source.source)) : allSources;

  return (
    <div>
      <div className="header">
        <h1>Memory</h1>
        <p>
          {allSources.length} {allSources.length === 1 ? 'memory file' : 'memory files'}
        </p>
      </div>

      {error && (
        <Alert type="error" message={error} onDismiss={() => setError(null)} style={{ marginBottom: '14px' }} />
      )}

      {/* Controls */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '14px' }}>
        <div style={{ flex: 1 }}>
          <SearchBar value={filter} onChange={setFilter} placeholder="Search memory content…" />
        </div>
        <RefreshButton onRefresh={reload} />
      </div>

      {loading || (query && searching) ? (
        <SkeletonRows />
      ) : visibleSources.length === 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <EmptyState
            title={query ? 'No results' : 'No memory files indexed'}
            description={query ? `No matches for "${query}".` : 'Indexed Markdown files will appear here once content is added.'}
            action={query ? <button className="btn-ghost btn-sm" onClick={() => setFilter('')}>Clear search</button> : undefined}
          />
        </div>
      ) : (
        <List>
          {visibleSources.map((src) => {
            const isExpanded = openedFile?.source === src.source;
            return (
              <Fragment key={src.source}>
                <ListRow
                  leading={<img src={memoryFolder} alt="" aria-hidden="true" />}
                  leadingClassName="file-type-icon"
                  title={src.source}
                  subtitle={formatDate(src.lastUpdated, 1000)}
                  disclosure
                  expanded={isExpanded}
                  onClick={() => toggleSource(src.source)}
                />
                {isExpanded && (
                  <div className="ios-sublist" style={{ padding: '16px 20px' }}>
                    {openedFile.loading ? (
                      <SkeletonRows rows={3} />
                    ) : openedFile.content == null ? (
                      <div style={{ padding: '8px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 'var(--font-sm)' }}>
                        File unavailable
                      </div>
                    ) : openedFile.content === '' ? (
                      <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-sm)' }}>This file is empty.</div>
                    ) : (
                      <MemoryDocument content={openedFile.content} />
                    )}
                  </div>
                )}
              </Fragment>
            );
          })}
        </List>
      )}
    </div>
  );
}

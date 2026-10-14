import { useState, useEffect, useCallback, useRef, type DependencyList } from 'react';
import { errMsg } from '../lib/utils';

export interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Triggers a re-fetch; returns a Promise that resolves when the fetch settles. */
  reload: () => Promise<void>;
  setError: (msg: string | null) => void;
}

/**
 * Encapsulates the repeated load/loading/error state machine:
 *   useState(true) + useState<string|null>(null) + try/catch/finally + useEffect.
 *
 * @param fetcher  Async function that returns the data.
 * @param deps     Dependency list — when they change the data is re-fetched automatically.
 */
export function useResource<T>(
  fetcher: () => Promise<T>,
  deps: DependencyList,
): ResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const generation = useRef(0);
  const mounted = useRef(false);

  const reload = useCallback(async (): Promise<void> => {
    if (!mounted.current) return;
    const token = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      if (mounted.current && generation.current === token) setData(result);
    } catch (err: unknown) {
      if (mounted.current && generation.current === token) setError(errMsg(err));
    } finally {
      if (mounted.current && generation.current === token) setLoading(false);
    }
  }, []);

  const invalidate = useCallback(() => {
    mounted.current = false;
    generation.current++;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return invalidate;
    // Callers supply the dependency list for their fetcher.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, invalidate, ...deps]);

  return { data, loading, error, reload, setError };
}

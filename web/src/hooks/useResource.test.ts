import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useResource } from './useResource';

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

describe('useResource', () => {
  it('fetches once on mount and once per awaited reload', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce('initial').mockResolvedValueOnce('refreshed');
    const { result } = renderHook(() => useResource<string>(fetcher, []));
    await waitFor(() => expect(result.current.data).toBe('initial'));

    await act(() => result.current.reload());

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe('refreshed');
    expect(result.current.loading).toBe(false);
  });

  it('ignores an earlier result while a newer reload is pending', async () => {
    const initial = deferred<string>();
    const newer = deferred<string>();
    const fetcher = vi.fn().mockReturnValueOnce(initial.promise).mockReturnValueOnce(newer.promise);
    const { result } = renderHook(() => useResource<string>(fetcher, []));
    let reload!: Promise<void>;
    act(() => { reload = result.current.reload(); });

    await act(async () => { initial.resolve('stale'); await initial.promise; });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => { newer.resolve('new'); await reload; });
    expect(result.current.data).toBe('new');
    expect(result.current.loading).toBe(false);
  });

  it('ignores stale failures after dependency changes', async () => {
    const initial = deferred<string>();
    const newer = deferred<string>();
    const fetcher = vi.fn().mockReturnValueOnce(initial.promise).mockReturnValueOnce(newer.promise);
    const { result, rerender } = renderHook(({ id }) => useResource<string>(fetcher, [id]), {
      initialProps: { id: 1 },
    });
    rerender({ id: 2 });
    await act(async () => { newer.resolve('current'); await newer.promise; });
    await act(async () => { initial.reject(new Error('obsolete')); await initial.promise.catch(() => {}); });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe('current');
    expect(result.current.error).toBeNull();
  });

  it('reports current errors and clears them when refreshing', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce('recovered');
    const { result } = renderHook(() => useResource<string>(fetcher, []));
    await waitFor(() => expect(result.current.error).toBe('failed'));
    expect(result.current.loading).toBe(false);

    await act(() => result.current.reload());
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBe('recovered');
  });

  it('ignores pending responses and reload calls after unmount', async () => {
    const initial = deferred<string>();
    const fetcher = vi.fn().mockReturnValue(initial.promise);
    const { result, unmount } = renderHook(() => useResource<string>(fetcher, []));
    const reload = result.current.reload;
    unmount();

    await act(async () => { initial.resolve('late'); await initial.promise; await reload(); });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBeNull();
  });
});

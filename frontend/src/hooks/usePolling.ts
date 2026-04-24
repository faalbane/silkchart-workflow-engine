import { useEffect, useRef, useState } from 'react';

interface State<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

interface Options<T> {
  /**
   * When this returns true for the latest fetched value, the polling
   * interval is cleared. The hook still serves the cached data and exposes
   * `refetch` so callers can trigger a manual refresh.
   */
  stopWhen?: (data: T) => boolean;
}

/**
 * Polls `fetcher` every `intervalMs` until either the component unmounts,
 * `deps` change, or `options.stopWhen` returns true for a fetched value.
 *
 * Returns the latest data, error state, a `refetch` for manual refresh, and
 * a `polling` flag the UI can use to show a "live" indicator.
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  deps: unknown[] = [],
  options: Options<T> = {},
): State<T> & { refetch: () => Promise<void>; polling: boolean } {
  const [state, setState] = useState<State<T>>({
    data: null,
    error: null,
    loading: true,
  });
  const [polling, setPolling] = useState(true);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const stopWhenRef = useRef(options.stopWhen);
  stopWhenRef.current = options.stopWhen;

  const cancelled = useRef(false);
  const tick = useRef(0);
  const intervalId = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNow = async () => {
    const myTick = ++tick.current;
    try {
      const data = await fetcherRef.current();
      if (cancelled.current || myTick !== tick.current) return;
      setState({ data, error: null, loading: false });
      if (stopWhenRef.current?.(data) && intervalId.current) {
        clearInterval(intervalId.current);
        intervalId.current = null;
        setPolling(false);
      }
    } catch (err) {
      if (cancelled.current || myTick !== tick.current) return;
      setState((s) => ({ ...s, error: (err as Error).message, loading: false }));
    }
  };

  useEffect(() => {
    cancelled.current = false;
    setPolling(true);
    setState({ data: null, error: null, loading: true });
    fetchNow();
    intervalId.current = setInterval(fetchNow, intervalMs);
    return () => {
      cancelled.current = true;
      if (intervalId.current) {
        clearInterval(intervalId.current);
        intervalId.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, refetch: fetchNow, polling };
}

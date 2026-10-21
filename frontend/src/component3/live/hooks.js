import { useCallback, useEffect, useRef, useState } from 'react';

/** Load data from the live API; reload() refetches. A 401 is reported to onAuthError. */
export function useLiveResource(loader, deps, onAuthError) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const sequence = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    const id = ++sequence.current;
    setState(current => ({ ...current, loading: true, error: null }));
    try {
      const data = await loader();
      if (id === sequence.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (error?.status === 401 && onAuthError) onAuthError();
      if (id === sequence.current) setState({ data: null, error, loading: false });
    }
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

/** Run one write at a time: pending disables submit; afterwards refetch via `after`. */
export function useLiveAction(onAuthError) {
  const [state, setState] = useState({ pending: false, error: null, success: '' });
  const run = useCallback(async (operation, successMessage, after) => {
    setState({ pending: true, error: null, success: '' });
    try {
      const result = await operation();
      setState({ pending: false, error: null, success: successMessage || 'Saved.' });
      if (after) await after(result);
      return result;
    } catch (error) {
      if (error?.status === 401 && onAuthError) onAuthError();
      setState({ pending: false, error, success: '' });
      return null;
    }
  }, [onAuthError]);
  const reset = useCallback(() => setState({ pending: false, error: null, success: '' }), []);
  return { ...state, run, reset };
}

// client/src/features/inventory/useList.js
import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';

/** Loads { rows, total } from a list endpoint; reload() fetches again. */
export function useList(endpoint, params) {
  const key = JSON.stringify(params || {});
  const [state, setState] = useState({ rows: [], total: 0, loading: false, error: '' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let off = false;
    const t = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const { data } = await api.get(endpoint, { params: JSON.parse(key) });
        if (!off) setState({ rows: data.rows, total: data.total ?? data.rows.length, loading: false, error: '' });
      } catch (e) {
        if (!off) setState((s) => ({ ...s, loading: false, error: e.response?.data?.error || 'Could not load the list' }));
      }
    }, 200);
    return () => { off = true; clearTimeout(t); };
  }, [endpoint, key, tick]);

  return { ...state, reload: () => setTick((n) => n + 1) };
}

/** Rows for a dropdown (active records, up to 100). */
export const useOptions = (endpoint, extra) => useList(endpoint, { active: true, limit: 100, ...extra }).rows;

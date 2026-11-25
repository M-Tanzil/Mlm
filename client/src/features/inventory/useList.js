// client/src/features/inventory/useList.js
import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';

/** First readable message from an API error (Zod details first, then the plain error text). */
export function apiMessage(err, fallback) {
  const d = err.response?.data;
  const first = d?.details?.formErrors?.[0] || Object.values(d?.details?.fieldErrors || {}).flat()[0];
  return first || d?.error || fallback;
}

/** Loads { rows, total } from a list endpoint; reload() fetches again. */
export function useList(endpoint, params) {
  const key = JSON.stringify(params || {});
  const [state, setState] = useState({ rows: [], total: 0, loading: false, error: '' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!endpoint) return undefined; // e.g. a modal's list while the modal is closed
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

/** Rows for a dropdown: all active records, fetched 100 at a time (max 20 pages = 2000 rows). */
export function useOptions(endpoint, extra) {
  const key = JSON.stringify(extra || {});
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!endpoint) return undefined;
    let off = false;
    (async () => {
      const all = [];
      try {
        for (let page = 1; page <= 20; page++) {
          const { data } = await api.get(endpoint, { params: { active: true, limit: 100, page, ...JSON.parse(key) } });
          all.push(...data.rows);
          if (all.length >= data.total || data.rows.length === 0) break;
        }
      } catch { /* the dropdown just stays short */ }
      if (!off) setRows(all);
    })();
    return () => { off = true; };
  }, [endpoint, key]);
  return rows;
}

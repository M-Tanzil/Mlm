// client/src/features/announcements/NewsPage.jsx  (distributor and depo panels: announcements meant for me)
import { useState } from 'react';
import { inputCls } from '../../components/FormField.jsx';
import { useList } from '../inventory/useList.js';
import { TYPES } from './AnnouncementsPage.jsx';

export default function NewsPage() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const { rows, total, loading, error } = useList('/announcements/published', { page, limit: 10, type });
  const pages = Math.max(1, Math.ceil(total / 10));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">News &amp; Announcements</h1>
        <label htmlFor="nw-type" className="sr-only">Type</label>
        <select id="nw-type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className={`${inputCls} w-40`}>
          <option value="">All</option>{Object.entries(TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!loading && rows.length === 0 && <p className="text-sm text-gray-500">Nothing to show right now.</p>}
      <div className="space-y-3">
        {rows.map((a) => (
          <article key={a.id} className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">{a.title}</h2>
              <span className="rounded-full bg-indigo-50 text-indigo-700 px-2.5 py-0.5 text-xs font-semibold">{TYPES[a.type]}</span>
            </div>
            {a.event_date && <p className="text-xs text-gray-500">Event date: {a.event_date}</p>}
            {/^https?:\/\//i.test(a.media_url || '') && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(a.media_url) && <img src={a.media_url} alt="" className="max-h-60 rounded-lg" loading="lazy" />}
            {a.body && <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{a.body}</p>}
            {a.media_url && !/\.(png|jpe?g|webp|gif)(\?|$)/i.test(a.media_url) && /^(https?:\/\/|\/)/i.test(a.media_url) && (
              <a href={a.media_url} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-600 underline">Open link</a>)}
            <p className="text-xs text-gray-400">{new Date(a.starts_at || a.created_at).toLocaleDateString('en-IN')}</p>
          </article>))}
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-3 text-sm">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-9 px-3 rounded-lg border border-gray-300 disabled:opacity-50">Previous</button>
          <span>Page {page} of {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="h-9 px-3 rounded-lg border border-gray-300 disabled:opacity-50">Next</button>
        </div>)}
    </div>
  );
}

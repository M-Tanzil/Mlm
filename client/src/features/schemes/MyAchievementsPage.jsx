// client/src/features/schemes/MyAchievementsPage.jsx  (distributor: schemes I can win, my progress and what I have won)
import { useState } from 'react';
import { useList } from '../inventory/useList.js';
import { PhaseBadge, TARGETS } from './SchemesPage.jsx';

export default function MyAchievementsPage() {
  const [page, setPage] = useState(1);
  const { rows, total, loading, error } = useList('/schemes/my', { page, limit: 12 });
  const pages = Math.max(1, Math.ceil(total / 12));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">My Achievements</h1>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!loading && rows.length === 0 && <p className="text-sm text-gray-500">No schemes are running right now.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map((s) => {
          const pct = Math.min(100, Math.round((s.progress / s.target_value) * 100));
          return (
            <section key={s.id} className={`rounded-xl border p-4 space-y-2 ${s.qualified ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white'}`}>
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">{s.name}</h2>
                {s.qualified ? <span className="rounded-full bg-green-100 text-green-800 px-2.5 py-0.5 text-xs font-semibold">Achieved</span> : <PhaseBadge v={s.phase} />}
              </div>
              {s.description && <p className="text-sm text-gray-600">{s.description}</p>}
              <p className="text-sm">Reward: <b>{s.reward}</b></p>
              <p className="text-xs text-gray-500">{TARGETS[s.target_type]} · {s.start_date} → {s.end_date}</p>
              <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${s.name} progress`} className="h-2 rounded-full bg-gray-200 overflow-hidden">
                <div className={`h-full ${s.qualified ? 'bg-green-600' : 'bg-indigo-600'}`} style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-gray-600">{s.progress.toLocaleString('en-IN')} of {s.target_value.toLocaleString('en-IN')}
                {s.qualified && s.qualified_at && ` · achieved ${new Date(s.qualified_at).toLocaleDateString('en-IN')}`}</p>
            </section>);
        })}
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

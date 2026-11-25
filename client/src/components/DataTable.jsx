export function StatusPill({ active }) {
  return active ? (
    <span className="rounded-full bg-green-100 text-green-800 px-2.5 py-0.5 text-xs font-semibold">Active</span>
  ) : (
    <span className="rounded-full bg-gray-200 text-gray-700 px-2.5 py-0.5 text-xs font-semibold">Inactive</span>
  );
}

/** columns: [{ key, label, render?(row) }] */
export default function DataTable({ columns, rows, loading, emptyText = 'No records yet', page, limit, total, onPage }) {
  const pages = Math.max(1, Math.ceil((total || 0) / (limit || 20)));
  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-gray-500 text-xs">
              {columns.map((c) => (
                <th key={c.key} className="px-4 py-3 font-medium border-b border-gray-200">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-gray-500">
                {loading ? 'Loading…' : emptyText}
              </td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-gray-100 last:border-0">
                {columns.map((c) => (
                  <td key={c.key} className="px-4 py-3 align-middle">{c.render ? c.render(r) : r[c.key] ?? '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onPage && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 text-sm text-gray-600">
          <span>{total} record{total === 1 ? '' : 's'}</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}
              className="h-9 px-3 rounded-lg border border-gray-300 disabled:opacity-40">Prev</button>
            <span>Page {page} of {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}
              className="h-9 px-3 rounded-lg border border-gray-300 disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

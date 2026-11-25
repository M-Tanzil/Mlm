// client/src/features/inventory/StockReportPage.jsx
import { useState } from 'react';
import DataTable from '../../components/DataTable.jsx';
import { inputCls } from '../../components/FormField.jsx';
import { useList, useOptions } from './useList.js';

export default function StockReportPage() {
  const [location, setLocation] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [lowOnly, setLowOnly] = useState(false);
  const [threshold, setThreshold] = useState(10);
  const locations = useOptions('/inventory/locations');
  const { rows, total, loading, error } = useList('/inventory/stock-report', {
    page, limit: 25, location_id: location, q, low: lowOnly, threshold,
  });
  const reset = (fn) => (e) => { fn(e); setPage(1); };

  const columns = [
    { key: 'location_name', label: 'Location', render: (r) => `${r.location_name} (${r.location_type})` },
    { key: 'sku', label: 'SKU' },
    { key: 'name', label: 'Product' },
    { key: 'category_name', label: 'Category' },
    { key: 'qty', label: 'In stock', render: (r) => (
      <span className={r.low ? 'font-semibold text-red-700' : ''}>{r.qty}</span>) },
    { key: 'low', label: 'Level', render: (r) => (
      r.qty <= 0
        ? <span className="rounded-full bg-red-100 text-red-800 px-2.5 py-0.5 text-xs font-semibold">Out of stock</span>
        : r.low
          ? <span className="rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 text-xs font-semibold">Low</span>
          : <span className="rounded-full bg-green-100 text-green-800 px-2.5 py-0.5 text-xs font-semibold">OK</span>) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Stock Report</h1>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="sr-loc" className="sr-only">Location</label>
          <select id="sr-loc" value={location} onChange={reset((e) => setLocation(e.target.value))} className={`${inputCls} w-56`}>
            <option value="">All locations</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <label htmlFor="sr-q" className="sr-only">Search</label>
          <input id="sr-q" value={q} onChange={reset((e) => setQ(e.target.value))} placeholder="Search product or SKU" className={`${inputCls} w-56`} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm text-gray-700">
        <label className="flex items-center gap-2">
          Low stock means at or below
          <input type="number" min="0" step="1" value={threshold} aria-label="Low stock threshold"
            onChange={(e) => { setThreshold(Math.max(0, Number(e.target.value) || 0)); setPage(1); }} className={`${inputCls} w-24`} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={lowOnly} onChange={(e) => { setLowOnly(e.target.checked); setPage(1); }} className="h-4 w-4" />
          Show only low / out of stock
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <DataTable columns={columns} rows={rows} loading={loading} page={page} limit={25} total={total} onPage={setPage}
        emptyText={lowOnly ? 'Nothing is low on stock.' : 'No stock yet. Receive stock first.'} />
    </div>
  );
}

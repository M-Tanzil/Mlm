// client/src/features/inventory/StockReportPage.jsx
import { useState } from 'react';
import DataTable from '../../components/DataTable.jsx';
import { inputCls } from '../../components/FormField.jsx';
import { useList, useOptions } from './useList.js';

export default function StockReportPage() {
  const [location, setLocation] = useState('');
  const [q, setQ] = useState('');
  const locations = useOptions('/inventory/locations');
  const { rows, loading, error } = useList('/inventory/stock-report', { location_id: location, q });

  const columns = [
    { key: 'location_name', label: 'Location', render: (r) => `${r.location_name} (${r.location_type})` },
    { key: 'sku', label: 'SKU' },
    { key: 'name', label: 'Product' },
    { key: 'category_name', label: 'Category' },
    { key: 'qty', label: 'In stock', render: (r) => (
      <span className={r.qty <= 0 ? 'font-semibold text-red-700' : ''}>{r.qty}</span>) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Stock Report</h1>
        <div className="flex gap-3">
          <label htmlFor="sr-loc" className="sr-only">Location</label>
          <select id="sr-loc" value={location} onChange={(e) => setLocation(e.target.value)} className={`${inputCls} w-56`}>
            <option value="">All locations</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <label htmlFor="sr-q" className="sr-only">Search</label>
          <input id="sr-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product or SKU" className={`${inputCls} w-56`} />
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <DataTable columns={columns} rows={rows} loading={loading} emptyText="No stock yet. Receive stock first." />
    </div>
  );
}

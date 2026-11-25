// client/src/features/inventory/StockMovementsPage.jsx
import { useState } from 'react';
import DataTable from '../../components/DataTable.jsx';
import { inputCls } from '../../components/FormField.jsx';
import { useList, useOptions } from './useList.js';

const TYPES = ['INWARD', 'RETURN', 'TRANSFER_OUT', 'TRANSFER_IN', 'SALE', 'JOINING_DISPATCH', 'RESALE', 'PKG_RETURN', 'ADJUST'];
const label = (t) => t.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export default function StockMovementsPage() {
  const [f, setF] = useState({ location_id: '', txn_type: '', q: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const locations = useOptions('/inventory/locations');
  const { rows, total, loading, error } = useList('/inventory/stock-movements', { page, limit: 25, ...f });
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPage(1); };

  const columns = [
    { key: 'created_at', label: 'When', render: (r) => new Date(r.created_at).toLocaleString('en-IN') },
    { key: 'location_name', label: 'Location' },
    { key: 'name', label: 'Product', render: (r) => (<>{r.product_name}<div className="text-xs text-gray-500">{r.sku}</div></>) },
    { key: 'txn_type', label: 'Type', render: (r) => label(r.txn_type) },
    { key: 'qty_change', label: 'Change', render: (r) => (
      <span className={`font-semibold ${r.qty_change < 0 ? 'text-red-700' : 'text-green-700'}`}>{r.qty_change > 0 ? `+${r.qty_change}` : r.qty_change}</span>) },
    { key: 'ref', label: 'Reference', render: (r) => r.ref_no || (r.ref_type ? `${r.ref_type} #${r.ref_id}` : '—') },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Stock Movements</h1>
      <div className="flex flex-wrap items-end gap-3">
        <select aria-label="Location" value={f.location_id} onChange={set('location_id')} className={`${inputCls} w-52`}>
          <option value="">All locations</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select aria-label="Movement type" value={f.txn_type} onChange={set('txn_type')} className={`${inputCls} w-48`}>
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
        </select>
        <input aria-label="Search product" value={f.q} onChange={set('q')} placeholder="Search product or SKU" className={`${inputCls} w-52`} />
        <label className="text-xs text-gray-600">From
          <input type="date" value={f.from} onChange={set('from')} className={`${inputCls} w-40 block`} /></label>
        <label className="text-xs text-gray-600">To
          <input type="date" value={f.to} onChange={set('to')} className={`${inputCls} w-40 block`} /></label>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <DataTable columns={columns} rows={rows} loading={loading} page={page} limit={25} total={total} onPage={setPage}
        emptyText="No stock movements match these filters." />
    </div>
  );
}

// client/src/features/depo/DepoStockPage.jsx  (depo / franchise panel: what is in my stock)
import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import DataTable from '../../components/DataTable.jsx';
import { inputCls } from '../../components/FormField.jsx';
import { useList } from '../inventory/useList.js';

export default function DepoStockPage() {
  const [q, setQ] = useState('');
  const [me, setMe] = useState(null);
  const { rows, loading, error } = useList('/depo/stock', { q });

  useEffect(() => {
    api.get('/depo/me').then((r) => setMe(r.data)).catch(() => {});
  }, []);

  const units = rows.reduce((s, r) => s + r.qty, 0);
  const columns = [
    { key: 'sku', label: 'SKU' },
    { key: 'name', label: 'Product' },
    { key: 'category_name', label: 'Category' },
    { key: 'qty', label: 'In stock', render: (r) => <span className={r.qty <= 0 ? 'font-semibold text-red-700' : ''}>{r.qty}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">My Stock</h1>
          {me && <p className="text-sm text-gray-600">{me.name} ({me.type === 'DEPO' ? 'Depo' : 'Franchise'}){me.city ? ` · ${me.city}` : ''}</p>}
        </div>
        <input aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product or SKU" className={`${inputCls} w-60`} />
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-4 w-fit">
        <div className="text-xs text-gray-500">Units in stock{q ? ' (matching search)' : ''}</div>
        <div className="text-2xl font-bold">{units.toLocaleString('en-IN')}</div>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <DataTable columns={columns} rows={rows} loading={loading} emptyText="No stock yet. Accept an incoming transfer or request stock from head office." />
    </div>
  );
}

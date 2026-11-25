// client/src/features/depo/DepoPcrPage.jsx  (depo / franchise panel: ask head office for stock)
import { useState } from 'react';
import { api } from '../../api/client.js';
import DataTable from '../../components/DataTable.jsx';
import Modal from '../../components/Modal.jsx';
import { apiMessage, useList, useOptions } from '../inventory/useList.js';
import { PcrBadge } from './PcrRequestsPage.jsx';

const blankItem = { product_id: '', qty: '' };
const selectCls = 'w-full h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function DepoPcrPage() {
  const [page, setPage] = useState(1);
  const { rows, total, loading, error, reload } = useList('/depo/pcr', { page, limit: 20 });
  const products = useOptions('/depo/products');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([{ ...blankItem }]);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const setItem = (idx, patch) => setItems((a) => a.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  function openNew() { setItems([{ ...blankItem }]); setFormError(''); setNotice(''); setOpen(true); }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      await api.post('/depo/pcr', { items: items.map((i) => ({ product_id: Number(i.product_id), qty: Number(i.qty) })) });
      setOpen(false);
      setNotice('Request sent to head office. You will see the stock under Incoming Stock once it is approved.');
      setPage(1);
      reload();
    } catch (err) {
      setFormError(apiMessage(err, 'Could not send the request'));
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: 'id', label: 'Request', render: (r) => `#${r.id}` },
    { key: 'items', label: 'Products', render: (r) => (<ul className="text-xs space-y-0.5">{r.items.map((i) => <li key={i.product_id}>{i.name} × {i.qty}</li>)}</ul>) },
    { key: 'total_qty', label: 'Units' },
    { key: 'status', label: 'Status', render: (r) => <PcrBadge status={r.status} /> },
    { key: 'created_at', label: 'Date', render: (r) => new Date(r.created_at).toLocaleDateString('en-IN') },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Stock Requests</h1>
        <button type="button" onClick={openNew} className="h-11 px-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">New request</button>
      </div>
      {notice && <p role="status" className="text-sm rounded-lg bg-green-50 text-green-800 border border-green-200 px-3 py-2">{notice}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <DataTable columns={columns} rows={rows} loading={loading} page={page} limit={20} total={total} onPage={setPage} emptyText="No requests yet" />

      <Modal open={open} title="Request stock from head office" onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-3">
            {items.map((it, idx) => (
              <div key={idx} className="rounded-lg border border-gray-200 p-3 space-y-2">
                <select aria-label="Product" required value={it.product_id} onChange={(e) => setItem(idx, { product_id: e.target.value })} className={selectCls}>
                  <option value="">Select product…</option>
                  {products.filter((p) => String(p.id) === String(it.product_id) || !items.some((x) => String(x.product_id) === String(p.id)))
                    .map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
                </select>
                <input aria-label="Quantity" type="number" min="1" step="1" required placeholder="Quantity" value={it.qty}
                  onChange={(e) => setItem(idx, { qty: e.target.value })} className={selectCls} />
                {items.length > 1 && <button type="button" onClick={() => setItems(items.filter((_, i) => i !== idx))} className="text-xs text-red-600">Remove</button>}
              </div>
            ))}
            <button type="button" onClick={() => setItems([...items, { ...blankItem }])} className="h-10 px-3 rounded-lg border border-dashed border-gray-400 text-sm">+ Add product</button>
          </div>
          {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setOpen(false)} className="h-11 px-4 rounded-lg border border-gray-300 text-sm">Cancel</button>
            <button type="submit" disabled={saving} className="h-11 px-5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-60">{saving ? 'Sending…' : 'Send request'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

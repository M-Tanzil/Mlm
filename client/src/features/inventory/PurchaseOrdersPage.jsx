// client/src/features/inventory/PurchaseOrdersPage.jsx
import { useState } from 'react';
import { api } from '../../api/client.js';
import DataTable from '../../components/DataTable.jsx';
import Modal from '../../components/Modal.jsx';
import FormField, { inputCls } from '../../components/FormField.jsx';
import { useList, useOptions } from './useList.js';

const COLORS = {
  OPEN: 'bg-amber-100 text-amber-800', PARTIAL: 'bg-blue-100 text-blue-800',
  CLOSED: 'bg-green-100 text-green-800', CANCELLED: 'bg-gray-200 text-gray-700',
};
export const StatusBadge = ({ status }) => (
  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${COLORS[status] || ''}`}>{status}</span>
);
const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;
const emptyItem = { product_id: '', qty: '', rate: '' };

export default function PurchaseOrdersPage() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const { rows, total, loading, error, reload } = useList('/inventory/purchase-orders', { page, limit: 20, q, status });
  const suppliers = useOptions('/inventory/suppliers');
  const products = useOptions('/inventory/products');

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ supplier_id: '', items: [{ ...emptyItem }] });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState(null);

  const total_amount = form.items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0);
  const setItem = (idx, patch) =>
    setForm((f) => ({ ...f, items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }));

  function openNew() {
    setForm({ supplier_id: '', items: [{ ...emptyItem }] });
    setFormError('');
    setCreating(true);
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      await api.post('/inventory/purchase-orders', {
        supplier_id: Number(form.supplier_id),
        items: form.items.map((i) => ({ product_id: Number(i.product_id), qty: Number(i.qty), rate: Number(i.rate) })),
      });
      setCreating(false);
      setPage(1);
      reload();
    } catch (err) {
      const d = err.response?.data;
      setFormError(d?.details?.fieldErrors || d?.details?.formErrors?.length ? 'Check the supplier and every product row' : d?.error || 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  async function view(row) {
    const { data } = await api.get(`/inventory/purchase-orders/${row.id}`);
    setViewing(data);
  }
  async function cancel(po) {
    if (!window.confirm(`Cancel ${po.po_no}?`)) return;
    try {
      await api.put(`/inventory/purchase-orders/${po.id}/cancel`);
      setViewing(null);
      reload();
    } catch (err) {
      alert(err.response?.data?.error || 'Could not cancel');
    }
  }

  const columns = [
    { key: 'po_no', label: 'PO no' },
    { key: 'supplier_name', label: 'Supplier' },
    { key: 'total', label: 'Total', render: (r) => inr(r.total) },
    { key: 'received', label: 'Received', render: (r) => `${r.received_qty} / ${r.ordered_qty}` },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'created_at', label: 'Date', render: (r) => new Date(r.created_at).toLocaleDateString('en-IN') },
    { key: 'a', label: '', render: (r) => (
      <button type="button" onClick={() => view(r)} className="h-9 px-3 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">View</button>) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Purchase Orders</h1>
        <div className="flex flex-wrap gap-3">
          <label htmlFor="po-status" className="sr-only">Status</label>
          <select id="po-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={`${inputCls} w-40`}>
            <option value="">All statuses</option>
            {['OPEN', 'PARTIAL', 'CLOSED', 'CANCELLED'].map((s) => <option key={s}>{s}</option>)}
          </select>
          <label htmlFor="po-search" className="sr-only">Search</label>
          <input id="po-search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search PO or supplier" className={`${inputCls} w-56`} />
          <button type="button" onClick={openNew} className="h-11 px-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">New purchase order</button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <DataTable columns={columns} rows={rows} loading={loading} page={page} limit={20} total={total} onPage={setPage} />

      <Modal open={creating} title="New purchase order" onClose={() => setCreating(false)}>
        <form onSubmit={submit} className="space-y-4">
          <FormField id="po-supplier" label="Supplier" required>
            <select id="po-supplier" required value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })} className={inputCls}>
              <option value="">Select…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </FormField>
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-700">Products</div>
            {form.items.map((it, idx) => (
              <div key={idx} className="rounded-lg border border-gray-200 p-3 space-y-2">
                <label htmlFor={`po-p-${idx}`} className="sr-only">Product</label>
                <select id={`po-p-${idx}`} required value={it.product_id} onChange={(e) => setItem(idx, { product_id: e.target.value })} className={inputCls}>
                  <option value="">Select product…</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <input aria-label="Quantity" type="number" min="1" step="1" required placeholder="Qty" value={it.qty}
                    onChange={(e) => setItem(idx, { qty: e.target.value })} className={inputCls} />
                  <input aria-label="Rate" type="number" min="0" step="any" required placeholder="Rate (₹)" value={it.rate}
                    onChange={(e) => setItem(idx, { rate: e.target.value })} className={inputCls} />
                </div>
                {form.items.length > 1 && (
                  <button type="button" onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })}
                    className="text-xs text-red-600">Remove</button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setForm({ ...form, items: [...form.items, { ...emptyItem }] })}
              className="h-10 px-3 rounded-lg border border-dashed border-gray-400 text-sm">+ Add product</button>
          </div>
          <div className="flex justify-between text-sm font-semibold"><span>Total</span><span>{inr(total_amount)}</span></div>
          {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setCreating(false)} className="h-11 px-4 rounded-lg border border-gray-300 text-sm">Cancel</button>
            <button type="submit" disabled={saving} className="h-11 px-5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-60">{saving ? 'Saving…' : 'Create PO'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!viewing} title={viewing ? `${viewing.po_no} · ${viewing.supplier_name}` : ''} onClose={() => setViewing(null)}>
        {viewing && (
          <div className="space-y-4">
            <div className="flex items-center justify-between"><StatusBadge status={viewing.status} /><strong>{inr(viewing.total)}</strong></div>
            <ul className="divide-y divide-gray-100 text-sm">
              {viewing.items.map((i) => (
                <li key={i.id} className="py-2 flex justify-between gap-3">
                  <span>{i.product_name}<br /><span className="text-xs text-gray-500">{i.sku} · {inr(i.rate)} each</span></span>
                  <span className="text-right">{i.received_qty} / {i.qty}<br /><span className="text-xs text-gray-500">received</span></span>
                </li>
              ))}
            </ul>
            {viewing.status === 'OPEN' && (
              <button type="button" onClick={() => cancel(viewing)} className="h-10 px-4 rounded-lg border border-red-300 text-red-700 text-sm">Cancel this PO</button>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

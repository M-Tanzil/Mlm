// client/src/features/inventory/StockReturnsPage.jsx
import { useState } from 'react';
import { api } from '../../api/client.js';
import DataTable from '../../components/DataTable.jsx';
import Modal from '../../components/Modal.jsx';
import FormField, { inputCls } from '../../components/FormField.jsx';
import { useList, useOptions } from './useList.js';

const blank = { supplier_id: '', location_id: '', product_id: '', qty: '', reason: '' };

export default function StockReturnsPage() {
  const [page, setPage] = useState(1);
  const { rows, total, loading, error, reload } = useList('/inventory/stock-returns', { page, limit: 20 });
  const suppliers = useOptions('/inventory/suppliers');
  const products = useOptions('/inventory/products');
  const locations = useOptions('/inventory/locations');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      await api.post('/inventory/stock-returns', {
        supplier_id: Number(form.supplier_id), location_id: Number(form.location_id),
        product_id: Number(form.product_id), qty: Number(form.qty), reason: form.reason,
      });
      setOpen(false);
      setPage(1);
      reload();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: 'return_no', label: 'Return no' },
    { key: 'supplier_name', label: 'Supplier' },
    { key: 'product_name', label: 'Product', render: (r) => `${r.sku} · ${r.product_name}` },
    { key: 'location_name', label: 'From' },
    { key: 'qty', label: 'Qty' },
    { key: 'reason', label: 'Reason' },
    { key: 'created_at', label: 'Date', render: (r) => new Date(r.created_at).toLocaleDateString('en-IN') },
  ];

  const select = (id, label, key, list, text) => (
    <FormField id={id} label={label} required>
      <select id={id} required value={form[key]} onChange={set(key)} className={inputCls}>
        <option value="">Select…</option>
        {list.map((x) => <option key={x.id} value={x.id}>{text(x)}</option>)}
      </select>
    </FormField>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Stock Return to Supplier</h1>
        <button type="button" onClick={() => { setForm(blank); setFormError(''); setOpen(true); }}
          className="h-11 px-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">New return</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <DataTable columns={columns} rows={rows} loading={loading} page={page} limit={20} total={total} onPage={setPage} />

      <Modal open={open} title="Return stock to supplier" onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="space-y-4">
          {select('r-sup', 'Supplier', 'supplier_id', suppliers, (s) => s.name)}
          {select('r-loc', 'Return from location', 'location_id', locations, (l) => `${l.name} (${l.type})`)}
          {select('r-prod', 'Product', 'product_id', products, (p) => `${p.sku} · ${p.name}`)}
          <FormField id="r-qty" label="Quantity" required>
            <input id="r-qty" type="number" min="1" step="1" required value={form.qty} onChange={set('qty')} className={inputCls} />
          </FormField>
          <FormField id="r-reason" label="Reason">
            <input id="r-reason" value={form.reason} onChange={set('reason')} className={inputCls} />
          </FormField>
          {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setOpen(false)} className="h-11 px-4 rounded-lg border border-gray-300 text-sm">Cancel</button>
            <button type="submit" disabled={saving} className="h-11 px-5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-60">{saving ? 'Saving…' : 'Return stock'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

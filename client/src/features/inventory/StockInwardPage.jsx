// client/src/features/inventory/StockInwardPage.jsx
import { useState } from 'react';
import { api } from '../../api/client.js';
import DataTable from '../../components/DataTable.jsx';
import Modal from '../../components/Modal.jsx';
import FormField, { inputCls } from '../../components/FormField.jsx';
import { apiMessage, useList, useOptions } from './useList.js';

const blank = { mode: 'PO_WISE', po_id: '', supplier_id: '', location_id: '', invoice_no: '', items: [] };
const blankItem = { product_id: '', name: '', qty: '', max: null, batch_no: '', expiry_date: '' };

export default function StockInwardPage() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const { rows, total, loading, error, reload } = useList('/inventory/stock-inward', { page, limit: 20, q });
  const openPos = useOptions('/inventory/purchase-orders', { status: 'OPEN,PARTIAL' });
  const suppliers = useOptions('/inventory/suppliers');
  const products = useOptions('/inventory/products');
  const locations = useOptions('/inventory/locations');

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const setItem = (idx, patch) => setForm((f) => ({ ...f, items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }));

  function openNew() { setForm(blank); setFormError(''); setOpen(true); }

  function setMode(mode) {
    setForm({ ...blank, mode, location_id: form.location_id, items: mode === 'SUPPLIER_WISE' ? [{ ...blankItem }] : [] });
  }

  async function pickPo(poId) {
    setForm((f) => ({ ...f, po_id: poId, items: [] }));
    setFormError('');
    if (!poId) return;
    let data;
    try {
      ({ data } = await api.get(`/inventory/purchase-orders/${poId}`));
    } catch (err) {
      setFormError(apiMessage(err, 'Could not load the purchase order'));
      return;
    }
    setForm((f) => ({
      ...f,
      items: data.items.filter((i) => i.qty - i.received_qty > 0).map((i) => ({
        ...blankItem, product_id: i.product_id, name: `${i.sku} · ${i.product_name}`,
        qty: i.qty - i.received_qty, max: i.qty - i.received_qty,
      })),
    }));
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    const body = {
      mode: form.mode,
      location_id: Number(form.location_id),
      invoice_no: form.invoice_no,
      items: form.items.filter((i) => Number(i.qty) > 0).map((i) => ({
        product_id: Number(i.product_id), qty: Number(i.qty), batch_no: i.batch_no, expiry_date: i.expiry_date,
      })),
    };
    if (form.mode === 'PO_WISE') body.po_id = Number(form.po_id);
    else body.supplier_id = Number(form.supplier_id);
    try {
      await api.post('/inventory/stock-inward', body);
      setOpen(false);
      setPage(1);
      reload();
    } catch (err) {
      setFormError(apiMessage(err, 'Could not save'));
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: 'inward_no', label: 'GRN no' },
    { key: 'mode', label: 'Type', render: (r) => (r.mode === 'PO_WISE' ? `PO ${r.po_no}` : 'Supplier wise') },
    { key: 'supplier_name', label: 'Supplier' },
    { key: 'location_name', label: 'Location' },
    { key: 'invoice_no', label: 'Invoice' },
    { key: 'total_qty', label: 'Qty', render: (r) => `${r.total_qty} (${r.item_count} items)` },
    { key: 'received_at', label: 'Date', render: (r) => new Date(r.received_at).toLocaleDateString('en-IN') },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Stock Inward</h1>
        <div className="flex gap-3">
          <label htmlFor="in-search" className="sr-only">Search</label>
          <input id="in-search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search GRN, PO, supplier, invoice" className={`${inputCls} w-72`} />
          <button type="button" onClick={openNew} className="h-11 px-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">Receive stock</button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <DataTable columns={columns} rows={rows} loading={loading} page={page} limit={20} total={total} onPage={setPage} />

      <Modal open={open} title="Receive stock" onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="space-y-4">
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="sr-only">Type</legend>
            {[['PO_WISE', 'PO wise'], ['SUPPLIER_WISE', 'Supplier wise']].map(([v, label]) => (
              <button key={v} type="button" onClick={() => setMode(v)}
                className={`h-11 rounded-lg text-sm font-semibold border ${form.mode === v ? 'border-indigo-600 bg-indigo-50 text-indigo-900' : 'border-gray-300'}`}>{label}</button>
            ))}
          </fieldset>

          {form.mode === 'PO_WISE' ? (
            <FormField id="in-po" label="Purchase order" required>
              <select id="in-po" required value={form.po_id} onChange={(e) => pickPo(e.target.value)} className={inputCls}>
                <option value="">Select open PO…</option>
                {openPos.map((p) => <option key={p.id} value={p.id}>{p.po_no} · {p.supplier_name} ({p.received_qty}/{p.ordered_qty})</option>)}
              </select>
            </FormField>
          ) : (
            <FormField id="in-sup" label="Supplier" required>
              <select id="in-sup" required value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })} className={inputCls}>
                <option value="">Select…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </FormField>
          )}

          <FormField id="in-loc" label="Receive at location" required>
            <select id="in-loc" required value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })} className={inputCls}>
              <option value="">Select…</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.type})</option>)}
            </select>
          </FormField>
          <FormField id="in-inv" label="Supplier invoice no">
            <input id="in-inv" value={form.invoice_no} onChange={(e) => setForm({ ...form, invoice_no: e.target.value })} className={inputCls} />
          </FormField>

          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-700">Products received</div>
            {form.items.length === 0 && form.mode === 'PO_WISE' && <p className="text-sm text-gray-500">Choose a purchase order to load its pending products.</p>}
            {form.items.map((it, idx) => (
              <div key={idx} className="rounded-lg border border-gray-200 p-3 space-y-2">
                {form.mode === 'PO_WISE' ? (
                  <div className="text-sm font-medium">{it.name} <span className="text-xs text-gray-500">(pending {it.max})</span></div>
                ) : (
                  <select aria-label="Product" required value={it.product_id} onChange={(e) => setItem(idx, { product_id: e.target.value })} className={inputCls}>
                    <option value="">Select product…</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
                  </select>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <input aria-label="Quantity" type="number" min="0" max={it.max ?? undefined} step="1" placeholder="Qty" value={it.qty}
                    onChange={(e) => setItem(idx, { qty: e.target.value })} className={inputCls} />
                  <input aria-label="Batch no" placeholder="Batch" value={it.batch_no} onChange={(e) => setItem(idx, { batch_no: e.target.value })} className={inputCls} />
                  <input aria-label="Expiry date" type="date" value={it.expiry_date} onChange={(e) => setItem(idx, { expiry_date: e.target.value })} className={inputCls} />
                </div>
                {form.mode === 'SUPPLIER_WISE' && form.items.length > 1 && (
                  <button type="button" onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })} className="text-xs text-red-600">Remove</button>
                )}
              </div>
            ))}
            {form.mode === 'SUPPLIER_WISE' && (
              <button type="button" onClick={() => setForm({ ...form, items: [...form.items, { ...blankItem }] })}
                className="h-10 px-3 rounded-lg border border-dashed border-gray-400 text-sm">+ Add product</button>
            )}
          </div>
          {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setOpen(false)} className="h-11 px-4 rounded-lg border border-gray-300 text-sm">Cancel</button>
            <button type="submit" disabled={saving} className="h-11 px-5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-60">{saving ? 'Saving…' : 'Add to stock'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

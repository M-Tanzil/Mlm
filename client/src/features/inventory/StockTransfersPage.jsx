// client/src/features/inventory/StockTransfersPage.jsx
import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import DataTable from '../../components/DataTable.jsx';
import Modal from '../../components/Modal.jsx';
import FormField, { inputCls } from '../../components/FormField.jsx';
import { apiMessage, useList, useOptions } from './useList.js';

const COLORS = {
  SENT: 'bg-amber-100 text-amber-800', ACCEPTED: 'bg-green-100 text-green-800', REJECTED: 'bg-gray-200 text-gray-700',
};
const Badge = ({ status }) => (
  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${COLORS[status] || ''}`}>{status}</span>
);
const blankItem = { product_id: '', qty: '' };
const blankForm = { from: '', to: '', items: [{ ...blankItem }] };

// base: API prefix. The depo panel reuses this page with base='/depo/transfers' and canCreate={false} (it only accepts or rejects).
export default function StockTransfersPage({ base = '/inventory/stock-transfers', canCreate = true, title = 'Stock Transfers' }) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const { rows, total, loading, error, reload } = useList(base, { page, limit: 20, q, status });
  const locations = useOptions(canCreate ? '/inventory/locations' : null);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [avail, setAvail] = useState([]); // products with stock at the chosen source location
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [viewing, setViewing] = useState(null);
  const [recv, setRecv] = useState({}); // item id -> received qty
  const [actionError, setActionError] = useState('');

  // Only products that have stock at the source can be sent. The server re-checks this when saving.
  useEffect(() => {
    if (!creating || !form.from) { setAvail([]); return undefined; }
    let off = false;
    (async () => {
      const all = [];
      try {
        for (let p = 1; p <= 20; p++) {
          const { data } = await api.get('/inventory/stock-report', { params: { location_id: form.from, limit: 100, page: p } });
          all.push(...data.rows);
          if (all.length >= data.total || data.rows.length === 0) break;
        }
      } catch { /* the product list just stays empty */ }
      if (!off) setAvail(all.filter((r) => r.qty > 0));
    })();
    return () => { off = true; };
  }, [creating, form.from]);

  const setItem = (idx, patch) =>
    setForm((f) => ({ ...f, items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }));
  const stockOf = (productId) => avail.find((a) => String(a.product_id) === String(productId))?.qty;

  function openNew() { setForm(blankForm); setFormError(''); setCreating(true); }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      await api.post('/inventory/stock-transfers', {
        from_location: Number(form.from), to_location: Number(form.to),
        items: form.items.map((i) => ({ product_id: Number(i.product_id), qty: Number(i.qty) })),
      });
      setCreating(false);
      setPage(1);
      reload();
    } catch (err) {
      setFormError(apiMessage(err, 'Could not send the transfer'));
    } finally {
      setSaving(false);
    }
  }

  async function view(row) {
    setActionError('');
    try {
      const { data } = await api.get(`${base}/${row.id}`);
      setRecv(Object.fromEntries(data.items.map((i) => [i.id, i.qty_sent])));
      setViewing(data);
    } catch (err) {
      setActionError(apiMessage(err, 'Could not open the transfer'));
    }
  }

  async function act(kind) {
    if (kind === 'reject' && !window.confirm(`Reject ${viewing.transfer_no}? All the stock goes back to ${viewing.from_name}.`)) return;
    setActionError('');
    try {
      const body = kind === 'accept'
        ? { items: viewing.items.map((i) => ({ id: i.id, qty_accepted: Number(recv[i.id]) })) }
        : undefined;
      const { data } = await api.put(`${base}/${viewing.id}/${kind}`, body);
      setViewing(data);
      reload();
    } catch (err) {
      setActionError(apiMessage(err, `Could not ${kind} the transfer`));
      reload();
    }
  }

  const columns = [
    { key: 'transfer_no', label: 'Transfer no' },
    { key: 'from_name', label: 'From' },
    { key: 'to_name', label: 'To' },
    { key: 'total_qty', label: 'Qty sent' },
    { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'sent_at', label: 'Sent', render: (r) => new Date(r.sent_at).toLocaleDateString('en-IN') },
    { key: 'a', label: '', render: (r) => (
      <button type="button" onClick={() => view(r)} className="h-9 px-3 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">View</button>) },
  ];

  const recvInvalid = viewing?.items.some((i) => {
    const n = Number(recv[i.id]);
    return recv[i.id] === '' || !Number.isInteger(n) || n < 0 || n > i.qty_sent;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{title}</h1>
        <div className="flex flex-wrap gap-3">
          <label htmlFor="tr-status" className="sr-only">Status</label>
          <select id="tr-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={`${inputCls} w-40`}>
            <option value="">All statuses</option>
            {['SENT', 'ACCEPTED', 'REJECTED'].map((s) => <option key={s}>{s}</option>)}
          </select>
          <label htmlFor="tr-search" className="sr-only">Search</label>
          <input id="tr-search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search transfer or location" className={`${inputCls} w-60`} />
          {canCreate && (
            <button type="button" onClick={openNew} className="h-11 px-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">New transfer</button>
          )}
        </div>
      </div>
      {(error || actionError) && <p role="alert" className="text-sm text-red-600">{error || actionError}</p>}
      <DataTable columns={columns} rows={rows} loading={loading} page={page} limit={20} total={total} onPage={setPage} emptyText="No transfers yet" />

      {canCreate && <Modal open={creating} title="New stock transfer" onClose={() => setCreating(false)}>
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-gray-600">Stock leaves the source location as soon as you send. The destination then accepts it, or rejects it and the stock returns.</p>
          <FormField id="tr-from" label="From location" required>
            <select id="tr-from" required value={form.from} className={inputCls}
              onChange={(e) => setForm({ ...blankForm, from: e.target.value, to: form.to === e.target.value ? '' : form.to })}>
              <option value="">Select…</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.type})</option>)}
            </select>
          </FormField>
          <FormField id="tr-to" label="To location" required>
            <select id="tr-to" required value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} className={inputCls}>
              <option value="">Select…</option>
              {locations.filter((l) => String(l.id) !== form.from).map((l) => <option key={l.id} value={l.id}>{l.name} ({l.type})</option>)}
            </select>
          </FormField>
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-700">Products</div>
            {!form.from && <p className="text-sm text-gray-500">Choose the source location to see what is in stock there.</p>}
            {form.from && avail.length === 0 && <p className="text-sm text-gray-500">No stock at this location.</p>}
            {form.from && avail.length > 0 && form.items.map((it, idx) => {
              const have = stockOf(it.product_id);
              const taken = form.items.map((x, i) => (i !== idx ? String(x.product_id) : null));
              return (
                <div key={idx} className="rounded-lg border border-gray-200 p-3 space-y-2">
                  <select aria-label="Product" required value={it.product_id} onChange={(e) => setItem(idx, { product_id: e.target.value, qty: '' })} className={inputCls}>
                    <option value="">Select product…</option>
                    {avail.filter((a) => !taken.includes(String(a.product_id))).map((a) => (
                      <option key={a.product_id} value={a.product_id}>{a.sku} · {a.name} (available {a.qty})</option>))}
                  </select>
                  <input aria-label="Quantity" type="number" min="1" max={have ?? undefined} step="1" required placeholder={have ? `Qty (max ${have})` : 'Qty'}
                    value={it.qty} onChange={(e) => setItem(idx, { qty: e.target.value })} className={inputCls} />
                  {form.items.length > 1 && (
                    <button type="button" onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })} className="text-xs text-red-600">Remove</button>
                  )}
                </div>
              );
            })}
            {form.from && avail.length > 0 && form.items.length < avail.length && (
              <button type="button" onClick={() => setForm({ ...form, items: [...form.items, { ...blankItem }] })}
                className="h-10 px-3 rounded-lg border border-dashed border-gray-400 text-sm">+ Add product</button>
            )}
          </div>
          {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setCreating(false)} className="h-11 px-4 rounded-lg border border-gray-300 text-sm">Cancel</button>
            <button type="submit" disabled={saving || !form.from || avail.length === 0} className="h-11 px-5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-60">
              {saving ? 'Sending…' : 'Send transfer'}</button>
          </div>
        </form>
      </Modal>}

      <Modal open={!!viewing} title={viewing ? viewing.transfer_no : ''} onClose={() => setViewing(null)}>
        {viewing && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Badge status={viewing.status} />
              <span className="text-sm text-gray-600">{viewing.from_name} → {viewing.to_name}</span>
            </div>
            <ul className="divide-y divide-gray-100 text-sm">
              {viewing.items.map((i) => (
                <li key={i.id} className="py-2 flex items-center justify-between gap-3">
                  <span>{i.product_name}<br /><span className="text-xs text-gray-500">{i.sku}</span></span>
                  {viewing.status === 'SENT' ? (
                    <label className="text-right text-xs text-gray-500">Received (sent {i.qty_sent})
                      <input type="number" min="0" max={i.qty_sent} step="1" value={recv[i.id] ?? ''} aria-label={`Received quantity for ${i.product_name}`}
                        onChange={(e) => setRecv({ ...recv, [i.id]: e.target.value })} className={`${inputCls} w-24 block ml-auto`} />
                    </label>
                  ) : (
                    <span className="text-right">{i.qty_accepted ?? 0} / {i.qty_sent}<br /><span className="text-xs text-gray-500">received</span></span>
                  )}
                </li>
              ))}
            </ul>
            {viewing.status === 'SENT' && (
              <>
                <p className="text-xs text-gray-500">Anything not received goes back to {viewing.from_name}.</p>
                {actionError && <p role="alert" className="text-sm text-red-600">{actionError}</p>}
                <div className="flex gap-3">
                  <button type="button" onClick={() => act('accept')} disabled={recvInvalid}
                    className="h-11 px-5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-60">Accept</button>
                  <button type="button" onClick={() => act('reject')}
                    className="h-11 px-4 rounded-lg border border-red-300 text-red-700 text-sm">Reject</button>
                </div>
              </>
            )}
            {viewing.status !== 'SENT' && viewing.accepted_at && (
              <p className="text-xs text-gray-500">{viewing.status === 'ACCEPTED' ? 'Accepted' : 'Rejected'} on {new Date(viewing.accepted_at).toLocaleString('en-IN')}</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

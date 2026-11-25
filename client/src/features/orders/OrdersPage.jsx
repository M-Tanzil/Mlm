// client/src/features/orders/OrdersPage.jsx
import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import DataTable from '../../components/DataTable.jsx';
import Modal from '../../components/Modal.jsx';
import FormField, { inputCls } from '../../components/FormField.jsx';
import { apiMessage, useList, useOptions } from '../inventory/useList.js';

const COLORS = {
  PLACED: 'bg-amber-100 text-amber-800', CONFIRMED: 'bg-blue-100 text-blue-800', DISPATCHED: 'bg-indigo-100 text-indigo-800',
  DELIVERED: 'bg-green-100 text-green-800', CANCELLED: 'bg-gray-200 text-gray-700',
  PENDING: 'bg-amber-100 text-amber-800', PAID: 'bg-green-100 text-green-800', REFUND_DUE: 'bg-red-100 text-red-800',
};
const Badge = ({ v }) => <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${COLORS[v] || ''}`}>{v}</span>;
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const blankItem = { product_id: '', qty: '' };
const blankForm = { member_code: '', location_id: '', items: [{ ...blankItem }] };
const btn = 'h-11 px-5 rounded-lg text-sm font-semibold disabled:opacity-60';

// base: API prefix. Admin: '/orders' (can place + cancel). Depo panel: base='/depo/orders', couriers='/depo/couriers', canPlace/canCancel false.
export default function OrdersPage({ base = '/orders', couriersEndpoint = '/inventory/couriers', canPlace = true, canCancel = true, title = 'Orders' }) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [pay, setPay] = useState('');
  const { rows, total, loading, error, reload } = useList(base, { page, limit: 20, q, status, payment_status: pay });
  const locations = useOptions(canPlace ? '/inventory/locations' : null);
  const couriers = useOptions(couriersEndpoint);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [member, setMember] = useState(null); // looked-up member, or false when not found
  const [avail, setAvail] = useState([]);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [viewing, setViewing] = useState(null);
  const [disp, setDisp] = useState(null); // { courier_id, tracking_no } while the dispatch form is open
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  // Only products with stock at the chosen location can be ordered. The server re-checks stock when saving and again at payment.
  useEffect(() => {
    if (!creating || !form.location_id) { setAvail([]); return undefined; }
    let off = false;
    (async () => {
      const all = [];
      try {
        for (let p = 1; p <= 20; p++) {
          const { data } = await api.get('/inventory/stock-report', { params: { location_id: form.location_id, limit: 100, page: p } });
          all.push(...data.rows);
          if (all.length >= data.total || data.rows.length === 0) break;
        }
      } catch { /* list stays empty */ }
      if (!off) setAvail(all.filter((r) => r.qty > 0));
    })();
    return () => { off = true; };
  }, [creating, form.location_id]);

  const setItem = (idx, patch) => setForm((f) => ({ ...f, items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }));
  const stockOf = (pid) => avail.find((a) => String(a.product_id) === String(pid))?.qty;

  async function lookup() {
    const code = form.member_code.trim();
    if (!code) return;
    try {
      const { data } = await api.get('/orders/member-lookup', { params: { code } });
      setMember(data);
    } catch { setMember(false); }
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      await api.post(base, {
        member_code: form.member_code.trim(), location_id: Number(form.location_id),
        items: form.items.map((i) => ({ product_id: Number(i.product_id), qty: Number(i.qty) })),
      });
      setCreating(false);
      setPage(1);
      reload();
    } catch (err) {
      setFormError(apiMessage(err, 'Could not place the order'));
    } finally {
      setSaving(false);
    }
  }

  async function view(row) {
    setActionError(''); setDisp(null);
    try {
      const { data } = await api.get(`${base}/${row.id}`);
      setViewing(data);
    } catch (err) { setActionError(apiMessage(err, 'Could not open the order')); }
  }

  async function act(kind, body) {
    if (kind === 'cancel' && !window.confirm(`Cancel ${viewing.order_no}?${viewing.payment_status === 'PAID' ? ' The stock goes back and a refund becomes due.' : ''}`)) return;
    setBusy(true); setActionError('');
    try {
      const { data } = await api.put(`${base}/${viewing.id}/${kind}`, body);
      setViewing(data); setDisp(null);
    } catch (err) { setActionError(apiMessage(err, `Could not ${kind} the order`)); }
    finally { setBusy(false); reload(); }
  }

  const columns = [
    { key: 'order_no', label: 'Order' },
    { key: 'member', label: 'Member', render: (r) => `${r.member_name} (${r.member_code})` },
    { key: 'location_name', label: 'Location' },
    { key: 'total', label: 'Total', render: (r) => money(r.total) },
    { key: 'status', label: 'Status', render: (r) => <Badge v={r.status} /> },
    { key: 'payment_status', label: 'Payment', render: (r) => <Badge v={r.payment_status} /> },
    { key: 'courier', label: 'Courier / tracking', render: (r) => (r.dispatched_at ? `${r.courier_name || 'Hand delivery'}${r.tracking_no ? ` · ${r.tracking_no}` : ''}` : '—') },
    { key: 'created_at', label: 'Date', render: (r) => new Date(r.created_at).toLocaleDateString('en-IN') },
    { key: 'a', label: '', render: (r) => <button type="button" onClick={() => view(r)} className="h-9 px-3 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">View</button> },
  ];

  const o = viewing;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{title}</h1>
        <div className="flex flex-wrap gap-3">
          <label htmlFor="o-status" className="sr-only">Status</label>
          <select id="o-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={`${inputCls} w-40`}>
            <option value="">All statuses</option>
            {['PLACED', 'CONFIRMED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'].map((s) => <option key={s}>{s}</option>)}
          </select>
          <label htmlFor="o-pay" className="sr-only">Payment</label>
          <select id="o-pay" value={pay} onChange={(e) => { setPay(e.target.value); setPage(1); }} className={`${inputCls} w-40`}>
            <option value="">All payments</option>
            {['PENDING', 'PAID', 'REFUND_DUE'].map((s) => <option key={s}>{s}</option>)}
          </select>
          <label htmlFor="o-search" className="sr-only">Search</label>
          <input id="o-search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search order or member" className={`${inputCls} w-56`} />
          {canPlace && <button type="button" onClick={() => { setForm(blankForm); setMember(null); setFormError(''); setCreating(true); }}
            className="h-11 px-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">New order</button>}
        </div>
      </div>
      {(error || (!viewing && actionError)) && <p role="alert" className="text-sm text-red-600">{error || actionError}</p>}
      <DataTable columns={columns} rows={rows} loading={loading} page={page} limit={20} total={total} onPage={setPage} emptyText="No orders found" />

      {canPlace && <Modal open={creating} title="New order" onClose={() => setCreating(false)}>
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-gray-600">Prices and GST come from the product master. Stock is taken when the order is marked paid.</p>
          <FormField id="o-member" label="Member ID" required>
            <input id="o-member" required value={form.member_code} onBlur={lookup} onChange={(e) => { setForm({ ...form, member_code: e.target.value }); setMember(null); }} className={inputCls} />
            {member && <span className="text-xs text-green-700">{member.full_name}</span>}
            {member === false && <span className="text-xs text-red-600">Member not found</span>}
          </FormField>
          <FormField id="o-loc" label="Dispatch from" required>
            <select id="o-loc" required value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value, items: [{ ...blankItem }] })} className={inputCls}>
              <option value="">Select…</option>
              {locations.filter((l) => l.active !== false).map((l) => <option key={l.id} value={l.id}>{l.name} ({l.type})</option>)}
            </select>
          </FormField>
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-700">Products</div>
            {!form.location_id && <p className="text-sm text-gray-500">Choose the location to see what is in stock.</p>}
            {form.location_id && avail.length === 0 && <p className="text-sm text-gray-500">No stock at this location.</p>}
            {form.location_id && avail.length > 0 && form.items.map((it, idx) => {
              const have = stockOf(it.product_id);
              const taken = form.items.map((x, i) => (i !== idx ? String(x.product_id) : null));
              return (
                <div key={idx} className="rounded-lg border border-gray-200 p-3 space-y-2">
                  <select aria-label="Product" required value={it.product_id} onChange={(e) => setItem(idx, { product_id: e.target.value, qty: '' })} className={inputCls}>
                    <option value="">Select product…</option>
                    {avail.filter((a) => !taken.includes(String(a.product_id))).map((a) => <option key={a.product_id} value={a.product_id}>{a.sku} · {a.name} (available {a.qty})</option>)}
                  </select>
                  <input aria-label="Quantity" type="number" min="1" max={have ?? undefined} step="1" required placeholder={have ? `Qty (max ${have})` : 'Qty'}
                    value={it.qty} onChange={(e) => setItem(idx, { qty: e.target.value })} className={inputCls} />
                  {form.items.length > 1 && <button type="button" onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })} className="text-xs text-red-600">Remove</button>}
                </div>
              );
            })}
            {form.location_id && avail.length > form.items.length && (
              <button type="button" onClick={() => setForm({ ...form, items: [...form.items, { ...blankItem }] })} className="h-10 px-3 rounded-lg border border-dashed border-gray-400 text-sm">+ Add product</button>
            )}
          </div>
          {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setCreating(false)} className={`${btn} border border-gray-300`}>Cancel</button>
            <button type="submit" disabled={saving || !form.location_id || avail.length === 0} className={`${btn} bg-indigo-600 text-white`}>{saving ? 'Placing…' : 'Place order'}</button>
          </div>
        </form>
      </Modal>}

      <Modal open={!!o} title={o ? o.order_no : ''} onClose={() => setViewing(null)}>
        {o && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2"><Badge v={o.status} /><Badge v={o.payment_status} />
              <span className="text-gray-600">{o.member_name} ({o.member_code}) · {o.location_name}</span></div>
            <ul className="divide-y divide-gray-100">
              {o.items.map((i) => (
                <li key={i.id} className="py-2 flex justify-between gap-3">
                  <span>{i.product_name}<br /><span className="text-xs text-gray-500">{i.sku} · {money(i.price)} × {i.qty}</span></span>
                  <span>{money(i.price * i.qty)}</span>
                </li>))}
            </ul>
            <dl className="grid grid-cols-2 gap-1 text-right">
              <dt className="text-gray-500">Subtotal</dt><dd>{money(o.subtotal)}</dd>
              <dt className="text-gray-500">GST</dt><dd>{money(o.gst_amount)}</dd>
              <dt className="font-semibold">Total</dt><dd className="font-semibold">{money(o.total)}</dd>
              <dt className="text-gray-500">BV</dt><dd>{o.total_bv}</dd>
            </dl>
            {o.dispatched_at && (
              <div className="rounded-lg bg-gray-50 p-3 space-y-1">
                <div>Courier: <b>{o.courier_name || 'Hand delivery'}</b></div>
                {o.tracking_no && <div>Tracking: {o.tracking_url
                  ? <a href={o.tracking_url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">{o.tracking_no}</a> : o.tracking_no}</div>}
                <div className="text-xs text-gray-500">Dispatched {new Date(o.dispatched_at).toLocaleString('en-IN')}{o.delivered_at && ` · Delivered ${new Date(o.delivered_at).toLocaleString('en-IN')}`}</div>
              </div>)}
            {actionError && <p role="alert" className="text-red-600">{actionError}</p>}
            {disp ? (
              <form onSubmit={(e) => { e.preventDefault(); act('dispatch', { courier_id: disp.courier_id ? Number(disp.courier_id) : undefined, tracking_no: disp.tracking_no }); }} className="space-y-3">
                <select aria-label="Courier" value={disp.courier_id} onChange={(e) => setDisp({ ...disp, courier_id: e.target.value })} className={inputCls}>
                  <option value="">No courier (hand delivery)</option>
                  {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input aria-label="Tracking number" maxLength={100} placeholder="Tracking number (optional)" value={disp.tracking_no} onChange={(e) => setDisp({ ...disp, tracking_no: e.target.value })} className={inputCls} />
                <div className="flex gap-3">
                  <button type="submit" disabled={busy} className={`${btn} bg-indigo-600 text-white`}>Confirm dispatch</button>
                  <button type="button" onClick={() => setDisp(null)} className={`${btn} border border-gray-300`}>Back</button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap gap-3">
                {o.status === 'PLACED' && <button type="button" disabled={busy} onClick={() => act('pay')} className={`${btn} bg-indigo-600 text-white`}>Mark paid</button>}
                {o.status === 'CONFIRMED' && <button type="button" onClick={() => setDisp({ courier_id: '', tracking_no: '' })} className={`${btn} bg-indigo-600 text-white`}>Dispatch</button>}
                {o.status === 'DISPATCHED' && <button type="button" disabled={busy} onClick={() => act('deliver')} className={`${btn} bg-green-600 text-white`}>Mark delivered</button>}
                {canCancel && ['PLACED', 'CONFIRMED'].includes(o.status) && <button type="button" disabled={busy} onClick={() => act('cancel')} className={`${btn} border border-red-300 text-red-700`}>Cancel order</button>}
              </div>)}
          </div>
        )}
      </Modal>
    </div>
  );
}

// client/src/features/orders/JoiningPackagesPage.jsx  (admin: joining package delivery + returns)
import { useState } from 'react';
import { api } from '../../api/client.js';
import DataTable from '../../components/DataTable.jsx';
import Modal from '../../components/Modal.jsx';
import { inputCls } from '../../components/FormField.jsx';
import { apiMessage, useList, useOptions } from '../inventory/useList.js';

const COLORS = {
  PENDING: 'bg-amber-100 text-amber-800', DISPATCHED: 'bg-indigo-100 text-indigo-800', DELIVERED: 'bg-green-100 text-green-800',
  REQUESTED: 'bg-amber-100 text-amber-800', CONFIRMED: 'bg-green-100 text-green-800', REJECTED: 'bg-gray-200 text-gray-700',
};
const Badge = ({ v }) => <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${COLORS[v] || ''}`}>{v}</span>;
const btn = 'h-11 px-5 rounded-lg text-sm font-semibold disabled:opacity-60';
const small = 'h-9 px-3 rounded-lg border border-gray-300 text-sm hover:bg-gray-50';

export default function JoiningPackagesPage() {
  const [tab, setTab] = useState('deliveries');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const isDel = tab === 'deliveries';
  const path = isDel ? '/orders/joining-deliveries' : '/orders/package-returns';
  const { rows, total, loading, error, reload } = useList(path, { page, limit: 20, q, status });
  const locations = useOptions('/inventory/locations');
  const couriers = useOptions('/inventory/couriers');

  const [viewing, setViewing] = useState(null); // delivery detail
  const [disp, setDisp] = useState(null);
  const [ret, setRet] = useState(null); // { reason } while the return form is open
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  function switchTab(t) { setTab(t); setPage(1); setStatus(''); setQ(''); setActionError(''); }

  async function open(row) {
    setActionError(''); setDisp(null); setRet(null);
    try { setViewing((await api.get(`/orders/joining-deliveries/${row.id}`)).data); }
    catch (err) { setActionError(apiMessage(err, 'Could not open the delivery')); }
  }
  // run an action, then refresh the open delivery so the buttons match its new state
  async function run(fn, fail) {
    setBusy(true); setActionError('');
    try {
      await fn();
      if (viewing) setViewing((await api.get(`/orders/joining-deliveries/${viewing.id}`)).data);
      setDisp(null); setRet(null);
    } catch (err) { setActionError(apiMessage(err, fail)); }
    finally { setBusy(false); reload(); }
  }
  const returnAct = async (r, kind) => {
    if (kind === 'confirm' && !window.confirm(`Confirm the return for ${r.member_name}? The package contents go back into stock at ${r.location_name || 'its location'}.`)) return;
    setActionError('');
    try { await api.put(`/orders/package-returns/${r.id}/${kind}`); } catch (err) { setActionError(apiMessage(err, `Could not ${kind} the return`)); }
    reload();
  };

  const delCols = [
    { key: 'member', label: 'Member', render: (r) => `${r.member_name} (${r.member_code})` },
    { key: 'package_name', label: 'Package' },
    { key: 'status', label: 'Status', render: (r) => <Badge v={r.status} /> },
    { key: 'return_status', label: 'Return', render: (r) => (r.return_status ? <Badge v={r.return_status} /> : '—') },
    { key: 'location_name', label: 'From', render: (r) => r.location_name || '—' },
    { key: 'courier', label: 'Courier / tracking', render: (r) => (r.status === 'PENDING' ? '—' : `${r.courier_name || 'Hand delivery'}${r.tracking_no ? ` · ${r.tracking_no}` : ''}`) },
    { key: 'a', label: '', render: (r) => <button type="button" onClick={() => open(r)} className={small}>View</button> },
  ];
  const retCols = [
    { key: 'member', label: 'Member', render: (r) => `${r.member_name} (${r.member_code})` },
    { key: 'package_name', label: 'Package', render: (r) => r.package_name || '—' },
    { key: 'reason', label: 'Reason', render: (r) => r.reason || '—' },
    { key: 'status', label: 'Status', render: (r) => <Badge v={r.status} /> },
    { key: 'a', label: '', render: (r) => (r.status === 'REQUESTED' ? (
      <span className="flex gap-2">
        <button type="button" onClick={() => returnAct(r, 'confirm')} className={small}>Confirm</button>
        <button type="button" onClick={() => returnAct(r, 'reject')} className={`${small} text-red-700`}>Reject</button>
      </span>) : (r.location_name ? <span className="text-xs text-gray-500">{r.location_name}</span> : null)) },
  ];

  const d = viewing;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Joining Packages</h1>
        <div className="flex flex-wrap gap-3">
          <label htmlFor="jp-status" className="sr-only">Status</label>
          <select id="jp-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={`${inputCls} w-40`}>
            <option value="">All statuses</option>
            {(isDel ? ['PENDING', 'DISPATCHED', 'DELIVERED'] : ['REQUESTED', 'CONFIRMED', 'REJECTED']).map((s) => <option key={s}>{s}</option>)}
          </select>
          <label htmlFor="jp-search" className="sr-only">Search</label>
          <input id="jp-search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search member or package" className={`${inputCls} w-56`} />
        </div>
      </div>
      <div role="tablist" className="flex gap-2">
        {[['deliveries', 'Deliveries'], ['returns', 'Returns']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => switchTab(k)}
            className={`h-10 px-4 rounded-lg text-sm font-semibold ${tab === k ? 'bg-indigo-600 text-white' : 'border border-gray-300'}`}>{label}</button>))}
      </div>
      {(error || (!viewing && actionError)) && <p role="alert" className="text-sm text-red-600">{error || actionError}</p>}
      <DataTable columns={isDel ? delCols : retCols} rows={rows} loading={loading} page={page} limit={20} total={total} onPage={setPage}
        emptyText={isDel ? 'No package deliveries yet' : 'No returns yet'} />

      <Modal open={!!d} title={d ? `${d.package_name} → ${d.member_name}` : ''} onClose={() => setViewing(null)}>
        {d && (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-2"><Badge v={d.status} />{d.return_status && <Badge v={d.return_status} />}</div>
            <ul className="divide-y divide-gray-100">
              {d.items.map((i) => <li key={i.product_id} className="py-2 flex justify-between"><span>{i.product_name} <span className="text-xs text-gray-500">{i.sku}</span></span><span>× {i.qty}</span></li>)}
            </ul>
            {d.status !== 'PENDING' && (
              <div className="rounded-lg bg-gray-50 p-3 space-y-1">
                <div>Sent from <b>{d.location_name}</b> · Courier: <b>{d.courier_name || 'Hand delivery'}</b></div>
                {d.tracking_no && <div>Tracking: {d.tracking_no}</div>}
                {d.delivered_at && <div className="text-xs text-gray-500">Delivered {new Date(d.delivered_at).toLocaleString('en-IN')}</div>}
              </div>)}
            {actionError && <p role="alert" className="text-red-600">{actionError}</p>}
            {disp && (
              <form onSubmit={(e) => { e.preventDefault(); run(() => api.put(`/orders/joining-deliveries/${d.id}/dispatch`, { location_id: Number(disp.location_id), courier_id: disp.courier_id ? Number(disp.courier_id) : undefined, tracking_no: disp.tracking_no }), 'Could not dispatch'); }} className="space-y-3">
                <p className="text-gray-600">The package contents leave this location&apos;s stock.</p>
                <select aria-label="Dispatch from" required value={disp.location_id} onChange={(e) => setDisp({ ...disp, location_id: e.target.value })} className={inputCls}>
                  <option value="">Dispatch from…</option>
                  {locations.filter((l) => l.active !== false).map((l) => <option key={l.id} value={l.id}>{l.name} ({l.type})</option>)}
                </select>
                <select aria-label="Courier" value={disp.courier_id} onChange={(e) => setDisp({ ...disp, courier_id: e.target.value })} className={inputCls}>
                  <option value="">No courier (hand delivery)</option>
                  {couriers.filter((c) => c.active !== false).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input aria-label="Tracking number" maxLength={100} placeholder="Tracking number (optional)" value={disp.tracking_no} onChange={(e) => setDisp({ ...disp, tracking_no: e.target.value })} className={inputCls} />
                <div className="flex gap-3">
                  <button type="submit" disabled={busy} className={`${btn} bg-indigo-600 text-white`}>Confirm dispatch</button>
                  <button type="button" onClick={() => setDisp(null)} className={`${btn} border border-gray-300`}>Back</button>
                </div>
              </form>)}
            {ret && (
              <form onSubmit={(e) => { e.preventDefault(); run(() => api.post('/orders/package-returns', { delivery_id: d.id, reason: ret.reason }), 'Could not request the return'); }} className="space-y-3">
                <input aria-label="Reason" maxLength={500} placeholder="Reason (optional)" value={ret.reason} onChange={(e) => setRet({ reason: e.target.value })} className={inputCls} />
                <div className="flex gap-3">
                  <button type="submit" disabled={busy} className={`${btn} bg-indigo-600 text-white`}>Request return</button>
                  <button type="button" onClick={() => setRet(null)} className={`${btn} border border-gray-300`}>Back</button>
                </div>
              </form>)}
            {!disp && !ret && (
              <div className="flex flex-wrap gap-3">
                {d.status === 'PENDING' && <button type="button" onClick={() => setDisp({ location_id: '', courier_id: '', tracking_no: '' })} className={`${btn} bg-indigo-600 text-white`}>Dispatch</button>}
                {d.status === 'DISPATCHED' && !['REQUESTED', 'CONFIRMED'].includes(d.return_status) &&
                  <button type="button" disabled={busy} onClick={() => run(() => api.put(`/orders/joining-deliveries/${d.id}/deliver`), 'Could not mark delivered')} className={`${btn} bg-green-600 text-white`}>Mark delivered</button>}
                {d.status !== 'PENDING' && !['REQUESTED', 'CONFIRMED'].includes(d.return_status) &&
                  <button type="button" onClick={() => setRet({ reason: '' })} className={`${btn} border border-gray-300`}>Request return</button>}
              </div>)}
          </div>
        )}
      </Modal>
    </div>
  );
}

// client/src/features/support/SupportDeskPage.jsx  (admin: triage, assign, reply, resolve)
import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import DataTable from '../../components/DataTable.jsx';
import Modal from '../../components/Modal.jsx';
import { inputCls } from '../../components/FormField.jsx';
import { apiMessage, useList, useOptions } from '../inventory/useList.js';
import { Messages, Pill, when } from './ticketBits.jsx';

const small = 'h-9 px-3 rounded-lg border border-gray-300 text-sm hover:bg-gray-50';
const NO_OPTS = { statuses: [], priorities: [], categories: [] };

export default function SupportDeskPage() {
  const [opts, setOpts] = useState(NO_OPTS);
  const [f, setF] = useState({ status: '', priority: '', category: '', assigned: '', q: '' });
  const [page, setPage] = useState(1);
  const { rows, total, loading, error, reload } = useList('/support/tickets', { page, limit: 20, ...f });
  const [counts, setCounts] = useState(null);
  const staff = useOptions('/support/staff');

  const [open, setOpen] = useState(null); // ticket thread
  const [reply, setReply] = useState('');
  const [resolution, setResolution] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/support/options').then(({ data }) => setOpts(data)).catch(() => {}); }, []);
  const loadCounts = () => api.get('/support/stats').then(({ data }) => setCounts(data)).catch(() => {});
  useEffect(() => { loadCounts(); }, [rows]); // refresh the counts whenever the list reloads

  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPage(1); };

  async function openTicket(row) {
    setErr(''); setReply(''); setResolution('');
    try { const { data } = await api.get(`/support/tickets/${row.id}`); setOpen(data); setResolution(data.resolution || ''); }
    catch (e) { setErr(apiMessage(e, 'Could not open the ticket')); }
  }
  async function run(fn, fail) {
    setBusy(true); setErr('');
    try { const { data } = await fn(); setOpen(data); setResolution(data.resolution || ''); }
    catch (e) { setErr(apiMessage(e, fail)); }
    finally { setBusy(false); reload(); }
  }
  const patch = (body, fail = 'Could not update the ticket') => run(() => api.put(`/support/tickets/${open.id}`, body), fail);
  const sendReply = (e) => { e.preventDefault(); run(() => api.post(`/support/tickets/${open.id}/reply`, { body: reply }), 'Could not send the reply').then(() => setReply('')); };

  const cols = [
    { key: 'id', label: '#', render: (r) => `#${r.id}` },
    { key: 'subject', label: 'Subject', render: (r) => <span>{r.subject}<br /><span className="text-xs text-gray-500">{r.member_name} ({r.member_code}) · {r.category}</span></span> },
    { key: 'status', label: 'Status', render: (r) => <Pill v={r.status} /> },
    { key: 'priority', label: 'Priority', render: (r) => <Pill v={r.priority} /> },
    { key: 'assigned_name', label: 'Assigned', render: (r) => r.assigned_name || <span className="text-gray-400">Unassigned</span> },
    { key: 'last_message_at', label: 'Last activity', render: (r) => when(r.last_message_at) },
    { key: 'a', label: '', render: (r) => <button type="button" onClick={() => openTicket(r)} className={small}>Open</button> },
  ];
  const sel = (id, label, v, onChange, options) => (
    <>
      <label htmlFor={id} className="sr-only">{label}</label>
      <select id={id} value={v} onChange={onChange} className={`${inputCls} w-40`}>
        <option value="">{label}</option>{options.map((o) => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? String(o).replace('_', ' ')}</option>)}
      </select>
    </>
  );
  const resolved = open && ['RESOLVED', 'CLOSED'].includes(open.status);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Support Tickets</h1>
      {counts && (
        <div className="flex flex-wrap gap-3">
          {[['Open', counts.open], ['In progress', counts.in_progress], ['Resolved', counts.resolved], ['Closed', counts.closed], ['Unassigned (active)', counts.unassigned]].map(([l, n]) => (
            <div key={l} className="rounded-xl border border-gray-200 bg-white px-4 py-2 min-w-28"><div className="text-xs text-gray-500">{l}</div><div className="text-xl font-semibold">{n}</div></div>))}
        </div>)}
      <div className="flex flex-wrap gap-3">
        {sel('sd-status', 'All statuses', f.status, set('status'), opts.statuses)}
        {sel('sd-priority', 'All priorities', f.priority, set('priority'), opts.priorities)}
        {sel('sd-category', 'All categories', f.category, set('category'), opts.categories)}
        {sel('sd-assigned', 'Anyone', f.assigned, set('assigned'), [{ value: 'me', label: 'Assigned to me' }, { value: 'none', label: 'Unassigned' }, ...staff.map((s) => ({ value: s.id, label: s.login_id }))])}
        <label htmlFor="sd-q" className="sr-only">Search</label>
        <input id="sd-q" value={f.q} onChange={set('q')} placeholder="Search subject or member" className={`${inputCls} w-56`} />
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <DataTable columns={cols} rows={rows} loading={loading} page={page} limit={20} total={total} onPage={setPage} emptyText="No tickets found" />

      <Modal open={!!open} title={open ? `#${open.id} ${open.subject}` : ''} onClose={() => setOpen(null)}>
        {open && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2"><Pill v={open.status} /><Pill v={open.priority} />
              <span className="text-gray-600">{open.member_name} ({open.member_code}) · opened {when(open.created_at)}</span></div>
            <Messages messages={open.messages} />
            {err && <p role="alert" className="text-red-600">{err}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs text-gray-500">Status
                <select value={open.status} disabled={busy} onChange={(e) => patch({ status: e.target.value })} className={inputCls}>{opts.statuses.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></label>
              <label className="text-xs text-gray-500">Priority
                <select value={open.priority} disabled={busy} onChange={(e) => patch({ priority: e.target.value })} className={inputCls}>{opts.priorities.map((s) => <option key={s}>{s}</option>)}</select></label>
              <label className="text-xs text-gray-500">Category
                <select value={open.category} disabled={busy} onChange={(e) => patch({ category: e.target.value })} className={inputCls}>{opts.categories.map((s) => <option key={s}>{s}</option>)}</select></label>
              <label className="text-xs text-gray-500">Assigned to
                <select value={open.assigned_to ?? ''} disabled={busy} onChange={(e) => patch({ assigned_to: e.target.value ? Number(e.target.value) : null })} className={inputCls}>
                  <option value="">Unassigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.login_id}</option>)}</select></label>
            </div>
            {resolved && (
              <div className="space-y-2 rounded-lg bg-green-50 border border-green-200 p-3">
                <div className="text-xs text-gray-600">Resolved {when(open.resolved_at)}</div>
                <input aria-label="Resolution" maxLength={2000} placeholder="What fixed it (optional)" value={resolution} onChange={(e) => setResolution(e.target.value)} className={inputCls} />
                <button type="button" disabled={busy} onClick={() => patch({ resolution })} className={small}>Save resolution</button>
              </div>)}
            {open.status !== 'CLOSED' ? (
              <form onSubmit={sendReply} className="space-y-2">
                <textarea aria-label="Reply" required maxLength={5000} rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply…" className={`${inputCls} h-auto py-2`} />
                <div className="flex flex-wrap gap-3">
                  <button type="submit" disabled={busy || !reply.trim()} className="h-11 px-5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-60">Send reply</button>
                  {open.status !== 'RESOLVED' && <button type="button" disabled={busy} onClick={() => patch({ status: 'RESOLVED' })} className="h-11 px-4 rounded-lg border border-green-300 text-green-800 text-sm">Mark resolved</button>}
                </div>
              </form>
            ) : <p className="text-gray-500">This ticket is closed. Change the status above to reopen it.</p>}
          </div>)}
      </Modal>
    </div>
  );
}

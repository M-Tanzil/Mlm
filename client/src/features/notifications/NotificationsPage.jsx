// client/src/features/notifications/NotificationsPage.jsx  (admin: email/SMS delivery log, status counts, templates)
import { useState } from 'react';
import { api } from '../../api/client.js';
import DataTable from '../../components/DataTable.jsx';
import { inputCls } from '../../components/FormField.jsx';
import { apiMessage, useList } from '../inventory/useList.js';

const COLORS = {
  QUEUED: 'bg-amber-100 text-amber-800', SENDING: 'bg-blue-100 text-blue-800', SENT: 'bg-green-100 text-green-800', FAILED: 'bg-red-100 text-red-800',
};
const Badge = ({ v }) => <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${COLORS[v] || ''}`}>{v}</span>;
const small = 'h-9 px-3 rounded-lg border border-gray-300 text-sm hover:bg-gray-50';

export default function NotificationsPage() {
  const [tab, setTab] = useState('log');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  const [template, setTemplate] = useState('');
  const log = useList(tab === 'log' ? '/notifications' : null, { page, limit: 20, q, status, channel, template });
  const stats = useList('/notifications/stats', {});
  const templates = useList('/notifications/templates', {});
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState(null);

  const count = (s) => stats.rows.filter((r) => r.status === s).reduce((a, r) => a + r.n, 0);

  async function resend(r) {
    setBusyId(r.id); setNote('');
    try {
      const { data } = await api.put(`/notifications/${r.id}/resend`);
      setNote(data.status === 'SENT' ? `Notification #${r.id} sent.` : `Notification #${r.id} failed again: ${data.error}`);
    } catch (err) { setNote(apiMessage(err, 'Could not resend')); }
    finally { setBusyId(null); log.reload(); stats.reload(); }
  }
  const pick = (setter) => (e) => { setter(e.target.value); setPage(1); };

  const logCols = [
    { key: 'created_at', label: 'When', render: (r) => new Date(r.created_at).toLocaleString('en-IN') },
    { key: 'channel', label: 'Channel' },
    { key: 'to', label: 'To', render: (r) => r.recipient || r.login_id || '—' },
    { key: 'subject', label: 'Message', render: (r) => <span>{r.subject}<br /><span className="text-xs text-gray-500">{r.template}</span></span> },
    { key: 'status', label: 'Status', render: (r) => (
      <span><Badge v={r.status} />{r.error && <span className="block text-xs text-red-700 mt-1 max-w-xs">{r.error}</span>}</span>) },
    { key: 'a', label: '', render: (r) => (['FAILED', 'SENDING'].includes(r.status) && r.channel !== 'INAPP'
      ? <button type="button" disabled={busyId === r.id} onClick={() => resend(r)} className={`${small} disabled:opacity-60`}>{busyId === r.id ? 'Sending…' : 'Resend'}</button> : null) },
  ];
  const tplCols = [
    { key: 'code', label: 'Template' },
    { key: 'channels', label: 'Channels', render: (r) => r.channels.join(', ') },
    { key: 'subject', label: 'Subject' },
    { key: 'body', label: 'Body', render: (r) => <span className="text-xs">{r.body}</span> },
    { key: 'variables', label: 'Fill-ins', render: (r) => r.variables.map((v) => `{{${v}}}`).join(' ') },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Email &amp; SMS</h1>
      <div className="flex flex-wrap gap-3">
        {['SENT', 'QUEUED', 'SENDING', 'FAILED'].map((s) => (
          <div key={s} className="rounded-xl border border-gray-200 bg-white px-4 py-2 min-w-28">
            <div className="text-xs text-gray-500">{s}</div><div className="text-xl font-semibold">{count(s)}</div>
          </div>))}
      </div>
      <div role="tablist" className="flex gap-2">
        {[['log', 'Delivery log'], ['templates', 'Templates']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`h-10 px-4 rounded-lg text-sm font-semibold ${tab === k ? 'bg-indigo-600 text-white' : 'border border-gray-300'}`}>{label}</button>))}
      </div>
      {tab === 'log' ? (
        <>
          <div className="flex flex-wrap gap-3">
            <label htmlFor="nt-status" className="sr-only">Status</label>
            <select id="nt-status" value={status} onChange={pick(setStatus)} className={`${inputCls} w-40`}>
              <option value="">All statuses</option>{['QUEUED', 'SENDING', 'SENT', 'FAILED'].map((s) => <option key={s}>{s}</option>)}
            </select>
            <label htmlFor="nt-channel" className="sr-only">Channel</label>
            <select id="nt-channel" value={channel} onChange={pick(setChannel)} className={`${inputCls} w-40`}>
              <option value="">All channels</option>{['EMAIL', 'SMS', 'INAPP'].map((s) => <option key={s}>{s}</option>)}
            </select>
            <label htmlFor="nt-template" className="sr-only">Template</label>
            <select id="nt-template" value={template} onChange={pick(setTemplate)} className={`${inputCls} w-52`}>
              <option value="">All templates</option>
              {templates.rows.map((t) => <option key={t.code}>{t.code}</option>)}
            </select>
            <label htmlFor="nt-search" className="sr-only">Search</label>
            <input id="nt-search" value={q} onChange={pick(setQ)} placeholder="Search subject, recipient or login" className={`${inputCls} w-64`} />
          </div>
          {note && <p role="status" className="text-sm rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">{note}</p>}
          {log.error && <p role="alert" className="text-sm text-red-600">{log.error}</p>}
          <DataTable columns={logCols} rows={log.rows} loading={log.loading} page={page} limit={20} total={log.total} onPage={setPage} emptyText="Nothing sent yet" />
        </>
      ) : (
        <>
          <p className="text-sm text-gray-600">Templates are part of the application. To change the wording, the code needs to be updated.</p>
          {templates.error && <p role="alert" className="text-sm text-red-600">{templates.error}</p>}
          <DataTable columns={tplCols} rows={templates.rows} loading={templates.loading} page={1} limit={100} total={templates.total} onPage={() => {}} emptyText="No templates" />
        </>
      )}
    </div>
  );
}

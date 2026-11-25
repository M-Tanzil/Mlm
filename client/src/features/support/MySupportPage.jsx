// client/src/features/support/MySupportPage.jsx  (distributor: raise a ticket, follow it, reply)
import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import DataTable from '../../components/DataTable.jsx';
import Modal from '../../components/Modal.jsx';
import FormField, { inputCls } from '../../components/FormField.jsx';
import { apiMessage, useList } from '../inventory/useList.js';
import { Messages, Pill, when } from './ticketBits.jsx';

const btn = 'h-11 px-5 rounded-lg text-sm font-semibold disabled:opacity-60';

export default function MySupportPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const { rows, total, loading, error, reload } = useList('/support/my/tickets', { page, limit: 20, status });
  const [cats, setCats] = useState(['GENERAL']);
  useEffect(() => { api.get('/support/options').then(({ data }) => setCats(data.categories)).catch(() => {}); }, []);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ subject: '', category: 'GENERAL', body: '' });
  const [formError, setFormError] = useState('');
  const [open, setOpen] = useState(null);
  const [reply, setReply] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function create(e) {
    e.preventDefault(); setBusy(true); setFormError('');
    try { await api.post('/support/my/tickets', form); setCreating(false); setPage(1); reload(); }
    catch (x) { setFormError(apiMessage(x, 'Could not create the ticket')); }
    finally { setBusy(false); }
  }
  async function view(r) {
    setErr(''); setReply('');
    try { setOpen((await api.get(`/support/my/tickets/${r.id}`)).data); } catch (x) { setErr(apiMessage(x, 'Could not open the ticket')); }
  }
  async function send(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try { setOpen((await api.post(`/support/my/tickets/${open.id}/reply`, { body: reply })).data); setReply(''); reload(); }
    catch (x) { setErr(apiMessage(x, 'Could not send the reply')); }
    finally { setBusy(false); }
  }

  const cols = [
    { key: 'id', label: '#', render: (r) => `#${r.id}` },
    { key: 'subject', label: 'Subject', render: (r) => <span>{r.subject}<br /><span className="text-xs text-gray-500">{r.category}</span></span> },
    { key: 'status', label: 'Status', render: (r) => <Pill v={r.status} /> },
    { key: 'last_message_at', label: 'Last activity', render: (r) => when(r.last_message_at) },
    { key: 'a', label: '', render: (r) => <button type="button" onClick={() => view(r)} className="h-9 px-3 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">View</button> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">My Support</h1>
        <div className="flex gap-3">
          <label htmlFor="ms-status" className="sr-only">Status</label>
          <select id="ms-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={`${inputCls} w-40`}>
            <option value="">All tickets</option>{['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <button type="button" onClick={() => { setForm({ subject: '', category: 'GENERAL', body: '' }); setFormError(''); setCreating(true); }}
            className="h-11 px-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">New ticket</button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <DataTable columns={cols} rows={rows} loading={loading} page={page} limit={20} total={total} onPage={setPage} emptyText="You have not raised any tickets" />

      <Modal open={creating} title="New support ticket" onClose={() => setCreating(false)}>
        <form onSubmit={create} className="space-y-4">
          <FormField id="mt-subject" label="Subject" required><input id="mt-subject" required maxLength={200} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className={inputCls} /></FormField>
          <FormField id="mt-cat" label="About" required>
            <select id="mt-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls}>{cats.map((c) => <option key={c}>{c}</option>)}</select></FormField>
          <FormField id="mt-body" label="Describe the problem" required><textarea id="mt-body" required rows={5} maxLength={5000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className={`${inputCls} h-auto py-2`} /></FormField>
          {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setCreating(false)} className={`${btn} border border-gray-300`}>Cancel</button>
            <button type="submit" disabled={busy} className={`${btn} bg-indigo-600 text-white`}>{busy ? 'Sending…' : 'Submit ticket'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!open} title={open ? `#${open.id} ${open.subject}` : ''} onClose={() => setOpen(null)}>
        {open && (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-2"><Pill v={open.status} /><span className="text-gray-500">{open.category}</span></div>
            <Messages messages={open.messages} />
            {open.resolution && <p className="rounded-lg bg-green-50 border border-green-200 p-3"><b>Resolution:</b> {open.resolution}</p>}
            {err && <p role="alert" className="text-red-600">{err}</p>}
            {open.status === 'CLOSED' ? <p className="text-gray-500">This ticket is closed. Raise a new ticket if you need more help.</p> : (
              <form onSubmit={send} className="space-y-2">
                {open.status === 'RESOLVED' && <p className="text-xs text-gray-500">Replying will reopen this ticket.</p>}
                <textarea aria-label="Reply" required rows={3} maxLength={5000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply…" className={`${inputCls} h-auto py-2`} />
                <button type="submit" disabled={busy || !reply.trim()} className={`${btn} bg-indigo-600 text-white`}>Send reply</button>
              </form>)}
          </div>)}
      </Modal>
    </div>
  );
}

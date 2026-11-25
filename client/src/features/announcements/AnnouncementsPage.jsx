// client/src/features/announcements/AnnouncementsPage.jsx  (admin: create, schedule, target, publish, delete)
import { useState } from 'react';
import { api } from '../../api/client.js';
import DataTable from '../../components/DataTable.jsx';
import Modal from '../../components/Modal.jsx';
import FormField, { inputCls } from '../../components/FormField.jsx';
import { apiMessage, useList } from '../inventory/useList.js';

export const TYPES = { NEWS: 'News', EVENT: 'Event', ACHIEVER: 'Achiever', GALLERY: 'Gallery' };
const AUDIENCES = { ALL: 'Everyone', DISTRIBUTOR: 'Distributors', DEPO: 'Depos & franchises' };
const VIS = { LIVE: 'bg-green-100 text-green-800', SCHEDULED: 'bg-blue-100 text-blue-800', EXPIRED: 'bg-gray-200 text-gray-700', DRAFT: 'bg-amber-100 text-amber-800' };
const blank = { type: 'NEWS', title: '', body: '', media_url: '', event_date: '', audience: 'ALL', starts_at: '', expires_at: '', published: true };
const small = 'h-9 px-3 rounded-lg border border-gray-300 text-sm hover:bg-gray-50';
const p2 = (n) => String(n).padStart(2, '0');
const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const toIso = (v) => (v ? new Date(v).toISOString() : null);

export default function AnnouncementsPage() {
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ q: '', type: '', audience: '', visibility: '' });
  const { rows, total, loading, error, reload } = useList('/announcements', { page, limit: 20, ...f });
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const fe = (k) => fieldErrors[k]?.[0];
  const pick = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPage(1); };

  function openForm(row) {
    setForm(row ? { ...blank, ...row, body: row.body ?? '', media_url: row.media_url ?? '', event_date: row.event_date ?? '', starts_at: toLocalInput(row.starts_at), expires_at: toLocalInput(row.expires_at) } : blank);
    setFieldErrors({}); setFormError(''); setEditing(row || {});
  }
  async function submit(e) {
    e.preventDefault(); setSaving(true); setFormError(''); setFieldErrors({});
    const body = { type: form.type, title: form.title, body: form.body, media_url: form.media_url, event_date: form.event_date, audience: form.audience,
      starts_at: toIso(form.starts_at), expires_at: toIso(form.expires_at), published: form.published };
    try {
      if (editing.id) await api.put(`/announcements/${editing.id}`, body); else await api.post('/announcements', body);
      setEditing(null); if (!editing.id) setPage(1); reload();
    } catch (err) {
      const d = err.response?.data;
      setFieldErrors(d?.details?.fieldErrors || {});
      setFormError(d?.details?.fieldErrors ? 'Please fix the fields marked below' : apiMessage(err, 'Could not save'));
    } finally { setSaving(false); }
  }
  async function toggle(r) {
    try { await api.put(`/announcements/${r.id}`, { published: !r.published }); reload(); } catch (err) { setNote(apiMessage(err, 'Could not update')); }
  }
  async function remove(r) {
    if (!window.confirm(`Delete "${r.title}"? This cannot be undone. To hide it for now, unpublish it instead.`)) return;
    try { await api.delete(`/announcements/${r.id}`); reload(); } catch (err) { setNote(apiMessage(err, 'Could not delete')); }
  }

  const cols = [
    { key: 'title', label: 'Title', render: (r) => <span>{r.title}<br /><span className="text-xs text-gray-500">{TYPES[r.type]} · for {AUDIENCES[r.audience]}</span></span> },
    { key: 'visibility', label: 'Status', render: (r) => <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${VIS[r.visibility]}`}>{r.visibility}</span> },
    { key: 'window', label: 'Visible', render: (r) => (r.starts_at || r.expires_at ? `${r.starts_at ? new Date(r.starts_at).toLocaleString('en-IN') : 'now'} → ${r.expires_at ? new Date(r.expires_at).toLocaleString('en-IN') : 'no end'}` : 'Always') },
    { key: 'a', label: '', render: (r) => (
      <div className="flex flex-wrap gap-2 justify-end">
        <button type="button" onClick={() => openForm(r)} className={small}>Edit</button>
        <button type="button" onClick={() => toggle(r)} className={small}>{r.published ? 'Unpublish' : 'Publish'}</button>
        <button type="button" onClick={() => remove(r)} className={`${small} text-red-700`}>Delete</button>
      </div>) },
  ];
  const sel = (id, label, k, map) => (
    <><label htmlFor={id} className="sr-only">{label}</label>
      <select id={id} value={f[k]} onChange={pick(k)} className={`${inputCls} w-40`}><option value="">{label}</option>{Object.entries(map).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Announcements</h1>
        <div className="flex flex-wrap gap-3">
          {sel('an-type', 'All types', 'type', TYPES)}
          {sel('an-aud', 'All audiences', 'audience', AUDIENCES)}
          {sel('an-vis', 'Any status', 'visibility', { LIVE: 'Live', SCHEDULED: 'Scheduled', EXPIRED: 'Expired', DRAFT: 'Draft' })}
          <label htmlFor="an-q" className="sr-only">Search</label>
          <input id="an-q" value={f.q} onChange={pick('q')} placeholder="Search title" className={`${inputCls} w-48`} />
          <button type="button" onClick={() => openForm(null)} className="h-11 px-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">New announcement</button>
        </div>
      </div>
      {note && <p role="alert" className="text-sm text-red-600">{note}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <DataTable columns={cols} rows={rows} loading={loading} page={page} limit={20} total={total} onPage={setPage} emptyText="No announcements yet" />

      <Modal open={editing !== null} title={editing?.id ? 'Edit announcement' : 'New announcement'} onClose={() => setEditing(null)}>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField id="an-f-type" label="Type" required error={fe('type')}><select id="an-f-type" value={form.type} onChange={set('type')} className={inputCls}>{Object.entries(TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></FormField>
            <FormField id="an-f-aud" label="Show to" required error={fe('audience')}><select id="an-f-aud" value={form.audience} onChange={set('audience')} className={inputCls}>{Object.entries(AUDIENCES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></FormField>
          </div>
          <FormField id="an-f-title" label="Title" required error={fe('title')}><input id="an-f-title" required maxLength={200} value={form.title} onChange={set('title')} className={inputCls} /></FormField>
          <FormField id="an-f-body" label="Details" error={fe('body')}><textarea id="an-f-body" rows={4} maxLength={5000} value={form.body} onChange={set('body')} className={`${inputCls} h-auto py-2`} /></FormField>
          <FormField id="an-f-media" label="Image or link" error={fe('media_url')}><input id="an-f-media" placeholder="https://…" value={form.media_url} onChange={set('media_url')} className={inputCls} /></FormField>
          {form.type === 'EVENT' && <FormField id="an-f-event" label="Event date" error={fe('event_date')}><input id="an-f-event" type="date" value={form.event_date} onChange={set('event_date')} className={inputCls} /></FormField>}
          <div className="grid grid-cols-2 gap-3">
            <FormField id="an-f-start" label="Show from" error={fe('starts_at')}><input id="an-f-start" type="datetime-local" value={form.starts_at} onChange={set('starts_at')} className={inputCls} /></FormField>
            <FormField id="an-f-end" label="Hide after" error={fe('expires_at')}><input id="an-f-end" type="datetime-local" min={form.starts_at || undefined} value={form.expires_at} onChange={set('expires_at')} className={inputCls} /></FormField>
          </div>
          <p className="text-xs text-gray-500">Leave the dates empty to show it straight away and keep showing it.</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} /> Published (untick to keep it as a draft)</label>
          {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setEditing(null)} className="h-11 px-4 rounded-lg border border-gray-300 text-sm">Cancel</button>
            <button type="submit" disabled={saving} className="h-11 px-5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-60">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

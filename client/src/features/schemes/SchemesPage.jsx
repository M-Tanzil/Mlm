// client/src/features/schemes/SchemesPage.jsx  (admin: schemes / offers / achievement definitions)
import { useState } from 'react';
import { api } from '../../api/client.js';
import DataTable from '../../components/DataTable.jsx';
import Modal from '../../components/Modal.jsx';
import FormField, { inputCls } from '../../components/FormField.jsx';
import { apiMessage, useList } from '../inventory/useList.js';

export const TARGETS = {
  BV: 'Total BV of paid orders', REPURCHASE: '₹ value of paid repurchase orders',
  DIRECTS: 'Direct members joined', NEW_JOINING: 'New members in downline',
};
const PHASE = {
  RUNNING: 'bg-green-100 text-green-800', UPCOMING: 'bg-blue-100 text-blue-800', ENDED: 'bg-gray-200 text-gray-700', INACTIVE: 'bg-gray-200 text-gray-500',
};
export const PhaseBadge = ({ v }) => <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PHASE[v] || ''}`}>{v}</span>;
const blank = { name: '', description: '', target_type: 'BV', target_value: '', reward: '', start_date: '', end_date: '' };
const small = 'h-9 px-3 rounded-lg border border-gray-300 text-sm hover:bg-gray-50';

export default function SchemesPage() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [active, setActive] = useState('');
  const { rows, total, loading, error, reload } = useList('/schemes', { page, limit: 20, q, active: active || undefined });

  const [editing, setEditing] = useState(null); // null closed, {} new, row edit
  const [form, setForm] = useState(blank);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');

  const [viewing, setViewing] = useState(null); // scheme whose qualifiers are open
  const [qPage, setQPage] = useState(1);
  const [onlyWon, setOnlyWon] = useState(false);
  const quals = useList(viewing ? `/schemes/${viewing.id}/qualifiers` : null, { page: qPage, limit: 10, qualified: onlyWon ? 'true' : undefined });

  function openForm(row) {
    setForm(row ? { ...blank, ...row, description: row.description ?? '' } : blank);
    setFieldErrors({}); setFormError(''); setEditing(row || {});
  }
  async function submit(e) {
    e.preventDefault();
    setSaving(true); setFormError(''); setFieldErrors({});
    const body = { name: form.name, description: form.description, target_type: form.target_type, target_value: Number(form.target_value),
      reward: form.reward, start_date: form.start_date, end_date: form.end_date };
    try {
      if (editing.id) await api.put(`/schemes/${editing.id}`, body); else await api.post('/schemes', body);
      setEditing(null); if (!editing.id) setPage(1); reload();
    } catch (err) {
      const d = err.response?.data;
      setFieldErrors(d?.details?.fieldErrors || {});
      setFormError(d?.details?.fieldErrors ? 'Please fix the fields marked below' : apiMessage(err, 'Could not save'));
    } finally { setSaving(false); }
  }
  async function toggle(r) {
    try { await api.put(`/schemes/${r.id}`, { active: !r.active }); reload(); }
    catch (err) { setNote(apiMessage(err, 'Could not update')); }
  }
  async function recalc(r) {
    setNote('');
    try {
      const { data } = await api.post(`/schemes/${r.id}/recalculate`);
      setNote(`${r.name}: ${data.members} member(s) counted, ${data.newly_qualified} newly qualified.`);
      reload(); if (viewing?.id === r.id) quals.reload();
    } catch (err) { setNote(apiMessage(err, 'Could not recalculate')); }
  }
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const fe = (k) => fieldErrors[k]?.[0];

  const columns = [
    { key: 'name', label: 'Scheme', render: (r) => <span>{r.name}<br /><span className="text-xs text-gray-500">{r.reward}</span></span> },
    { key: 'target', label: 'Target', render: (r) => `${r.target_value.toLocaleString('en-IN')} · ${TARGETS[r.target_type]}` },
    { key: 'dates', label: 'Valid', render: (r) => `${r.start_date} → ${r.end_date}` },
    { key: 'phase', label: 'Status', render: (r) => <PhaseBadge v={r.phase} /> },
    { key: 'qualified_count', label: 'Qualified' },
    { key: 'a', label: '', render: (r) => (
      <div className="flex flex-wrap gap-2 justify-end">
        <button type="button" onClick={() => { setQPage(1); setOnlyWon(false); setViewing(r); }} className={small}>Progress</button>
        <button type="button" onClick={() => openForm(r)} className={small}>Edit</button>
        <button type="button" onClick={() => toggle(r)} className={small}>{r.active ? 'Deactivate' : 'Activate'}</button>
      </div>) },
  ];
  const qCols = [
    { key: 'm', label: 'Member', render: (r) => `${r.full_name} (${r.member_code})` },
    { key: 'progress', label: 'Progress', render: (r) => Number(r.progress).toLocaleString('en-IN') },
    { key: 'qualified', label: 'Qualified', render: (r) => (r.qualified ? `Yes · ${new Date(r.qualified_at).toLocaleDateString('en-IN')}` : 'No') },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Schemes &amp; Achievements</h1>
        <div className="flex flex-wrap gap-3">
          <label htmlFor="sc-active" className="sr-only">Status</label>
          <select id="sc-active" value={active} onChange={(e) => { setActive(e.target.value); setPage(1); }} className={`${inputCls} w-40`}>
            <option value="">All statuses</option><option value="true">Active</option><option value="false">Inactive</option>
          </select>
          <label htmlFor="sc-search" className="sr-only">Search</label>
          <input id="sc-search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search scheme or reward" className={`${inputCls} w-56`} />
          <button type="button" onClick={() => openForm(null)} className="h-11 px-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">New scheme</button>
        </div>
      </div>
      {note && <p role="status" className="text-sm rounded-lg bg-green-50 text-green-800 border border-green-200 px-3 py-2">{note}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <DataTable columns={columns} rows={rows} loading={loading} page={page} limit={20} total={total} onPage={setPage} emptyText="No schemes yet" />

      <Modal open={editing !== null} title={editing?.id ? 'Edit scheme' : 'New scheme'} onClose={() => setEditing(null)}>
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-gray-600">A member qualifies when their progress inside the dates reaches the target. Once qualified they stay qualified, even if the target is raised later.</p>
          <FormField id="sc-name" label="Name" required error={fe('name')}><input id="sc-name" required maxLength={150} value={form.name} onChange={set('name')} className={inputCls} /></FormField>
          <FormField id="sc-desc" label="Description" error={fe('description')}><textarea id="sc-desc" rows={2} maxLength={1000} value={form.description} onChange={set('description')} className={`${inputCls} h-auto py-2`} /></FormField>
          <FormField id="sc-type" label="Eligibility" required error={fe('target_type')}>
            <select id="sc-type" value={form.target_type} onChange={set('target_type')} className={inputCls}>
              {Object.entries(TARGETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </FormField>
          <FormField id="sc-target" label="Target" required error={fe('target_value')}><input id="sc-target" type="number" min="0" step="any" required value={form.target_value} onChange={set('target_value')} className={inputCls} /></FormField>
          <FormField id="sc-reward" label="Reward" required error={fe('reward')}><input id="sc-reward" required maxLength={200} value={form.reward} onChange={set('reward')} className={inputCls} /></FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="sc-start" label="Starts" required error={fe('start_date')}><input id="sc-start" type="date" required value={form.start_date} onChange={set('start_date')} className={inputCls} /></FormField>
            <FormField id="sc-end" label="Ends" required error={fe('end_date')}><input id="sc-end" type="date" required min={form.start_date || undefined} value={form.end_date} onChange={set('end_date')} className={inputCls} /></FormField>
          </div>
          {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setEditing(null)} className="h-11 px-4 rounded-lg border border-gray-300 text-sm">Cancel</button>
            <button type="submit" disabled={saving} className="h-11 px-5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-60">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!viewing} title={viewing ? `${viewing.name} — progress` : ''} onClose={() => setViewing(null)}>
        {viewing && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={onlyWon} onChange={(e) => { setOnlyWon(e.target.checked); setQPage(1); }} /> Qualified only</label>
              <button type="button" onClick={() => recalc(viewing)} className={small}>Recalculate now</button>
            </div>
            {quals.error && <p role="alert" className="text-sm text-red-600">{quals.error}</p>}
            <DataTable columns={qCols} rows={quals.rows} loading={quals.loading} page={qPage} limit={10} total={quals.total} onPage={setQPage} emptyText="Nobody has progress yet" />
          </div>)}
      </Modal>
    </div>
  );
}

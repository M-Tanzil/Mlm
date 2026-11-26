// client/src/features/depo/DepoManagementPage.jsx  (admin: depots and franchises + their logins)
import { useState } from 'react';
import { useSelector } from 'react-redux';
import { api } from '../../api/client.js';
import DataTable, { StatusPill } from '../../components/DataTable.jsx';
import Modal from '../../components/Modal.jsx';
import FormField, { inputCls } from '../../components/FormField.jsx';
import { apiMessage, useList } from '../inventory/useList.js';

const blank = { type: 'DEPO', name: '', state: '', city: '', pincode: '', address: '', login_id: '', password: '' };

export default function DepoManagementPage() {
  const role = useSelector((s) => s.auth.role);
  const isSuper = role === 'SUPER_ADMIN';
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ q: '', type: '', active: '' });
  const { rows, total, loading, error, reload } = useList('/inventory/depos', { page, limit: 20, ...f });
  const [editing, setEditing] = useState(null); // null closed, {} new, row = edit
  const [form, setForm] = useState(blank);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setFilter = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPage(1); };

  function openNew() { setForm(blank); setFormError(''); setEditing({}); }
  function openEdit(r) {
    setForm({ ...blank, type: r.type, name: r.name, state: r.state ?? '', city: r.city ?? '', pincode: r.pincode ?? '', address: r.address ?? '' });
    setFormError('');
    setEditing(r);
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    const body = { name: form.name, state: form.state, city: form.city, pincode: form.pincode, address: form.address };
    try {
      if (editing.id) {
        await api.put(`/inventory/depos/${editing.id}`, body);
      } else {
        await api.post('/inventory/depos', {
          ...body, type: form.type,
          ...(form.login_id || form.password ? { login_id: form.login_id, password: form.password } : {}),
        });
        setPage(1);
      }
      setEditing(null);
      reload();
    } catch (err) {
      setFormError(apiMessage(err, 'Could not save'));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(r) {
    setActionError('');
    try {
      await api.put(`/inventory/depos/${r.id}`, { active: !r.active });
      reload();
    } catch (err) {
      setActionError(apiMessage(err, 'Could not update'));
    }
  }

  const columns = [
    { key: 'name', label: 'Name', render: (r) => (<>{r.name}<div className="text-xs text-gray-500">{r.type === 'DEPO' ? 'Depo' : 'Franchise'}</div></>) },
    { key: 'city', label: 'Location', render: (r) => [r.city, r.state].filter(Boolean).join(', ') || '—' },
    { key: 'login_id', label: 'Login ID', render: (r) => r.login_id || <span className="text-gray-400">No login</span> },
    { key: 'stock_units', label: 'Stock (units)' },
    { key: 'active', label: 'Status', render: (r) => <StatusPill active={r.active} /> },
    { key: 'a', label: '', render: (r) => (
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={() => openEdit(r)} className="h-9 px-3 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">Edit</button>
        <button type="button" onClick={() => toggle(r)} className="h-9 px-3 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">{r.active ? 'Deactivate' : 'Activate'}</button>
      </div>) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Depo and Franchise</h1>
        <div className="flex flex-wrap gap-3">
          <select aria-label="Type" value={f.type} onChange={setFilter('type')} className={`${inputCls} w-40`}>
            <option value="">All types</option><option value="DEPO">Depo</option><option value="FRANCHISE">Franchise</option>
          </select>
          <select aria-label="Status" value={f.active} onChange={setFilter('active')} className={`${inputCls} w-40`}>
            <option value="">All statuses</option><option value="true">Active</option><option value="false">Inactive</option>
          </select>
          <input aria-label="Search" value={f.q} onChange={setFilter('q')} placeholder="Search name, city or login" className={`${inputCls} w-56`} />
          <button type="button" onClick={openNew} className="h-11 px-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">Add depo / franchise</button>
        </div>
      </div>
      {(error || actionError) && <p role="alert" className="text-sm text-red-600">{error || actionError}</p>}
      <DataTable columns={columns} rows={rows} loading={loading} page={page} limit={20} total={total} onPage={setPage} emptyText="No depo or franchise yet" />

      <Modal open={editing !== null} title={editing?.id ? `Edit ${editing.name}` : 'Add depo / franchise'} onClose={() => setEditing(null)}>
        <form onSubmit={submit} className="space-y-4">
          {!editing?.id && (
            <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <legend className="sr-only">Type</legend>
              {[['DEPO', 'Depo'], ['FRANCHISE', 'Franchise']].map(([v, label]) => (
                <button key={v} type="button" onClick={() => setForm({ ...form, type: v })} aria-pressed={form.type === v}
                  className={`h-11 rounded-lg text-sm font-semibold border ${form.type === v ? 'border-indigo-600 bg-indigo-50 text-indigo-900' : 'border-gray-300'}`}>{label}</button>
              ))}
            </fieldset>
          )}
          <FormField id="dp-name" label="Name" required>
            <input id="dp-name" required value={form.name} onChange={set('name')} className={inputCls} />
          </FormField>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField id="dp-city" label="City"><input id="dp-city" value={form.city} onChange={set('city')} className={inputCls} /></FormField>
            <FormField id="dp-state" label="State"><input id="dp-state" value={form.state} onChange={set('state')} className={inputCls} /></FormField>
          </div>
          <FormField id="dp-pin" label="Pincode"><input id="dp-pin" value={form.pincode} onChange={set('pincode')} className={inputCls} /></FormField>
          <FormField id="dp-addr" label="Address">
            <textarea id="dp-addr" rows={2} value={form.address} onChange={set('address')} className={`${inputCls} h-auto py-2`} />
          </FormField>
          {!editing?.id && (
            <div className="rounded-lg border border-gray-200 p-3 space-y-3">
              <div className="text-sm font-medium text-gray-700">Login for this {form.type === 'DEPO' ? 'depo' : 'franchise'} (optional)</div>
              {isSuper ? (
                <>
                  <FormField id="dp-login" label="Login ID"><input id="dp-login" value={form.login_id} onChange={set('login_id')} autoComplete="off" className={inputCls} /></FormField>
                  <FormField id="dp-pass" label="Password (min 8 characters)">
                    <input id="dp-pass" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" className={inputCls} />
                  </FormField>
                  <p className="text-xs text-gray-500">Without a login this location can receive stock transfers from head office but nobody can sign in to run it.</p>
                </>
              ) : (
                <p className="text-sm text-gray-500">Only a Super Admin can create logins. You can add the location now.</p>
              )}
            </div>
          )}
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

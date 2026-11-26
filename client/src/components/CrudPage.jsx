import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import DataTable, { StatusPill } from './DataTable.jsx';
import Modal from './Modal.jsx';
import FormField, { inputCls } from './FormField.jsx';

/**
 * Generic list + add/edit modal for a master table.
 * fields: [{ key, label, type: 'text'|'number'|'textarea'|'select'|'image', required?, optionsFrom? }]
 *   'image' fields are not sent in the JSON body: the chosen file is PUT to `${endpoint}/:id/image` after saving.
 * filters: [{ key, label, optionsFrom }] extra dropdown filters sent as query params (an Active/Inactive filter is always shown)
 * columns: [{ key, label, render? }]  (Status and Actions columns are added automatically)
 */
const NO_FILTERS = [];
export default function CrudPage({ title, endpoint, columns, fields, filters = NO_FILTERS, searchPlaceholder = 'Search' }) {
  const limit = 20;
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [extra, setExtra] = useState({}); // values of the `filters` dropdowns
  const [fieldErrors, setFieldErrors] = useState({});
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null = closed, {} = new, row = edit
  const [form, setForm] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [options, setOptions] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(endpoint, { params: { page, limit, q, active: status || undefined, ...extra } });
      setRows(data.rows);
      setTotal(data.total);
      setError('');
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load the list');
    } finally {
      setLoading(false);
    }
  }, [endpoint, page, q, status, extra]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    [...fields, ...filters].filter((f) => f.optionsFrom).forEach(async (f) => {
      try {
        const { data } = await api.get(f.optionsFrom, { params: { active: true, limit: 100 } });
        setOptions((o) => ({ ...o, [f.key]: data.rows.map((r) => ({ value: r.id, label: r.name })) }));
      } catch { /* the select just stays empty */ }
    });
  }, [fields, filters]);

  function openNew() {
    setForm(Object.fromEntries(fields.map((f) => [f.key, ''])));
    setFormError('');
    setFieldErrors({});
    setFile(null);
    setEditing({});
  }
  function openEdit(row) {
    setForm(Object.fromEntries(fields.map((f) => [f.key, row[f.key] ?? ''])));
    setFormError('');
    setFieldErrors({});
    setFile(null);
    setEditing(row);
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    setFieldErrors({});
    const body = {};
    fields.filter((f) => f.type !== 'image').forEach((f) => {
      const v = form[f.key];
      body[f.key] = f.type === 'number' || f.type === 'select' ? (v === '' ? undefined : Number(v)) : v;
    });
    try {
      const { data: saved } = editing.id
        ? await api.put(`${endpoint}/${editing.id}`, body)
        : await api.post(endpoint, body);
      if (file) {
        const fd = new FormData();
        fd.append('image', file);
        try {
          await api.put(`${endpoint}/${saved.id}/image`, fd);
        } catch (err) {
          // the record itself is saved; keep the form open so the image can be retried
          setEditing(saved);
          setFormError(`Saved, but the image upload failed: ${err.response?.data?.error || 'try again'}`);
          load();
          return;
        }
      }
      setEditing(null);
      if (!editing.id) setPage(1);
      load();
    } catch (err) {
      const d = err.response?.data;
      setFieldErrors(d?.details?.fieldErrors || {});
      setFormError(d?.details?.fieldErrors ? 'Please fix the fields marked below' : d?.error || 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(row) {
    try {
      await api.put(`${endpoint}/${row.id}`, { active: !row.active });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update');
    }
  }

  const allColumns = [
    ...columns,
    { key: 'active', label: 'Status', render: (r) => <StatusPill active={r.active} /> },
    {
      key: 'actions', label: '',
      render: (r) => (
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={() => openEdit(r)} className="h-9 px-3 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">Edit</button>
          <button type="button" onClick={() => toggle(r)} className="h-9 px-3 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">
            {r.active ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{title}</h1>
        <div className="flex flex-wrap gap-3">
          <label htmlFor="crud-search" className="sr-only">Search</label>
          <input id="crud-search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder={searchPlaceholder} className={`${inputCls} w-64`} />
          <button type="button" onClick={openNew}
            className="h-11 px-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">Add new</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <select aria-label="Status" value={status} className={`${inputCls} w-40`}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
        {filters.map((f) => (
          <select key={f.key} aria-label={f.label} value={extra[f.key] ?? ''} className={`${inputCls} w-52`}
            onChange={(e) => { setExtra({ ...extra, [f.key]: e.target.value || undefined }); setPage(1); }}>
            <option value="">{f.label}: all</option>
            {(options[f.key] || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <DataTable columns={allColumns} rows={rows} loading={loading} page={page} limit={limit} total={total} onPage={setPage} />

      <Modal open={editing !== null} title={editing?.id ? `Edit ${title}` : `Add ${title}`} onClose={() => setEditing(null)}>
        <form onSubmit={submit} className="space-y-4">
          {fields.map((f) => (
            <FormField key={f.key} id={`f-${f.key}`} label={f.label} required={f.required} error={fieldErrors[f.key]?.[0]}>
              {f.type === 'image' ? (
                <div className="space-y-2">
                  {editing?.[f.key] && !file && <img src={editing[f.key]} alt="Current" className="h-16 w-16 rounded-lg object-cover border border-gray-200" />}
                  <input id={`f-${f.key}`} type="file" accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => setFile(e.target.files?.[0] || null)} className="block text-sm" />
                  <p className="text-xs text-gray-500">PNG, JPG or WebP, up to 2 MB. Saved with the form.</p>
                </div>
              ) : f.type === 'select' ? (
                <select id={`f-${f.key}`} required={f.required} value={form[f.key] ?? ''} className={inputCls}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}>
                  <option value="">Select…</option>
                  {(options[f.key] || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea id={`f-${f.key}`} rows={3} value={form[f.key] ?? ''} className={`${inputCls} h-auto py-2`}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              ) : (
                <input id={`f-${f.key}`} type={f.type === 'number' ? 'number' : 'text'} step={f.type === 'number' ? 'any' : undefined}
                  min={f.type === 'number' ? 0 : undefined} required={f.required} value={form[f.key] ?? ''} className={inputCls}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              )}
            </FormField>
          ))}
          {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setEditing(null)} className="h-11 px-4 rounded-lg border border-gray-300 text-sm">Cancel</button>
            <button type="submit" disabled={saving}
              className="h-11 px-5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-60">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

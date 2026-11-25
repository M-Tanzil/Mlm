// client/src/features/depo/PcrRequestsPage.jsx  (admin: stock requests from depots and franchises)
import { useState } from 'react';
import { api } from '../../api/client.js';
import DataTable from '../../components/DataTable.jsx';
import Modal from '../../components/Modal.jsx';
import FormField, { inputCls } from '../../components/FormField.jsx';
import { apiMessage, useList, useOptions } from '../inventory/useList.js';

const COLORS = { PENDING: 'bg-amber-100 text-amber-800', APPROVED: 'bg-green-100 text-green-800', REJECTED: 'bg-gray-200 text-gray-700' };
export const PcrBadge = ({ status }) => (
  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${COLORS[status] || ''}`}>{status}</span>
);

export default function PcrRequestsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('PENDING');
  const { rows, total, loading, error, reload } = useList('/inventory/pcr', { page, limit: 20, status });
  const locations = useOptions('/inventory/locations');
  const [approving, setApproving] = useState(null);
  const [from, setFrom] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');

  function openApprove(r) { setApproving(r); setFrom(''); setFormError(''); setNotice(''); setActionError(''); }

  async function approve(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const { data } = await api.put(`/inventory/pcr/${approving.id}/approve`, { from_location: Number(from) });
      setApproving(null);
      setNotice(`Approved. Transfer ${data.transfer_no} is on its way; ${approving.location_name} must accept it.`);
      reload();
    } catch (err) {
      setFormError(apiMessage(err, 'Could not approve'));
    } finally {
      setSaving(false);
    }
  }

  async function reject(r) {
    if (!window.confirm(`Reject the request from ${r.location_name}?`)) return;
    setActionError('');
    setNotice('');
    try {
      await api.put(`/inventory/pcr/${r.id}/reject`);
      reload();
    } catch (err) {
      setActionError(apiMessage(err, 'Could not reject'));
      reload();
    }
  }

  const columns = [
    { key: 'id', label: 'Request', render: (r) => `#${r.id}` },
    { key: 'location_name', label: 'From', render: (r) => (<>{r.location_name}<div className="text-xs text-gray-500">{r.location_type === 'DEPO' ? 'Depo' : 'Franchise'}</div></>) },
    { key: 'items', label: 'Products', render: (r) => (
      <ul className="text-xs space-y-0.5">{r.items.map((i) => <li key={i.product_id}>{i.name} × {i.qty}</li>)}</ul>) },
    { key: 'total_qty', label: 'Units' },
    { key: 'status', label: 'Status', render: (r) => <PcrBadge status={r.status} /> },
    { key: 'created_at', label: 'Date', render: (r) => new Date(r.created_at).toLocaleDateString('en-IN') },
    { key: 'a', label: '', render: (r) => r.status === 'PENDING' && (
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={() => openApprove(r)} className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-sm">Approve</button>
        <button type="button" onClick={() => reject(r)} className="h-9 px-3 rounded-lg border border-red-300 text-red-700 text-sm">Reject</button>
      </div>) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Stock Requests (PCR)</h1>
        <select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={`${inputCls} w-44`}>
          <option value="">All statuses</option>
          {['PENDING', 'APPROVED', 'REJECTED'].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      {notice && <p role="status" className="text-sm rounded-lg bg-green-50 text-green-800 border border-green-200 px-3 py-2">{notice}</p>}
      {(error || actionError) && <p role="alert" className="text-sm text-red-600">{error || actionError}</p>}
      <DataTable columns={columns} rows={rows} loading={loading} page={page} limit={20} total={total}
        onPage={setPage} emptyText={status === 'PENDING' ? 'No pending requests' : 'No requests'} />

      <Modal open={!!approving} title={approving ? `Approve request #${approving.id}` : ''} onClose={() => setApproving(null)}>
        {approving && (
          <form onSubmit={approve} className="space-y-4">
            <p className="text-sm text-gray-600">{approving.location_name} asked for:</p>
            <ul className="text-sm divide-y divide-gray-100">
              {approving.items.map((i) => <li key={i.product_id} className="py-1.5 flex justify-between"><span>{i.name}</span><strong>{i.qty}</strong></li>)}
            </ul>
            <FormField id="pcr-from" label="Send the stock from" required>
              <select id="pcr-from" required value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls}>
                <option value="">Select location…</option>
                {locations.filter((l) => l.id !== approving.location_id).map((l) => <option key={l.id} value={l.id}>{l.name} ({l.type})</option>)}
              </select>
            </FormField>
            <p className="text-xs text-gray-500">Stock leaves that location straight away and shows up as a transfer for {approving.location_name} to accept. If it does not have enough, nothing changes.</p>
            {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setApproving(null)} className="h-11 px-4 rounded-lg border border-gray-300 text-sm">Cancel</button>
              <button type="submit" disabled={saving || !from} className="h-11 px-5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-60">{saving ? 'Approving…' : 'Approve and send'}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

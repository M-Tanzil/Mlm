import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { api } from '../../api/client.js';

const KYC = {
  APPROVED: ['Approved', 'bg-[#dcfce7] text-[#166534]'],
  PENDING: ['Pending', 'bg-[#fef3c7] text-[#92400e]'],
  REJECTED: ['Rejected', 'bg-[#fee2e2] text-[#991b1b]'],
};

const CYCLE_PROGRESS = { OPEN: 10, CALCULATED: 33, APPROVED: 66, PAID: 100 };

function when(iso) {
  const d = new Date(iso);
  const t = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(t) - day(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString();
}

function Card({ label, value, note, noteClass = 'text-[#5b6472]' }) {
  return (
    <div className="bg-white rounded-[14px] border border-[#e5e7eb] p-5">
      <div className="text-[13px] text-[#5b6472]">{label}</div>
      <div className="text-[28px] font-bold mt-1.5">{value}</div>
      {note && <div className={`text-[13px] mt-1 ${noteClass}`}>{note}</div>}
    </div>
  );
}

export default function AdminDashboard() {
  const role = useSelector((s) => s.auth.role);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/dashboard/admin')
      .then((r) => setData(r.data))
      .catch((e) => setError(e.response?.data?.error || 'Could not load the dashboard'));
  }, []);

  const cycle = data?.payoutCycle;
  const progress = cycle ? CYCLE_PROGRESS[cycle.status] ?? 0 : 0;
  const attention = data && [
    ['E-Pin requests', data.attention.epinRequests],
    ['Joining packages to dispatch', data.attention.packagesToDispatch],
    ['Stock transfers awaiting acceptance', data.attention.transfersWaiting],
    ['Open support tickets', data.attention.openTickets],
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div
          className="h-11 px-4 rounded-[10px] bg-white border border-[#e5e7eb] flex items-center text-sm font-semibold"
          aria-label={`Signed in as ${role}`}
        >
          {role === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin'}
        </div>
      </header>

      {error && <p className="text-[#991b1b]">{error}</p>}

      <section aria-label="Key numbers" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card
          label="Total members"
          value={data ? data.totalMembers.toLocaleString() : '—'}
          note={data ? `+${data.joinedToday} today` : ''}
          noteClass="text-[#15803d]"
        />
        <Card label="Business volume (month)" value="—" note="Available once orders are live" />
        <Card
          label="Pending KYC"
          value={data ? data.pendingKyc : '—'}
          note={data && data.pendingKyc > 0 ? 'Needs review' : ''}
          noteClass="text-[#b45309]"
        />
        <Card label="Payout this cycle" value="—" note="Available once payouts are live" />
      </section>

      <div className="flex flex-wrap items-start gap-6">
        <section
          aria-label="Recent joinings"
          className="flex-[2_1_520px] min-w-0 bg-white rounded-[14px] border border-[#e5e7eb] p-5"
        >
          <h2 className="text-base font-semibold mb-3">Recent joinings</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px] border-collapse">
              <thead>
                <tr className="text-left text-[13px] text-[#5b6472]">
                  {['Member', 'Sponsor', 'Package', 'KYC', 'Joined'].map((h) => (
                    <th key={h} className="py-2.5 px-2 font-medium border-b border-[#e5e7eb]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.recentJoinings.map((m) => {
                  const [label, cls] = KYC[m.kyc] || [m.kyc, ''];
                  return (
                    <tr key={m.code} className="border-b border-[#f1f2f6] last:border-0">
                      <td className="py-3 px-2">
                        {m.name}
                        <div className="text-xs text-[#5b6472]">{m.code}</div>
                      </td>
                      <td className="py-3 px-2">{m.sponsor || '—'}</td>
                      <td className="py-3 px-2">{m.package || '—'}</td>
                      <td className="py-3 px-2">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>
                      </td>
                      <td className="py-3 px-2">{when(m.joinedAt)}</td>
                    </tr>
                  );
                })}
                {data && data.recentJoinings.length === 0 && (
                  <tr><td colSpan={5} className="py-6 text-center text-[#5b6472]">No members yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="flex-[1_1_300px] min-w-0 flex flex-col gap-6">
          <section aria-label="Payout cycle" className="bg-white rounded-[14px] border border-[#e5e7eb] p-5">
            <h2 className="text-base font-semibold mb-1">Payout cycle</h2>
            <p className="text-[13px] text-[#5b6472] mb-3.5">
              {cycle ? `Status: ${cycle.status.charAt(0) + cycle.status.slice(1).toLowerCase()}` : 'No payout cycle yet'}
            </p>
            <div className="h-2.5 bg-[#e5e7eb] rounded-full overflow-hidden">
              <div className="h-full bg-indigo-600" style={{ width: `${progress}%` }} />
            </div>
            <div className="flex justify-between text-[13px] text-[#5b6472] mt-2">
              <span>Calculated</span><span>Approved</span><span>Paid</span>
            </div>
          </section>

          <section aria-label="Needs attention" className="bg-white rounded-[14px] border border-[#e5e7eb] p-5">
            <h2 className="text-base font-semibold mb-3">Needs attention</h2>
            {attention?.map(([label, n], i) => (
              <div
                key={label}
                className={`flex justify-between py-2.5 text-sm ${i < attention.length - 1 ? 'border-b border-[#f1f2f6]' : ''}`}
              >
                <span>{label}</span>
                <strong>{n}</strong>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
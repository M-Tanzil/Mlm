import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';

function when(iso) {
  const d = new Date(iso);
  const t = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(t) - day(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString();
}

function Stat({ label, value, note }) {
  return (
    <div className="bg-white rounded-[14px] border border-[#e5e7eb] p-5">
      <div className="text-[13px] text-[#5b6472]">{label}</div>
      <div className="text-[28px] font-bold mt-1.5">{value}</div>
      {note && <div className="text-[13px] text-[#5b6472] mt-1">{note}</div>}
    </div>
  );
}

function Bar({ label, value, max, color }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-[#5b6472]">{label}</span>
        <span className="font-semibold">{value.toLocaleString()} BV</span>
      </div>
      <div className="h-2.5 bg-[#e5e7eb] rounded-full overflow-hidden mt-1.5">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export default function DistributorHome() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/dashboard/distributor')
      .then((r) => setData(r.data))
      .catch((e) => setError(e.response?.data?.error || 'Could not load your desktop'));
  }, []);

  if (error) return <p className="text-[#991b1b]">{error}</p>;
  if (!data) return <p className="text-[#5b6472]">Loading...</p>;

  const max = Math.max(data.leftVolume, data.rightVolume);

  return (
    <div className="flex flex-col gap-6">
      <header className="bg-indigo-600 text-white rounded-[14px] px-6 py-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-sm opacity-90">Welcome back</div>
          <h1 className="text-2xl font-bold mt-0.5">{data.name}</h1>
          <div className="text-sm mt-1 opacity-90">
            ID {data.code}
            {data.package ? ` · ${data.package} package` : ''}
          </div>
        </div>
        <div className="flex gap-3">
          <Link
            to="/distributor/network"
            className="min-h-[44px] inline-flex items-center rounded-lg border border-white/60 text-white font-semibold px-5 hover:bg-white/10"
          >
            View network
          </Link>
        </div>
      </header>

      <section aria-label="Key numbers" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Downline" value={data.downline.toLocaleString()} note="Members in your binary tree" />
        <Stat label="My payout" value="—" note="Available once payouts are live" />
        <Stat label="E-Pins received" value={data.epinsReceived} />
        <Stat label="Month business" value="—" note="Available once orders are live" />
      </section>

      <div className="grid gap-6 lg:grid-cols-3 items-start">
        <section aria-label="Left and right volume" className="bg-white rounded-[14px] border border-[#e5e7eb] p-5">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-semibold">Binary volume</h2>
            <span className="text-xs text-[#5b6472]">This cycle</span>
          </div>
          <div className="mt-5 flex flex-col gap-5">
            <Bar label="Left leg" value={data.leftVolume} max={max} color="#4f46e5" />
            <Bar label="Right leg" value={data.rightVolume} max={max} color="#0f766e" />
          </div>
        </section>

        <section
          aria-label="Recent joining"
          className="lg:col-span-2 bg-white rounded-[14px] border border-[#e5e7eb] p-5"
        >
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-base font-semibold">Recent joining</h2>
            <Link to="/distributor/network" className="text-sm text-indigo-700 hover:underline">
              View all
            </Link>
          </div>
          {data.recentJoinings.length === 0 ? (
            <p className="text-sm text-[#5b6472] py-4">No one has joined your team yet.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-[13px] text-[#5b6472]">
                  <th className="py-2.5 px-2 font-medium border-b border-[#e5e7eb]">Member</th>
                  <th className="py-2.5 px-2 font-medium border-b border-[#e5e7eb]">Leg</th>
                  <th className="py-2.5 px-2 font-medium border-b border-[#e5e7eb]">Joined</th>
                </tr>
              </thead>
              <tbody>
                {data.recentJoinings.map((m, i) => (
                  <tr key={`${m.name}-${i}`} className="border-b border-[#f1f2f6] last:border-0">
                    <td className="py-3 px-2">{m.name}</td>
                    <td className="py-3 px-2">{m.leg === 'L' ? 'Left' : 'Right'}</td>
                    <td className="py-3 px-2 text-[#5b6472]">{when(m.joinedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
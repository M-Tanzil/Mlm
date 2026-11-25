// client/src/features/support/ticketBits.jsx  (shared by the admin support desk and the member's My Support page)
const COLORS = {
  OPEN: 'bg-amber-100 text-amber-800', IN_PROGRESS: 'bg-blue-100 text-blue-800', RESOLVED: 'bg-green-100 text-green-800', CLOSED: 'bg-gray-200 text-gray-700',
  LOW: 'bg-gray-100 text-gray-700', NORMAL: 'bg-gray-100 text-gray-700', HIGH: 'bg-red-100 text-red-800',
};
export const Pill = ({ v }) => <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${COLORS[v] || 'bg-gray-100 text-gray-700'}`}>{String(v).replace('_', ' ')}</span>;
export const when = (d) => (d ? new Date(d).toLocaleString('en-IN') : '—');

/** The conversation, oldest first. */
export function Messages({ messages }) {
  return (
    <ul className="space-y-2 max-h-72 overflow-y-auto">
      {messages.map((m) => (
        <li key={m.id} className={`rounded-lg px-3 py-2 text-sm ${m.from_admin ? 'bg-indigo-50 ml-6' : 'bg-gray-50 mr-6'}`}>
          <div className="text-xs text-gray-500 mb-0.5">{m.from_admin ? 'Support' : 'Member'} · {when(m.created_at)}</div>
          <div className="whitespace-pre-wrap break-words">{m.body}</div>
        </li>))}
    </ul>
  );
}

import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';

const KYC_STYLE = {
  APPROVED: 'bg-[#dcfce7] text-[#166534]',
  PENDING: 'bg-[#fef3c7] text-[#92400e]',
  REJECTED: 'bg-[#fee2e2] text-[#991b1b]',
};

function Pill({ className = '', children }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

function MemberCard({ node, isRoot, selected, onSelect }) {
  const a = node.attributes;
  return (
    <button
      type="button"
      onClick={() => onSelect(node)}
      aria-pressed={selected}
      className={`w-48 min-h-[44px] text-left rounded-[14px] p-3 bg-white
        ${isRoot ? 'border-2 border-indigo-600' : 'border border-[#e5e7eb]'}
        ${selected ? 'ring-2 ring-indigo-300 bg-[#eef2ff]' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-sm text-[#111827] truncate">{node.name}</span>
        {a.position && (
          <span className="text-xs text-[#5b6472]">{a.position === 'L' ? 'Left' : 'Right'}</span>
        )}
      </div>
      <div className="text-xs text-[#5b6472]">{a.code}</div>
      {a.package && <Pill className="mt-1 bg-[#eef2ff] text-[#312e81]">{a.package}</Pill>}
      <div className="mt-2 flex justify-between text-xs">
        <span className="text-[#111827]">L BV {a.leftVolume}</span>
        <span className="text-[#0f766e]">R BV {a.rightVolume}</span>
      </div>
    </button>
  );
}

function EmptySlot({ position, onAdd }) {
  return (
    <button
      type="button"
      onClick={() => onAdd?.(position)}
      className="w-48 min-h-[44px] rounded-[14px] border-2 border-dashed border-[#cbd5e1] p-3
                 text-sm text-[#5b6472] hover:border-indigo-400 hover:text-indigo-700"
    >
      + Add member ({position === 'L' ? 'Left' : 'Right'})
    </button>
  );
}

function TreeNode({ node, isRoot, limitDepth, selectedCode, onSelect, onAdd }) {
  const a = node.attributes;
  const left = node.children.find((c) => c.attributes.position === 'L');
  const right = node.children.find((c) => c.attributes.position === 'R');
  // Below the loaded depth we do not know what is there, so only show empty slots above it
  const showEmpty = a.depth < limitDepth;

  const slots = [
    { pos: 'L', child: left },
    { pos: 'R', child: right },
  ].filter((s) => s.child || showEmpty);

  return (
    <li>
      <div className="inline-block">
        <MemberCard
          node={node}
          isRoot={isRoot}
          selected={selectedCode === a.code}
          onSelect={onSelect}
        />
      </div>
      {slots.length > 0 && (
        <ul>
          {slots.map(({ pos, child }) =>
            child ? (
              <TreeNode
                key={child.attributes.code}
                node={child}
                limitDepth={limitDepth}
                selectedCode={selectedCode}
                onSelect={onSelect}
                onAdd={onAdd}
              />
            ) : (
              <li key={pos}>
                <EmptySlot position={pos} onAdd={(p) => onAdd?.(a.code, p)} />
              </li>
            )
          )}
        </ul>
      )}
    </li>
  );
}

function DetailRow({ label, children }) {
  return (
    <div className="flex justify-between gap-3 py-2 border-b border-[#e5e7eb] text-sm">
      <dt className="text-[#5b6472]">{label}</dt>
      <dd className="text-[#111827] text-right">{children}</dd>
    </div>
  );
}

export default function NetworkTree() {
  const [code, setCode] = useState('');
  const [depth, setDepth] = useState(3);
  const [tree, setTree] = useState(null); // { data, depth }
  const [selected, setSelected] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');

  async function load(c = code, d = depth) {
    setError('');
    try {
      const url = `/network/binary${c.trim() ? `/${encodeURIComponent(c.trim())}` : ''}`;
      const { data } = await api.get(url, { params: { depth: d } });
      setTree({ data, depth: d });
      setSelected(data);
    } catch (e) {
      setTree(null);
      setSelected(null);
      setError(e.response?.data?.error || 'Could not load the tree');
    }
  }

  useEffect(() => {
    load('', 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const root = tree?.data;
  const limitDepth = root ? root.attributes.depth + tree.depth : 0;
  const sel = selected?.attributes;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-[#111827] mb-4">Binary Network</h1>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          className="min-h-[44px] border border-[#e5e7eb] rounded-lg px-3 bg-white"
          placeholder="Search member ID (blank = top)"
          aria-label="Member ID"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
        <label className="flex items-center gap-2 text-sm text-[#5b6472]">
          Levels
          <select
            className="min-h-[44px] border border-[#e5e7eb] rounded-lg px-3 bg-white text-[#111827]"
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5, 6].map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="min-h-[44px] bg-indigo-600 text-white rounded-lg px-5"
          onClick={() => load()}
        >
          Load
        </button>
        <div className="flex items-center gap-1 ml-auto">
          <button
            type="button"
            aria-label="Zoom out"
            className="min-h-[44px] min-w-[44px] border border-[#e5e7eb] rounded-lg bg-white"
            onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(1)))}
          >
            −
          </button>
          <span className="w-12 text-center text-sm text-[#5b6472]">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            aria-label="Zoom in"
            className="min-h-[44px] min-w-[44px] border border-[#e5e7eb] rounded-lg bg-white"
            onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(1)))}
          >
            +
          </button>
        </div>
      </div>

      {error && <p className="text-red-700 mb-3">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="bg-white border border-[#e5e7eb] rounded-[14px] p-4 overflow-auto" style={{ maxHeight: '75vh' }}>
          {root && (
            <div className="tree inline-block min-w-full" style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
              <ul>
                <TreeNode
                  node={root}
                  isRoot
                  limitDepth={limitDepth}
                  selectedCode={sel?.code}
                  onSelect={setSelected}
                  onAdd={(parentCode, pos) => console.log('add member under', parentCode, pos)}
                />
              </ul>
            </div>
          )}
        </div>

        <aside className="bg-white border border-[#e5e7eb] rounded-[14px] p-4 h-fit">
          <h2 className="font-semibold text-[#111827]">{selected ? selected.name : 'Member details'}</h2>
          {sel ? (
            <>
              <dl className="mt-2">
                <DetailRow label="Member ID">{sel.code}</DetailRow>
                <DetailRow label="Package">{sel.package || '—'}</DetailRow>
                <DetailRow label="Leg">{sel.position ? (sel.position === 'L' ? 'Left' : 'Right') : 'Top'}</DetailRow>
                <DetailRow label="Sponsor">{sel.sponsor || '—'}</DetailRow>
                <DetailRow label="Joined">{new Date(sel.joinedAt).toLocaleDateString()}</DetailRow>
                <DetailRow label="KYC">
                  <Pill className={KYC_STYLE[sel.kyc] || ''}>{sel.kyc}</Pill>
                </DetailRow>
                <DetailRow label="Left BV">{sel.leftVolume}</DetailRow>
                <DetailRow label="Right BV">{sel.rightVolume}</DetailRow>
              </dl>
              <button
                type="button"
                className="mt-4 w-full min-h-[44px] border border-indigo-600 text-indigo-700 rounded-lg"
                onClick={() => {
                  setCode(sel.code);
                  load(sel.code, depth);
                }}
              >
                View downline
              </button>
            </>
          ) : (
            <p className="text-sm text-[#5b6472] mt-2">Select a member in the tree.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
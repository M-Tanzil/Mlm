import { Link, Outlet } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { logout } from '../features/auth/authSlice.js';

export default function PanelLayout({ title, links }) {
  const dispatch = useDispatch();
  return (
    <div className="min-h-screen flex">
      <aside className="w-56 bg-slate-900 text-slate-100 p-4 space-y-2">
        <h2 className="font-semibold mb-4">{title}</h2>
        {links.map((l) => (
          <Link key={l.to} to={l.to} className="block py-1 hover:text-indigo-300">{l.label}</Link>
        ))}
        <button onClick={() => dispatch(logout())} className="pt-4 text-sm text-slate-400">Logout</button>
      </aside>
      <main className="flex-1 p-6 bg-slate-50"><Outlet /></main>
    </div>
  );
}

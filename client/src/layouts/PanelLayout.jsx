import { useRef } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { logout } from '../features/auth/authSlice.js';
import { useCompany } from '../features/company/useCompany.js';

export default function PanelLayout({ title, links }) {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { company, changeLogo, error } = useCompany();
  const fileRef = useRef(null);
  const canEditLogo = role === 'SUPER_ADMIN';

  function onFile(e) {
    const file = e.target.files?.[0];
    if (file) changeLogo(file);
    e.target.value = '';
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 bg-gray-900 text-gray-200 p-4 space-y-1">
        <div className="flex items-center gap-3 pb-4 mb-2 border-b border-gray-700">
          {company.logo_url ? (
            <img src={company.logo_url} alt={`${company.name} logo`} className="w-11 h-11 rounded-lg bg-white object-contain" />
          ) : (
            <div role="img" aria-label="Company logo placeholder"
              className="w-11 h-11 rounded-lg bg-white text-indigo-600 text-xs font-bold grid place-items-center">LOGO</div>
          )}
          <div className="min-w-0">
            <div className="font-bold text-white text-sm truncate">{company.name}</div>
            {canEditLogo && (
              <>
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="text-xs text-indigo-300 hover:text-indigo-200 min-h-6">Change logo</button>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFile} />
              </>
            )}
          </div>
        </div>
        {error && <p className="text-xs text-red-300 pb-2">{error}</p>}

        <h2 className="text-xs uppercase tracking-wider text-gray-400 pt-1 pb-2">{title}</h2>
        {links.map((l) => (
          <Link key={l.to} to={l.to} className="block py-2 px-2 rounded text-sm hover:bg-gray-800 hover:text-white">{l.label}</Link>
        ))}
        <button onClick={() => dispatch(logout())} className="mt-4 px-2 text-sm text-gray-400 hover:text-white">Logout</button>
      </aside>
      <main className="flex-1 p-6 bg-slate-50 min-w-0"><Outlet /></main>
    </div>
  );
}

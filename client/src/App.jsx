import { Routes, Route, Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import PanelLayout from './layouts/PanelLayout.jsx';
import ProtectedRoute from './routes/ProtectedRoute.jsx';

const adminLinks = [
  { to: '/admin', label: 'Dashboard' },
  // TODO: Master, Members, KYC, E-Pin, Inventory, Orders, Payout, Schemes, Utilities
];
const distLinks = [
  { to: '/distributor', label: 'My Desktop' },
  // TODO: Network, Commission, E-Pin, Orders, Support, Details
];
const depoLinks = [{ to: '/depo', label: 'Dashboard' }];

function Home() {
  const role = useSelector((s) => s.auth.role);
  const dest = { SUPER_ADMIN: '/admin', ADMIN: '/admin', DISTRIBUTOR: '/distributor', DEPO: '/depo', FRANCHISE: '/depo' }[role];
  return <Navigate to={dest || '/login'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Home />} />
      <Route path="/admin" element={
        <ProtectedRoute roles={['SUPER_ADMIN', 'ADMIN']}><PanelLayout title="Admin Panel" links={adminLinks} /></ProtectedRoute>}>
        <Route index element={<Dashboard name="Admin" />} />
      </Route>
      <Route path="/distributor" element={
        <ProtectedRoute roles={['DISTRIBUTOR']}><PanelLayout title="Distributor" links={distLinks} /></ProtectedRoute>}>
        <Route index element={<Dashboard name="Distributor" />} />
      </Route>
      <Route path="/depo" element={
        <ProtectedRoute roles={['DEPO', 'FRANCHISE']}><PanelLayout title="Depo / Franchise" links={depoLinks} /></ProtectedRoute>}>
        <Route index element={<Dashboard name="Depo" />} />
      </Route>
    </Routes>
  );
}

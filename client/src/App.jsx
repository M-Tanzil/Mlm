import { Routes, Route, Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import PanelLayout from './layouts/PanelLayout.jsx';
import ProtectedRoute from './routes/ProtectedRoute.jsx';
import NetworkTree from './features/network/NetworkTree.jsx';
import TopLoader from './components/TopLoader.jsx';
import AdminDashboard from './features/admin/AdminDashboard.jsx';
import DistributorHome from './features/distributor/DistributorHome.jsx';
import { CategoriesPage, ProductsPage } from './features/inventory/InventoryPages.jsx';

const adminLinks = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/network', label: 'Network Tree' },
  { to: '/admin/inventory/categories', label: 'Product Categories' },
  { to: '/admin/inventory/products', label: 'Products' },
];
const distLinks = [
  { to: '/distributor', label: 'My Desktop' },
  { to: '/distributor/network', label: 'Network' },
];
const depoLinks = [{ to: '/depo', label: 'Dashboard' }];

function Home() {
  const role = useSelector((s) => s.auth.role);
  const dest = { SUPER_ADMIN: '/admin', ADMIN: '/admin', DISTRIBUTOR: '/distributor', DEPO: '/depo', FRANCHISE: '/depo' }[role];
  return <Navigate to={dest || '/login'} replace />;
}

export default function App() {
  return (
    <>
    <TopLoader />
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Home />} />
      <Route path="/admin" element={
        <ProtectedRoute roles={['SUPER_ADMIN', 'ADMIN']}><PanelLayout title="Admin Panel" links={adminLinks} /></ProtectedRoute>}>
        <Route index element={<AdminDashboard />} />
        <Route path="network" element={<NetworkTree />} />
        <Route path="inventory/categories" element={<CategoriesPage />} />
        <Route path="inventory/products" element={<ProductsPage />} />
      </Route>
      <Route path="/distributor" element={
        <ProtectedRoute roles={['DISTRIBUTOR']}><PanelLayout title="Distributor" links={distLinks} /></ProtectedRoute>}>
        <Route index element={<DistributorHome />} />
        <Route path="network" element={<NetworkTree />} />
      </Route>
      <Route path="/depo" element={
        <ProtectedRoute roles={['DEPO', 'FRANCHISE']}><PanelLayout title="Depo / Franchise" links={depoLinks} /></ProtectedRoute>}>
        <Route index element={<Dashboard name="Depo" />} />
      </Route>
    </Routes>
    </>
  );
}

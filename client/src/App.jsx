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
import { CategoriesPage, ProductsPage, SuppliersPage, CouriersPage } from './features/inventory/InventoryPages.jsx';
import PurchaseOrdersPage from './features/inventory/PurchaseOrdersPage.jsx';
import StockInwardPage from './features/inventory/StockInwardPage.jsx';
import StockReturnsPage from './features/inventory/StockReturnsPage.jsx';
import StockReportPage from './features/inventory/StockReportPage.jsx';
import StockMovementsPage from './features/inventory/StockMovementsPage.jsx';

const adminLinks = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/network', label: 'Network Tree' },
  { to: '/admin/inventory/categories', label: 'Product Categories' },
  { to: '/admin/inventory/products', label: 'Products' },
  { to: '/admin/inventory/suppliers', label: 'Suppliers' },
  { to: '/admin/inventory/couriers', label: 'Couriers' },
  { to: '/admin/inventory/purchase-orders', label: 'Purchase Orders' },
  { to: '/admin/inventory/stock-inward', label: 'Stock Inward' },
  { to: '/admin/inventory/stock-returns', label: 'Stock Returns' },
  { to: '/admin/inventory/stock-report', label: 'Stock Report' },
  { to: '/admin/inventory/stock-movements', label: 'Stock Movements' },
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
        <Route path="inventory/suppliers" element={<SuppliersPage />} />
        <Route path="inventory/couriers" element={<CouriersPage />} />
        <Route path="inventory/purchase-orders" element={<PurchaseOrdersPage />} />
        <Route path="inventory/stock-inward" element={<StockInwardPage />} />
        <Route path="inventory/stock-returns" element={<StockReturnsPage />} />
        <Route path="inventory/stock-report" element={<StockReportPage />} />
        <Route path="inventory/stock-movements" element={<StockMovementsPage />} />
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

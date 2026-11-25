import { Routes, Route, Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import Login from './pages/Login.jsx';
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
import StockTransfersPage from './features/inventory/StockTransfersPage.jsx';
import DepoManagementPage from './features/depo/DepoManagementPage.jsx';
import PcrRequestsPage from './features/depo/PcrRequestsPage.jsx';
import DepoStockPage from './features/depo/DepoStockPage.jsx';
import DepoPcrPage from './features/depo/DepoPcrPage.jsx';
import OrdersPage from './features/orders/OrdersPage.jsx';

const adminLinks = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/network', label: 'Network Tree' },
  { to: '/admin/orders', label: 'Orders & Dispatch' },
  { to: '/admin/inventory/categories', label: 'Product Categories' },
  { to: '/admin/inventory/products', label: 'Products' },
  { to: '/admin/inventory/suppliers', label: 'Suppliers' },
  { to: '/admin/inventory/couriers', label: 'Couriers' },
  { to: '/admin/inventory/purchase-orders', label: 'Purchase Orders' },
  { to: '/admin/inventory/stock-inward', label: 'Stock Inward' },
  { to: '/admin/inventory/stock-returns', label: 'Stock Returns' },
  { to: '/admin/inventory/stock-transfers', label: 'Stock Transfers' },
  { to: '/admin/depos', label: 'Depo & Franchise' },
  { to: '/admin/pcr', label: 'Stock Requests (PCR)' },
  { to: '/admin/inventory/stock-report', label: 'Stock Report' },
  { to: '/admin/inventory/stock-movements', label: 'Stock Movements' },
];
const distLinks = [
  { to: '/distributor', label: 'My Desktop' },
  { to: '/distributor/network', label: 'Network' },
];
const depoLinks = [
  { to: '/depo', label: 'My Stock' },
  { to: '/depo/orders', label: 'Orders & Dispatch' },
  { to: '/depo/incoming', label: 'Incoming Stock' },
  { to: '/depo/requests', label: 'Stock Requests' },
];

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
        <Route path="orders" element={<OrdersPage />} />
        <Route path="inventory/categories" element={<CategoriesPage />} />
        <Route path="inventory/products" element={<ProductsPage />} />
        <Route path="inventory/suppliers" element={<SuppliersPage />} />
        <Route path="inventory/couriers" element={<CouriersPage />} />
        <Route path="inventory/purchase-orders" element={<PurchaseOrdersPage />} />
        <Route path="inventory/stock-inward" element={<StockInwardPage />} />
        <Route path="inventory/stock-returns" element={<StockReturnsPage />} />
        <Route path="inventory/stock-transfers" element={<StockTransfersPage />} />
        <Route path="depos" element={<DepoManagementPage />} />
        <Route path="pcr" element={<PcrRequestsPage />} />
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
        <Route index element={<DepoStockPage />} />
        <Route path="orders" element={<OrdersPage base="/depo/orders" couriersEndpoint="/depo/couriers" canPlace={false} canCancel={false} title="Orders & Dispatch" />} />
        <Route path="incoming" element={<StockTransfersPage base="/depo/transfers" canCreate={false} title="Incoming Stock" />} />
        <Route path="requests" element={<DepoPcrPage />} />
      </Route>
    </Routes>
    </>
  );
}

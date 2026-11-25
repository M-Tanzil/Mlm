import CrudPage from '../../components/CrudPage.jsx';

const money = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN')}`);

export function CategoriesPage() {
  return (
    <CrudPage title="Product Category" endpoint="/inventory/categories" searchPlaceholder="Search category"
      columns={[{ key: 'name', label: 'Category' }]}
      fields={[{ key: 'name', label: 'Category name', type: 'text', required: true }]} />
  );
}

const productFields = [
  { key: 'category_id', label: 'Category', type: 'select', required: true, optionsFrom: '/inventory/categories' },
  { key: 'sku', label: 'SKU', type: 'text', required: true },
  { key: 'name', label: 'Product name', type: 'text', required: true },
  { key: 'mrp', label: 'MRP (₹)', type: 'number', required: true },
  { key: 'dp_price', label: 'Distributor price (₹)', type: 'number', required: true },
  { key: 'bv', label: 'Business volume (BV)', type: 'number', required: true },
  { key: 'gst_percent', label: 'GST %', type: 'number', required: true },
  { key: 'hsn_code', label: 'HSN code', type: 'text' },
  { key: 'image_url', label: 'Product image', type: 'image' },
];
const productFilters = [{ key: 'category_id', label: 'Category', optionsFrom: '/inventory/categories' }];
export function ProductsPage() {
  return (
    <CrudPage title="Product" endpoint="/inventory/products" searchPlaceholder="Search name, SKU or category"
      fields={productFields} filters={productFilters}
      columns={[
        { key: 'image_url', label: '', render: (r) => r.image_url
          ? <img src={r.image_url} alt="" className="h-10 w-10 rounded-lg object-cover border border-gray-200" />
          : <div className="h-10 w-10 rounded-lg bg-gray-100" /> },
        { key: 'sku', label: 'SKU' },
        { key: 'name', label: 'Product' },
        { key: 'category_name', label: 'Category' },
        { key: 'mrp', label: 'MRP', render: (r) => money(r.mrp) },
        { key: 'dp_price', label: 'DP', render: (r) => money(r.dp_price) },
        { key: 'bv', label: 'BV' },
        { key: 'gst_percent', label: 'GST', render: (r) => `${r.gst_percent}%` },
      ]} />
  );
}

const supplierFields = [
  { key: 'name', label: 'Supplier name', type: 'text', required: true },
  { key: 'contact_person', label: 'Contact person', type: 'text' },
  { key: 'mobile', label: 'Mobile', type: 'text' },
  { key: 'email', label: 'Email', type: 'text' },
  { key: 'gstin', label: 'GSTIN', type: 'text' },
  { key: 'address', label: 'Address', type: 'textarea' },
];
export function SuppliersPage() {
  return (
    <CrudPage title="Supplier" endpoint="/inventory/suppliers" searchPlaceholder="Search name, mobile or GSTIN"
      fields={supplierFields}
      columns={[
        { key: 'name', label: 'Supplier' },
        { key: 'contact_person', label: 'Contact' },
        { key: 'mobile', label: 'Mobile' },
        { key: 'gstin', label: 'GSTIN' },
      ]} />
  );
}

export function CouriersPage() {
  return (
    <CrudPage title="Courier and Transport" endpoint="/inventory/couriers" searchPlaceholder="Search courier"
      fields={[
        { key: 'name', label: 'Courier / transport name', type: 'text', required: true },
        { key: 'contact', label: 'Contact', type: 'text' },
        { key: 'tracking_url_template', label: 'Tracking URL (use {tracking_no})', type: 'text' },
      ]}
      columns={[
        { key: 'name', label: 'Courier' },
        { key: 'contact', label: 'Contact' },
      ]} />
  );
}

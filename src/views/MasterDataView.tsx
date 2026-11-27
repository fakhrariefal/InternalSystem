import {
  Ban,
  Check,
  CheckCircle2,
  FileDown,
  Lock,
  MapPin,
  Package,
  Pencil,
  Plus,
  Printer,
  Search,
  ShieldCheck,
  Trash2,
  Truck,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { usePrintDocument } from '../components/PrintableDocumentModal';
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeSelect,
  StatusLabel,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '../components/ui/primitives';
import type { ErpController } from '../controllers/useErpController';
import { useI18n } from '../lib/i18n';
import {
  findSeededDummyMasterTargets,
  formatCurrency,
  getPartnerVerificationStatus,
  getTotalProductStock,
  isBuyerTopScheme,
  isLowStockProduct,
  normalizeSupplierCategories,
  resolveBuyerTermDays,
  resolveSupplierTermDays,
} from '../models/erpLogic';
import {
  buildBuyerRegistrationPrintDoc,
  buildSupplierRegistrationPrintDoc,
  buildSuratJalanPrintDoc,
} from '../models/printDocumentModel';
import { ALL_ROLES, getRoleDescription, hasPermission } from '../models/rbac';
import { createInitialSeedState } from '../models/seedData';
import type {
  BuyerPaymentScheme,
  CurrencyCode,
  Customer,
  PartnerVerificationStatus,
  Product,
  Supplier,
  SupplierCategory,
  SupplierPaymentScheme,
  TaxPkpStatus,
  UserProfile,
  UserRole,
  Warehouse,
} from '../models/types';
import {
  exportBuyerRegistrationPdf,
  exportSupplierRegistrationPdf,
  exportSuratJalanPdf,
} from '../services/exportService';

const TAX_PKP_OPTIONS: TaxPkpStatus[] = ['PKP', 'Non-PKP'];
const SUPPLIER_PAYMENT_SCHEMES: SupplierPaymentScheme[] = ['CBD', 'COD', 'TOP'];
const BUYER_PAYMENT_SCHEMES: BuyerPaymentScheme[] = ['CBD', 'TOP 14 Hari', 'TOP 30 Hari'];

function getVerificationTone(status: PartnerVerificationStatus): 'warning' | 'success' | 'danger' {
  switch (status) {
    case 'Verified':
      return 'success';
    case 'Blacklisted':
      return 'danger';
    default:
      return 'warning';
  }
}

function sanitizeDigits(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  return digits.replace(/^0+(?=\d)/, '');
}

export function MasterDataView({ erp }: { erp: ErpController }) {
  const { state, currentUser } = erp;
  const { tr } = useI18n();
  const { openPrintPreview } = usePrintDocument();
  const canWrite = hasPermission(currentUser?.role, 'master:write');
  const canWriteSupplier = hasPermission(currentUser?.role, 'supplier:write');
  const canWriteBuyer = hasPermission(currentUser?.role, 'buyer:write');
  const canApprovePartner = hasPermission(currentUser?.role, 'partner:approve');
  const isWarehouseFieldView = currentUser?.role === 'Warehouse';
  const canManageUsers = hasPermission(currentUser?.role, 'master:users');
  const canDeleteMaster = hasPermission(currentUser?.role, 'master:users');
  const showMasterActions = canWrite || canDeleteMaster;
  const showSupplierActions = !isWarehouseFieldView && (canWriteSupplier || canApprovePartner || canDeleteMaster);
  const showBuyerActions = !isWarehouseFieldView && (canWriteBuyer || canApprovePartner || canDeleteMaster);

  const [search, setSearch] = useState('');
  const [confirmDummyOpen, setConfirmDummyOpen] = useState(false);
  const [isClearingDummy, setIsClearingDummy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{
    title: string;
    description: string;
    detail: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [isConfirmDeleting, setIsConfirmDeleting] = useState(false);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [isSavingSupplier, setIsSavingSupplier] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);
  const [approveBuyerModalCustomer, setApproveBuyerModalCustomer] = useState<Customer | null>(null);
  const [approveBuyerStatus, setApproveBuyerStatus] = useState<PartnerVerificationStatus>('Verified');
  const [approveBuyerCreditLimit, setApproveBuyerCreditLimit] = useState('0');
  const [isApprovingBuyer, setIsApprovingBuyer] = useState(false);
  const [warehouseModalOpen, setWarehouseModalOpen] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);

  const supplierCategories = useMemo(
    () => normalizeSupplierCategories(state.settings.supplierCategories),
    [state.settings.supplierCategories]
  );
  const canManageSupplierCats = canWrite || canWriteSupplier;

  // Product form state
  const [pSku, setPSku] = useState('');
  const [pName, setPName] = useState('');
  const [pIsService, setPIsService] = useState(false);
  const [pCatId, setPCatId] = useState(state.categories[0]?.id || 'cat_ppe');
  const [pUom, setPUom] = useState(state.uoms[0]?.code || 'PCS');
  const [pCurr, setPCurr] = useState<CurrencyCode>('IDR');
  const [pBuy, setPBuy] = useState('0');
  const [pSell, setPSell] = useState('0');
  const [pMin, setPMin] = useState('10');
  const [pMax, setPMax] = useState('200');
  const [pDesc, setPDesc] = useState('');
  const [pPhotoFile, setPPhotoFile] = useState<File | null>(null);

  // Supplier registration form state
  const [sCode, setSCode] = useState('');
  const [sName, setSName] = useState('');
  const [sCategory, setSCategory] = useState<SupplierCategory>(supplierCategories[0] || 'Safety/MRO');
  const [sNib, setSNib] = useState('');
  const [sNpwp, setSNpwp] = useState('');
  const [sTaxStatus, setSTaxStatus] = useState<TaxPkpStatus>('PKP');
  const [sAddress, setSAddress] = useState('');
  const [sPic, setSPic] = useState('');
  const [sPhone, setSPhone] = useState('');
  const [sEmail, setSEmail] = useState('');
  const [sBank, setSBank] = useState('');
  const [sAccount, setSAccount] = useState('');
  const [sPaymentScheme, setSPaymentScheme] = useState<SupplierPaymentScheme>('TOP');
  const [sTerm, setSTerm] = useState('30');
  const [sCurr, setSCurr] = useState<CurrencyCode>('IDR');
  const [sVerificationStatus, setSVerificationStatus] = useState<PartnerVerificationStatus>('Pending');

  // Customer (Buyer) registration form state
  const [cCode, setCCode] = useState('');
  const [cName, setCName] = useState('');
  const [cNib, setCNib] = useState('');
  const [cNpwp, setCNpwp] = useState('');
  const [cTaxStatus, setCTaxStatus] = useState<TaxPkpStatus>('PKP');
  const [cBillingAddress, setCBillingAddress] = useState('');
  const [cShippingAddress, setCShippingAddress] = useState('');
  const [cPicPurchasingName, setCPicPurchasingName] = useState('');
  const [cPicPurchasingPhone, setCPicPurchasingPhone] = useState('');
  const [cPicWarehouseName, setCPicWarehouseName] = useState('');
  const [cPicWarehousePhone, setCPicWarehousePhone] = useState('');
  const [cPicFinanceName, setCPicFinanceName] = useState('');
  const [cPicFinancePhone, setCPicFinancePhone] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cPaymentScheme, setCPaymentScheme] = useState<BuyerPaymentScheme>('CBD');
  const [cLimit, setCLimit] = useState('0');
  const [cVerificationStatus, setCVerificationStatus] = useState<PartnerVerificationStatus>('Pending');

  // Warehouse form state
  const [wCode, setWCode] = useState('');
  const [wName, setWName] = useState('');
  const [wAddress, setWAddress] = useState('');
  const [wPic, setWPic] = useState('');
  const [wPhone, setWPhone] = useState('');

  // Quick Category, Supplier Category & UOM forms
  const [newCatCode, setNewCatCode] = useState('');
  const [newCatName, setNewCatName] = useState('');
  const [newUomCode, setNewUomCode] = useState('');
  const [newUomName, setNewUomName] = useState('');
  const [newSupCat, setNewSupCat] = useState('');
  const [editingSupCat, setEditingSupCat] = useState<{ original: string; value: string } | null>(null);
  const [isSavingSupCats, setIsSavingSupCats] = useState(false);

  // User form state
  const [uDisplayName, setUDisplayName] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [uDepartment, setUDepartment] = useState('');
  const [uRole, setURole] = useState<UserRole>('Purchasing');
  const [uActive, setUActive] = useState(true);

  const q = search.trim().toLowerCase();

  const openProductForm = (prod?: Product) => {
    setEditingProduct(prod || null);
    setPSku(prod?.sku || `PRD-${String(state.products.length + 1).padStart(3, '0')}`);
    setPName(prod?.name || '');
    setPIsService(Boolean(prod?.isService));
    setPCatId(prod?.categoryId || state.categories[0]?.id || '');
    setPUom(prod?.uomCode || state.uoms[0]?.code || 'PCS');
    setPCurr(prod?.currency || 'IDR');
    setPBuy(String(prod?.buyPrice ?? 0));
    setPSell(String(prod?.sellPrice ?? 0));
    setPMin(String(prod?.isService ? 0 : (prod?.minStock ?? 10)));
    setPMax(String(prod?.isService ? 0 : (prod?.maxStock ?? 200)));
    setPDesc(prod?.description || '');
    setPPhotoFile(null);
    setProductModalOpen(true);
  };

  const openSupplierForm = (sup?: Supplier) => {
    setEditingSupplier(sup || null);
    setSCode(sup?.code || `SUP-${String(state.suppliers.length + 1).padStart(3, '0')}`);
    setSName(sup?.name || '');
    setSCategory(sup?.vendorCategory || supplierCategories[0] || 'Safety/MRO');
    setSNib(sup?.nib || '');
    setSNpwp(sup?.npwp || '');
    setSTaxStatus(sup?.taxStatus || 'PKP');
    setSAddress(sup?.address || '');
    setSPic(sup?.contactPerson || '');
    setSPhone(sup?.phone || '');
    setSEmail(sup?.email || '');
    setSBank(sup?.bankName || '');
    setSAccount(sup?.bankAccount || '');
    const inferredScheme: SupplierPaymentScheme =
      sup?.paymentScheme || ((sup?.paymentTermDays ?? 30) > 0 ? 'TOP' : 'CBD');
    setSPaymentScheme(inferredScheme);
    setSTerm(String(sup?.paymentTermDays ?? (inferredScheme === 'TOP' ? 30 : 0)));
    setSCurr(sup?.defaultCurrency || 'IDR');
    setSVerificationStatus(
      sup ? getPartnerVerificationStatus(sup) : canApprovePartner ? 'Verified' : 'Pending'
    );
    setSupplierModalOpen(true);
  };

  const openCustomerForm = (cus?: Customer) => {
    setEditingCustomer(cus || null);
    setCCode(cus?.code || `CUS-${String(state.customers.length + 1).padStart(3, '0')}`);
    setCName(cus?.name || '');
    setCNib(cus?.nib || '');
    setCNpwp(cus?.npwp || '');
    setCTaxStatus(cus?.taxStatus || 'PKP');
    setCBillingAddress(cus?.billingAddress || cus?.address || '');
    setCShippingAddress(cus?.shippingAddress || cus?.address || '');
    setCPicPurchasingName(cus?.picPurchasingName || cus?.contactPerson || '');
    setCPicPurchasingPhone(cus?.picPurchasingPhone || cus?.phone || '');
    setCPicWarehouseName(cus?.picWarehouseName || '');
    setCPicWarehousePhone(cus?.picWarehousePhone || '');
    setCPicFinanceName(cus?.picFinanceName || '');
    setCPicFinancePhone(cus?.picFinancePhone || '');
    setCEmail(cus?.email || '');
    const inferredScheme: BuyerPaymentScheme =
      cus?.paymentScheme ||
      ((cus?.paymentTermDays ?? 0) >= 30
        ? 'TOP 30 Hari'
        : (cus?.paymentTermDays ?? 0) >= 14
          ? 'TOP 14 Hari'
          : 'CBD');
    setCPaymentScheme(inferredScheme);
    setCLimit(String(cus?.creditLimit ?? (canApprovePartner ? 100000000 : 0)));
    setCVerificationStatus(
      cus ? getPartnerVerificationStatus(cus) : canApprovePartner ? 'Verified' : 'Pending'
    );
    setCustomerModalOpen(true);
  };

  const openApproveBuyerModal = (cus: Customer) => {
    setApproveBuyerModalCustomer(cus);
    const currentStatus = getPartnerVerificationStatus(cus);
    setApproveBuyerStatus(currentStatus === 'Blacklisted' ? 'Blacklisted' : 'Verified');
    setApproveBuyerCreditLimit(
      String(cus.creditLimit > 0 ? cus.creditLimit : isBuyerTopScheme(cus) ? 100000000 : 0)
    );
  };

  const openWarehouseForm = (wh?: Warehouse) => {
    setEditingWarehouse(wh || null);
    setWCode(wh?.code || `WH-0${state.warehouses.length + 1}`);
    setWName(wh?.name || '');
    setWAddress(wh?.address || '');
    setWPic(wh?.picName || '');
    setWPhone(wh?.phone || '');
    setWarehouseModalOpen(true);
  };

  const openUserForm = (usr?: UserProfile) => {
    setEditingUser(usr || null);
    setUDisplayName(usr?.displayName || '');
    setUEmail(usr?.email || '');
    setUDepartment(usr?.department || 'Procurement');
    setURole(usr?.role || 'Purchasing');
    setUActive(usr ? usr.active : true);
    setUserModalOpen(true);
  };

  const filteredProducts = state.products.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      (p.categoryName || '').toLowerCase().includes(q)
  );
  const filteredSuppliers = state.suppliers.filter(
    (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
  );
  const filteredCustomers = state.customers.filter(
    (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
  );
  const filteredUsers = state.users.filter(
    (u) =>
      !q ||
      u.displayName.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.department || '').toLowerCase().includes(q)
  );

  const dummyTargets = useMemo(
    () => findSeededDummyMasterTargets(state, createInitialSeedState()),
    [state]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-[#0B1B3A]">
            {tr('Master Data Korporat', 'Corporate Master Data')}
          </h2>
          <p className="text-xs sm:text-sm text-slate-600">
            {tr(
              'Pengelolaan katalog produk, supplier, customer, lokasi gudang, dan otoritas pengguna.',
              'Manage product catalog, suppliers, customers, warehouse locations, and user access.'
            )}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
            <Input
              aria-label={tr('Cari data master', 'Search master data')}
              placeholder={tr('Cari SKU, nama, kode...', 'Search SKU, name, code...')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {canDeleteMaster && dummyTargets.totalCount > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmDummyOpen(true)}
              className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 whitespace-nowrap"
            >
              <Trash2 className="h-4 w-4" />
              {tr('Hapus Data Dummy', 'Remove Sample Data')} ({dummyTargets.totalCount})
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">{tr('Produk', 'Products')} ({state.products.length})</TabsTrigger>
          <TabsTrigger value="suppliers">{tr('Supplier', 'Suppliers')} ({state.suppliers.length})</TabsTrigger>
          <TabsTrigger value="customers">{tr('Customer', 'Customers')} ({state.customers.length})</TabsTrigger>
          <TabsTrigger value="warehouses">{tr('Gudang', 'Warehouses')} ({state.warehouses.length})</TabsTrigger>
          <TabsTrigger value="refs">{tr('Kategori & Satuan', 'Categories & UoM')}</TabsTrigger>
          <TabsTrigger value="users">{tr('User & Role', 'Users & Roles')} ({state.users.length})</TabsTrigger>
        </TabsList>

        {/* PRODUCTS TAB */}
        <TabsContent value="products" className="space-y-3">
          <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-[#0B1B3A]">
              Katalog Produk ({filteredProducts.length})
            </span>
            {canWrite && (
              <Button type="button" size="sm" onClick={() => openProductForm()}>
                <Plus className="h-4 w-4" />
                Tambah Produk
              </Button>
            )}
          </div>

          {/* Mobile Products Cards */}
          <div className="space-y-3 md:hidden">
            {filteredProducts.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-xs text-slate-500">
                  Belum ada data produk.
                </CardContent>
              </Card>
            ) : (
              filteredProducts.map((p) => {
                const total = getTotalProductStock(p);
                const low = isLowStockProduct(p);
                return (
                  <Card key={`m_prd_${p.id}`}>
                    <CardContent className="p-4 space-y-3 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {p.imageUrl ? (
                            <img
                              src={p.imageUrl}
                              alt={p.name}
                              referrerPolicy="no-referrer"
                              className="h-10 w-10 rounded-lg object-cover border border-slate-200 shrink-0"
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                              <Package className="h-4 w-4 text-slate-400" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-semibold text-[#0B1B3A] truncate">{p.name}</div>
                            <div className="text-[11px] font-mono text-slate-500">
                              {p.sku} · {p.categoryName}
                            </div>
                          </div>
                        </div>
                        <StatusLabel
                          status={p.isService ? 'Service / Non-Stok' : low ? `Kritis (${total})` : `${total} ${p.uomCode}`}
                          tone={p.isService ? 'info' : low ? 'danger' : 'success'}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2 rounded-lg bg-[#F4F7FB] p-2.5">
                        <div>
                          <span className="text-[10px] text-slate-500 block">Harga Beli</span>
                          <span className="font-mono font-semibold text-slate-800 tabular-nums">
                            {formatCurrency(p.buyPrice, p.currency)}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-slate-500 block">Harga Jual</span>
                          <span className="font-mono font-bold text-[#0B1B3A] tabular-nums">
                            {formatCurrency(p.sellPrice, p.currency)}
                          </span>
                        </div>
                      </div>

                      {showMasterActions && (
                        <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
                          {canWrite && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openProductForm(p)}
                              className="flex-1"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </Button>
                          )}
                          {canDeleteMaster && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setConfirmDelete({
                                  title: 'Hapus Produk?',
                                  description: 'Data produk akan dihapus permanen dari katalog master.',
                                  detail: `${p.sku} — ${p.name}`,
                                  onConfirm: async () => {
                                    await erp.deleteProduct(p.id);
                                  },
                                })
                              }
                              className="text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Hapus
                            </Button>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>

          {/* Desktop Products Table */}
          <Card className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-semibold">SKU &amp; Nama Produk</th>
                    <th className="py-3 px-3 font-semibold">Kategori</th>
                    <th className="py-3 px-3 font-semibold text-right">Harga Beli</th>
                    <th className="py-3 px-3 font-semibold text-right">Harga Jual</th>
                    <th className="py-3 px-3 font-semibold text-right">Total Stok</th>
                    <th className="py-3 px-3 font-semibold">Status Stok</th>
                    {showMasterActions && <th className="py-3 px-4 font-semibold text-right">Aksi</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={showMasterActions ? 7 : 6} className="py-8 text-center text-slate-500">
                        Belum ada data produk.
                      </td>
                    </tr>
                  ) : (
                    filteredProducts.map((p) => {
                      const total = getTotalProductStock(p);
                      const low = isLowStockProduct(p);
                      return (
                        <tr key={p.id} className="hover:bg-slate-50/70">
                          <td className="py-2.5 px-4">
                            <div className="flex items-center gap-3">
                              {p.imageUrl ? (
                                <img
                                  src={p.imageUrl}
                                  alt={p.name}
                                  referrerPolicy="no-referrer"
                                  className="h-9 w-9 rounded object-cover border border-slate-200 shrink-0"
                                />
                              ) : (
                                <div className="h-9 w-9 rounded bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                                  <Package className="h-4 w-4 text-slate-400" />
                                </div>
                              )}
                              <div>
                                <div className="font-medium text-slate-900 flex items-center gap-1.5 flex-wrap">
                                  <span>{p.name}</span>
                                  {p.isService && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#EBF3FA] text-[#154C7E] text-[10px] font-semibold">
                                      Service / Non-Stok
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] font-mono text-slate-500">
                                  {p.sku} · {p.uomCode}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">{p.categoryName}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {formatCurrency(p.buyPrice, p.currency)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium">
                            {formatCurrency(p.sellPrice, p.currency)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {p.isService ? <span className="text-slate-400">Non-Stok</span> : `${total} ${p.uomCode}`}
                          </td>
                          <td className="py-2.5 px-3">
                            <StatusLabel
                              status={p.isService ? 'Non-Stok' : low ? `Kritis (Min ${p.minStock})` : 'Aman'}
                              tone={p.isService ? 'info' : low ? 'danger' : 'success'}
                            />
                          </td>
                          {showMasterActions && (
                            <td className="py-2.5 px-4 text-right space-x-1 whitespace-nowrap">
                              {canWrite && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  aria-label={`Edit produk ${p.name}`}
                                  onClick={() => openProductForm(p)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              {canDeleteMaster && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  aria-label={`Hapus produk ${p.name}`}
                                  onClick={() =>
                                    setConfirmDelete({
                                      title: 'Hapus Produk?',
                                      description: 'Data produk akan dihapus permanen dari katalog master.',
                                      detail: `${p.sku} — ${p.name}`,
                                      onConfirm: async () => {
                                        await erp.deleteProduct(p.id);
                                      },
                                    })
                                  }
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* SUPPLIERS TAB */}
        <TabsContent value="suppliers" className="space-y-3">
          <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="text-sm font-semibold text-[#0B1B3A] block">
                {tr('Daftar Supplier', 'Supplier Directory')} ({filteredSuppliers.length})
              </span>
              {!isWarehouseFieldView && (
                <p className="text-[11px] text-slate-500">
                  {canApprovePartner
                    ? 'Sebagai Admin (Direktur), Anda memiliki kendali penuh tombol Approve (Verified) / Blacklist supplier.'
                    : 'Staff Purchasing dapat mendaftarkan supplier baru (status awal Pending). Transaksi tempo / nilai > Rp 10 jt menunggu Approve Admin.'}
                </p>
              )}
            </div>
            {canWriteSupplier && (
              <Button type="button" size="sm" onClick={() => openSupplierForm()} className="w-full sm:w-auto shrink-0">
                <Plus className="h-4 w-4" />
                Registrasi Supplier
              </Button>
            )}
          </div>

          {isWarehouseFieldView && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-900 flex items-start gap-2.5">
              <Lock className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Mode Gudang / Operasional (Read-Only):</span> Informasi legalitas pajak (NPWP/NIB), rekening bank, dan syarat pembayaran disembunyikan untuk keamanan finansial.
              </div>
            </div>
          )}

          {/* Mobile Suppliers Cards */}
          <div className="space-y-3 md:hidden">
            {filteredSuppliers.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-xs text-slate-500">
                  Belum ada data supplier.
                </CardContent>
              </Card>
            ) : (
              filteredSuppliers.map((s) => {
                const vStatus = getPartnerVerificationStatus(s);
                const schemeLabel =
                  s.paymentScheme === 'CBD' || s.paymentScheme === 'COD'
                    ? s.paymentScheme
                    : `TOP · NET ${s.paymentTermDays} Hari`;
                return (
                  <Card key={`m_sup_${s.id}`}>
                    <CardContent className="p-4 space-y-2.5 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-[#0B1B3A] text-sm">{s.name}</div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {s.code} · {s.vendorCategory || 'Safety/MRO'}
                          </div>
                        </div>
                        {!isWarehouseFieldView && (
                          <StatusLabel status={vStatus} tone={getVerificationTone(vStatus)} />
                        )}
                      </div>

                      <div className="rounded-lg bg-[#F4F7FB] p-2.5 space-y-1 text-[11px]">
                        <div>
                          PIC: <span className="font-medium text-slate-800">{s.contactPerson || '-'}</span> · {s.phone || '-'}
                        </div>
                        <div className="text-slate-600">{s.address || '-'}</div>
                        {!isWarehouseFieldView && (
                          <>
                            <div className="font-mono text-slate-600 pt-0.5">
                              NIB: {s.nib || '-'} · NPWP: {s.npwp || '-'} ({s.taxStatus || 'PKP'})
                            </div>
                            <div>
                              Bank: {s.bankName || '-'} ({s.bankAccount || '-'})
                            </div>
                            <div className="flex items-center justify-between pt-1">
                              <span className="text-slate-500">Syarat Pembayaran</span>
                              <span className="font-semibold text-[#0B1B3A]">
                                {schemeLabel} ({s.defaultCurrency})
                              </span>
                            </div>
                          </>
                        )}
                      </div>

                      {(!isWarehouseFieldView && vStatus === 'Verified' || showSupplierActions) && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {!isWarehouseFieldView && vStatus === 'Verified' && (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  openPrintPreview(
                                    buildSupplierRegistrationPrintDoc(s, state.settings),
                                    () => exportSupplierRegistrationPdf(s, state.settings)
                                  )
                                }
                                className="border-emerald-200 text-emerald-800 hover:bg-emerald-50"
                              >
                                <Printer className="h-3.5 w-3.5" />
                                Cetak Bukti
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void exportSupplierRegistrationPdf(s, state.settings)}
                                className="border-emerald-200 text-emerald-800 hover:bg-emerald-50"
                              >
                                <FileDown className="h-3.5 w-3.5" />
                                Bukti Registrasi
                              </Button>
                            </>
                          )}
                          {canApprovePartner && vStatus !== 'Verified' && (
                            <Button
                              type="button"
                              variant="accent"
                              size="sm"
                              onClick={() => void erp.verifySupplier(s.id, 'Verified')}
                            >
                              <ShieldCheck className="h-3.5 w-3.5" />
                              Approve
                            </Button>
                          )}
                          {canApprovePartner && vStatus !== 'Blacklisted' && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => void erp.verifySupplier(s.id, 'Blacklisted')}
                              className="border-red-200 text-red-700 hover:bg-red-50"
                            >
                              <Ban className="h-3.5 w-3.5" />
                              Blacklist
                            </Button>
                          )}
                          {canWriteSupplier && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              onClick={() => openSupplierForm(s)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </Button>
                          )}
                          {canDeleteMaster && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setConfirmDelete({
                                  title: 'Hapus Supplier?',
                                  description: 'Data supplier yang dipilih akan dihapus permanen.',
                                  detail: `${s.code} — ${s.name}`,
                                  onConfirm: async () => {
                                    await erp.deleteSupplier(s.id);
                                  },
                                })
                              }
                              className="text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Hapus
                            </Button>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>

          {/* Desktop Suppliers Table */}
          <Card className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Supplier &amp; Kategori</th>
                    <th className="py-3 px-3 font-semibold">
                      {isWarehouseFieldView ? 'Kontak & Alamat' : 'Legalitas & Pajak'}
                    </th>
                    {!isWarehouseFieldView && <th className="py-3 px-3 font-semibold">Rekening Bank</th>}
                    {!isWarehouseFieldView && <th className="py-3 px-3 font-semibold">Syarat Bayar</th>}
                    {!isWarehouseFieldView && <th className="py-3 px-3 font-semibold">Status Verifikasi</th>}
                    {(!isWarehouseFieldView || showSupplierActions) && (
                      <th className="py-3 px-4 font-semibold text-right">Aksi</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSuppliers.length === 0 ? (
                    <tr>
                      <td
                        colSpan={isWarehouseFieldView ? 2 : 6}
                        className="py-8 text-center text-slate-500"
                      >
                        Belum ada data supplier.
                      </td>
                    </tr>
                  ) : (
                    filteredSuppliers.map((s) => {
                      const vStatus = getPartnerVerificationStatus(s);
                      const schemeLabel =
                        s.paymentScheme === 'CBD' || s.paymentScheme === 'COD'
                          ? s.paymentScheme
                          : `TOP · NET ${s.paymentTermDays} Hari`;
                      return (
                        <tr key={s.id} className="hover:bg-slate-50/70 align-top">
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-900">{s.name}</div>
                            <div className="text-[11px] font-mono text-slate-500">
                              {s.code} · {s.vendorCategory || 'Safety/MRO'}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              {s.contactPerson || '-'} · {s.phone || '-'}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-slate-600">
                            {isWarehouseFieldView ? (
                              <div>{s.address || '-'}</div>
                            ) : (
                              <div className="space-y-1">
                                <div className="text-[11px]">
                                  <span className="font-semibold text-[#0B1B3A]">{s.taxStatus || 'PKP'}</span> ·{' '}
                                  <span className="font-mono">NPWP: {s.npwp || '-'}</span>
                                </div>
                                <div className="text-[11px] font-mono text-slate-500">NIB: {s.nib || '-'}</div>
                              </div>
                            )}
                          </td>
                          {!isWarehouseFieldView && (
                            <td className="py-3 px-3 text-slate-600">
                              <div className="font-medium text-slate-800">{s.bankName || '-'}</div>
                              <div className="text-[11px] font-mono text-slate-500">{s.bankAccount || '-'}</div>
                            </td>
                          )}
                          {!isWarehouseFieldView && (
                            <td className="py-3 px-3 tabular-nums">
                              <div className="font-medium text-slate-900">{schemeLabel}</div>
                              <div className="text-[11px] font-mono text-slate-500">{s.defaultCurrency}</div>
                            </td>
                          )}
                          {!isWarehouseFieldView && (
                            <td className="py-3 px-3">
                              <StatusLabel status={vStatus} tone={getVerificationTone(vStatus)} />
                            </td>
                          )}
                          {(!isWarehouseFieldView || showSupplierActions) && (
                            <td className="py-3 px-4 text-right space-x-1 whitespace-nowrap">
                              {!isWarehouseFieldView && vStatus === 'Verified' && (
                                <>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      openPrintPreview(
                                        buildSupplierRegistrationPrintDoc(s, state.settings),
                                        () => exportSupplierRegistrationPdf(s, state.settings)
                                      )
                                    }
                                    aria-label={`Cetak bukti registrasi supplier ${s.name}`}
                                    className="border-emerald-200 text-emerald-800 hover:bg-emerald-50"
                                  >
                                    <Printer className="h-3.5 w-3.5" />
                                    Cetak Bukti
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void exportSupplierRegistrationPdf(s, state.settings)}
                                    aria-label={`Export bukti registrasi supplier ${s.name}`}
                                    className="border-emerald-200 text-emerald-800 hover:bg-emerald-50"
                                  >
                                    <FileDown className="h-3.5 w-3.5" />
                                    Bukti Registrasi
                                  </Button>
                                </>
                              )}
                              {canApprovePartner && vStatus !== 'Verified' && (
                                <Button
                                  type="button"
                                  variant="accent"
                                  size="sm"
                                  onClick={() => void erp.verifySupplier(s.id, 'Verified')}
                                  aria-label={`Approve supplier ${s.name}`}
                                >
                                  <ShieldCheck className="h-3.5 w-3.5" />
                                  Approve
                                </Button>
                              )}
                              {canApprovePartner && vStatus !== 'Blacklisted' && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void erp.verifySupplier(s.id, 'Blacklisted')}
                                  aria-label={`Blacklist supplier ${s.name}`}
                                  className="border-red-200 text-red-700 hover:bg-red-50"
                                >
                                  <Ban className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              {canWriteSupplier && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  aria-label={`Edit supplier ${s.name}`}
                                  onClick={() => openSupplierForm(s)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              {canDeleteMaster && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  aria-label={`Hapus supplier ${s.name}`}
                                  onClick={() =>
                                    setConfirmDelete({
                                      title: 'Hapus Supplier?',
                                      description: 'Data supplier yang dipilih akan dihapus permanen.',
                                      detail: `${s.code} — ${s.name}`,
                                      onConfirm: async () => {
                                        await erp.deleteSupplier(s.id);
                                      },
                                    })
                                  }
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* CUSTOMERS (BUYER) TAB */}
        <TabsContent value="customers" className="space-y-3">
          {isWarehouseFieldView ? (
            <>
              <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-sm font-semibold text-[#0B1B3A] block">
                    Alamat Pengiriman &amp; Kontak PIC Lapangan ({filteredCustomers.length})
                  </span>
                  <p className="text-[11px] text-slate-600">
                    Akses Read-Only khusus Role Gudang / Operasional untuk pencetakan Surat Jalan.
                  </p>
                </div>
                <StatusLabel status="Read-Only Surat Jalan" tone="info" />
              </div>

              <div className="rounded-xl border border-[#BFD9EF] bg-[#EBF3FA]/60 p-3.5 text-xs text-[#0B1B3A] flex items-start gap-2.5">
                <MapPin className="h-4 w-4 text-[#1B5E99] shrink-0 mt-0.5" />
                <div>
                  Hanya menampilkan <strong>Alamat Kirim</strong> dan <strong>Kontak PIC Gudang/Lapangan</strong> untuk keperluan logistik &amp; Surat Jalan. Data NPWP, NIB, Credit Limit, dan histori tagihan dibatasi.
                </div>
              </div>

              {/* Mobile Warehouse Read-Only Customer Cards */}
              <div className="space-y-3 md:hidden">
                {filteredCustomers.map((c) => {
                  const latestSo =
                    state.salesOrders.find((so) => so.customerId === c.id && so.status !== 'Draft') ||
                    state.salesOrders.find((so) => so.customerId === c.id);
                  return (
                    <Card key={`m_wh_cus_${c.id}`}>
                      <CardContent className="p-4 space-y-2.5 text-xs">
                        <div>
                          <div className="font-semibold text-[#0B1B3A] text-sm">{c.name}</div>
                          <div className="text-[11px] font-mono text-slate-500">{c.code}</div>
                        </div>
                        <div className="rounded-lg bg-[#F4F7FB] p-2.5 space-y-1.5 text-[11px]">
                          <div>
                            <span className="text-slate-500 block font-medium">Alamat Pengiriman:</span>
                            <span className="text-slate-800">{c.shippingAddress || c.address || '-'}</span>
                          </div>
                          <div>
                            <span className="text-slate-500 block font-medium">PIC Lapangan / Gudang:</span>
                            <span className="font-semibold text-[#0B1B3A]">
                              {c.picWarehouseName || c.contactPerson || '-'}
                            </span>{' '}
                            · {c.picWarehousePhone || c.phone || '-'}
                          </div>
                        </div>
                        {latestSo ? (
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                const wh = state.warehouses.find((w) => w.id === latestSo.warehouseId);
                                openPrintPreview(
                                  buildSuratJalanPrintDoc(latestSo, state.settings, c, wh),
                                  () => exportSuratJalanPdf(latestSo, state.settings, c, wh)
                                );
                              }}
                            >
                              <Printer className="h-3.5 w-3.5 text-[#0B1B3A]" />
                              Cetak SJ
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              onClick={() =>
                                exportSuratJalanPdf(
                                  latestSo,
                                  state.settings,
                                  c,
                                  state.warehouses.find((w) => w.id === latestSo.warehouseId)
                                )
                              }
                            >
                              <Truck className="h-3.5 w-3.5 text-[#D9AA32]" />
                              Surat Jalan ({latestSo.soNumber})
                            </Button>
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-400 text-center py-1">
                            Belum ada Sales Order aktif untuk cetak Surat Jalan.
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Desktop Warehouse Read-Only Customer Table */}
              <Card className="hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-4 font-semibold">Kode &amp; Buyer</th>
                        <th className="py-3 px-3 font-semibold">Alamat Pengiriman (Drop Point)</th>
                        <th className="py-3 px-3 font-semibold">PIC Lapangan / Gudang</th>
                        <th className="py-3 px-4 font-semibold text-right">Cetak Surat Jalan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredCustomers.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-slate-500">
                            Belum ada data buyer.
                          </td>
                        </tr>
                      ) : (
                        filteredCustomers.map((c) => {
                          const latestSo =
                            state.salesOrders.find((so) => so.customerId === c.id && so.status !== 'Draft') ||
                            state.salesOrders.find((so) => so.customerId === c.id);
                          return (
                            <tr key={`wh_cus_${c.id}`} className="hover:bg-slate-50/70">
                              <td className="py-3 px-4">
                                <div className="font-medium text-slate-900">{c.name}</div>
                                <div className="text-[11px] font-mono text-slate-500">{c.code}</div>
                              </td>
                              <td className="py-3 px-3 text-slate-700 max-w-md">
                                {c.shippingAddress || c.address || '-'}
                              </td>
                              <td className="py-3 px-3 text-slate-700">
                                <div className="font-medium text-[#0B1B3A]">
                                  {c.picWarehouseName || c.contactPerson || '-'}
                                </div>
                                <div className="text-[11px] font-mono text-slate-500">
                                  {c.picWarehousePhone || c.phone || '-'}
                                </div>
                              </td>
                              <td className="py-3 px-4 text-right whitespace-nowrap">
                                {latestSo ? (
                                  <div className="inline-flex items-center gap-1">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        const wh = state.warehouses.find((w) => w.id === latestSo.warehouseId);
                                        openPrintPreview(
                                          buildSuratJalanPrintDoc(latestSo, state.settings, c, wh),
                                          () => exportSuratJalanPdf(latestSo, state.settings, c, wh)
                                        );
                                      }}
                                    >
                                      <Printer className="h-3.5 w-3.5 text-[#0B1B3A]" />
                                      Cetak
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() =>
                                        exportSuratJalanPdf(
                                          latestSo,
                                          state.settings,
                                          c,
                                          state.warehouses.find((w) => w.id === latestSo.warehouseId)
                                        )
                                      }
                                    >
                                      <Truck className="h-3.5 w-3.5 text-[#D9AA32]" />
                                      Surat Jalan ({latestSo.soNumber})
                                    </Button>
                                  </div>
                                ) : (
                                  <span className="text-[11px] text-slate-400">Belum ada SO</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          ) : (
            <>
              <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-sm font-semibold text-[#0B1B3A] block">
                    Daftar Buyer / Klien B2B ({filteredCustomers.length})
                  </span>
                  <p className="text-[11px] text-slate-500">
                    {canApprovePartner
                      ? 'Sebagai Admin (Direktur), klik Approve & Limit untuk memverifikasi buyer tempo (TOP) dan mengisi Credit Limit.'
                      : 'Pengajuan Buyer skema TOP wajib mencantumkan nomor NIB & NPWP; Credit Limit diisi & disetujui oleh role Admin (Direktur).'}
                  </p>
                </div>
                {canWriteBuyer && (
                  <Button type="button" size="sm" onClick={() => openCustomerForm()} className="w-full sm:w-auto shrink-0">
                    <Plus className="h-4 w-4" />
                    Registrasi Buyer
                  </Button>
                )}
              </div>

              {/* Mobile Customers Cards */}
              <div className="space-y-3 md:hidden">
                {filteredCustomers.length === 0 ? (
                  <Card>
                    <CardContent className="py-8 text-center text-xs text-slate-500">
                      Belum ada data buyer.
                    </CardContent>
                  </Card>
                ) : (
                  filteredCustomers.map((c) => {
                    const vStatus = getPartnerVerificationStatus(c);
                    const schemeLabel =
                      c.paymentScheme ||
                      (c.paymentTermDays >= 30
                        ? 'TOP 30 Hari'
                        : c.paymentTermDays >= 14
                          ? 'TOP 14 Hari'
                          : 'CBD');
                    return (
                      <Card key={`m_cus_${c.id}`}>
                        <CardContent className="p-4 space-y-2.5 text-xs">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-semibold text-[#0B1B3A] text-sm">{c.name}</div>
                              <div className="text-[11px] font-mono text-slate-500">
                                {c.code} · {c.taxStatus || 'PKP'} · {schemeLabel}
                              </div>
                            </div>
                            <StatusLabel status={vStatus} tone={getVerificationTone(vStatus)} />
                          </div>
                          <div className="rounded-lg bg-[#F4F7FB] p-2.5 space-y-1 text-[11px]">
                            <div>
                              <span className="text-slate-500">Purchasing:</span>{' '}
                              <span className="font-medium text-slate-800">
                                {c.picPurchasingName || c.contactPerson || '-'}
                              </span>{' '}
                              ({c.picPurchasingPhone || c.phone || '-'})
                            </div>
                            <div>
                              <span className="text-slate-500">Gudang:</span>{' '}
                              {c.picWarehouseName || '-'} ({c.picWarehousePhone || '-'})
                            </div>
                            <div>
                              <span className="text-slate-500">Finance:</span>{' '}
                              {c.picFinanceName || '-'} ({c.picFinancePhone || '-'})
                            </div>
                            <div className="text-slate-600 pt-0.5">
                              Alamat Kirim: {c.shippingAddress || c.address || '-'}
                            </div>
                            <div className="font-mono text-slate-500">
                              NIB: {c.nib || '-'} · NPWP: {c.npwp || '-'}
                            </div>
                            <div className="flex justify-between pt-1">
                              <span className="text-slate-500">Credit Limit (Admin)</span>
                              <span className="font-mono font-bold text-[#0B1B3A]">
                                {formatCurrency(c.creditLimit, 'IDR')}
                              </span>
                            </div>
                          </div>
                          {(vStatus === 'Verified' || showBuyerActions) && (
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              {vStatus === 'Verified' && (
                                <>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      openPrintPreview(
                                        buildBuyerRegistrationPrintDoc(c, state.settings),
                                        () => exportBuyerRegistrationPdf(c, state.settings)
                                      )
                                    }
                                    className="border-emerald-200 text-emerald-800 hover:bg-emerald-50"
                                  >
                                    <Printer className="h-3.5 w-3.5" />
                                    Cetak Bukti
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void exportBuyerRegistrationPdf(c, state.settings)}
                                    className="border-emerald-200 text-emerald-800 hover:bg-emerald-50"
                                  >
                                    <FileDown className="h-3.5 w-3.5" />
                                    Bukti Registrasi
                                  </Button>
                                </>
                              )}
                              {canApprovePartner && (
                                <Button
                                  type="button"
                                  variant="accent"
                                  size="sm"
                                  onClick={() => openApproveBuyerModal(c)}
                                >
                                  <ShieldCheck className="h-3.5 w-3.5" />
                                  {vStatus === 'Verified' ? 'Atur Limit' : 'Approve & Limit'}
                                </Button>
                              )}
                              {canWriteBuyer && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="flex-1"
                                  onClick={() => openCustomerForm(c)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  Edit
                                </Button>
                              )}
                              {canDeleteMaster && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    setConfirmDelete({
                                      title: 'Hapus Buyer?',
                                      description: 'Data buyer B2B yang dipilih akan dihapus permanen.',
                                      detail: `${c.code} — ${c.name}`,
                                      onConfirm: async () => {
                                        await erp.deleteCustomer(c.id);
                                      },
                                    })
                                  }
                                  className="text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Hapus
                                </Button>
                              )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>

              {/* Desktop Customers Table */}
              <Card className="hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-4 font-semibold">Buyer &amp; Alamat</th>
                        <th className="py-3 px-3 font-semibold">3 Kontak PIC (Purch/Gudang/Fin)</th>
                        <th className="py-3 px-3 font-semibold">NPWP &amp; NIB</th>
                        <th className="py-3 px-3 font-semibold text-right">Skema &amp; Credit Limit</th>
                        <th className="py-3 px-3 font-semibold">Status</th>
                        <th className="py-3 px-4 font-semibold text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredCustomers.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-slate-500">
                            Belum ada data buyer.
                          </td>
                        </tr>
                      ) : (
                        filteredCustomers.map((c) => {
                          const vStatus = getPartnerVerificationStatus(c);
                          const schemeLabel =
                            c.paymentScheme ||
                            (c.paymentTermDays >= 30
                              ? 'TOP 30 Hari'
                              : c.paymentTermDays >= 14
                                ? 'TOP 14 Hari'
                                : 'CBD');
                          return (
                            <tr key={c.id} className="hover:bg-slate-50/70 align-top">
                              <td className="py-3 px-4 max-w-[260px]">
                                <div className="font-medium text-slate-900">{c.name}</div>
                                <div className="text-[11px] font-mono text-slate-500">
                                  {c.code} · {c.taxStatus || 'PKP'}
                                </div>
                                <div className="text-[11px] text-slate-500 mt-1 line-clamp-2">
                                  <span className="font-medium text-slate-700">Kirim:</span>{' '}
                                  {c.shippingAddress || c.address || '-'}
                                </div>
                              </td>
                              <td className="py-3 px-3 text-slate-600 space-y-0.5 text-[11px]">
                                <div>
                                  <span className="font-semibold text-slate-800">Purch:</span>{' '}
                                  {c.picPurchasingName || c.contactPerson || '-'} · {c.picPurchasingPhone || c.phone || '-'}
                                </div>
                                <div>
                                  <span className="font-semibold text-slate-800">Gudang:</span>{' '}
                                  {c.picWarehouseName || '-'} · {c.picWarehousePhone || '-'}
                                </div>
                                <div>
                                  <span className="font-semibold text-slate-800">Finance:</span>{' '}
                                  {c.picFinanceName || '-'} · {c.picFinancePhone || '-'}
                                </div>
                              </td>
                              <td className="py-3 px-3 text-[11px] text-slate-600 space-y-1">
                                <div className="font-mono">NPWP: {c.npwp || '-'}</div>
                                <div className="font-mono text-slate-500">NIB: {c.nib || '-'}</div>
                              </td>
                              <td className="py-3 px-3 text-right">
                                <div className="font-semibold text-[#0B1B3A]">{schemeLabel}</div>
                                <div className="text-[11px] font-mono tabular-nums font-bold text-slate-800 mt-0.5">
                                  {c.creditLimit > 0
                                    ? formatCurrency(c.creditLimit, 'IDR')
                                    : isBuyerTopScheme(c)
                                      ? 'Menunggu Admin'
                                      : formatCurrency(0, 'IDR')}
                                </div>
                              </td>
                              <td className="py-3 px-3">
                                <StatusLabel status={vStatus} tone={getVerificationTone(vStatus)} />
                              </td>
                              <td className="py-3 px-4 text-right space-x-1 whitespace-nowrap">
                                {vStatus === 'Verified' && (
                                  <>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() =>
                                        openPrintPreview(
                                          buildBuyerRegistrationPrintDoc(c, state.settings),
                                          () => exportBuyerRegistrationPdf(c, state.settings)
                                        )
                                      }
                                      aria-label={`Cetak bukti registrasi buyer ${c.name}`}
                                      className="border-emerald-200 text-emerald-800 hover:bg-emerald-50"
                                    >
                                      <Printer className="h-3.5 w-3.5" />
                                      Cetak Bukti
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => void exportBuyerRegistrationPdf(c, state.settings)}
                                      aria-label={`Export bukti registrasi buyer ${c.name}`}
                                      className="border-emerald-200 text-emerald-800 hover:bg-emerald-50"
                                    >
                                      <FileDown className="h-3.5 w-3.5" />
                                      Bukti Registrasi
                                    </Button>
                                  </>
                                )}
                                {canApprovePartner && (
                                  <Button
                                    type="button"
                                    variant="accent"
                                    size="sm"
                                    onClick={() => openApproveBuyerModal(c)}
                                    aria-label={`Approve dan atur credit limit ${c.name}`}
                                  >
                                    <ShieldCheck className="h-3.5 w-3.5" />
                                    {vStatus === 'Verified' ? 'Limit' : 'Approve'}
                                  </Button>
                                )}
                                {canWriteBuyer && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    aria-label={`Edit customer ${c.name}`}
                                    onClick={() => openCustomerForm(c)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                                {canDeleteMaster && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    aria-label={`Hapus customer ${c.name}`}
                                    onClick={() =>
                                      setConfirmDelete({
                                        title: 'Hapus Buyer?',
                                        description: 'Data buyer B2B yang dipilih akan dihapus permanen.',
                                        detail: `${c.code} — ${c.name}`,
                                        onConfirm: async () => {
                                          await erp.deleteCustomer(c.id);
                                        },
                                      })
                                    }
                                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </TabsContent>

        {/* WAREHOUSES TAB */}
        <TabsContent value="warehouses">
          <Card>
            <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-[#0B1B3A]">
                Lokasi Gudang ({state.warehouses.length})
              </span>
              {canWrite && (
                <Button type="button" size="sm" onClick={() => openWarehouseForm()}>
                  <Plus className="h-4 w-4" />
                  Tambah Gudang
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
              {state.warehouses.length === 0 ? (
                <div className="col-span-full py-8 text-center text-xs text-slate-500">
                  Belum ada data gudang.
                </div>
              ) : (
                state.warehouses.map((w) => (
                  <div key={w.id} className="rounded-xl border border-slate-200 p-4 space-y-2 bg-white">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold text-[#1B5E99]">{w.code}</span>
                      {showMasterActions && (
                        <div className="flex items-center gap-1">
                          {canWrite && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Edit gudang ${w.name}`}
                              onClick={() => openWarehouseForm(w)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {canDeleteMaster && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Hapus gudang ${w.name}`}
                              onClick={() =>
                                setConfirmDelete({
                                  title: 'Hapus Gudang?',
                                  description: 'Data gudang yang dipilih akan dihapus permanen.',
                                  detail: `${w.code} — ${w.name}`,
                                  onConfirm: async () => {
                                    await erp.deleteWarehouse(w.id);
                                  },
                                })
                              }
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-sm font-semibold text-[#0B1B3A]">{w.name}</div>
                    <p className="text-xs text-slate-500">{w.address}</p>
                    <div className="pt-2 border-t border-slate-100 text-xs text-slate-600">
                      PIC: {w.picName || '-'} · {w.phone || '-'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </TabsContent>

        {/* CATEGORIES & UOMS TAB */}
        <TabsContent value="refs">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-6">
            <Card>
              <div className="p-4 border-b border-slate-100 font-semibold text-sm text-[#0B1B3A]">
                Kategori Produk ({state.categories.length})
              </div>
              <CardContent className="space-y-4">
                {canWrite && (
                  <form
                    className="flex flex-col sm:flex-row gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newCatCode.trim() || !newCatName.trim()) return;
                      void erp.saveCategory({ code: newCatCode, name: newCatName });
                      setNewCatCode('');
                      setNewCatName('');
                    }}
                  >
                    <Input
                      placeholder="Kode (ex: SAF)"
                      value={newCatCode}
                      onChange={(e) => setNewCatCode(e.target.value)}
                      className="w-full sm:w-28"
                    />
                    <Input
                      placeholder="Nama Kategori"
                      value={newCatName}
                      onChange={(e) => setNewCatName(e.target.value)}
                    />
                    <Button type="submit" size="sm" className="w-full sm:w-auto shrink-0">
                      Tambah
                    </Button>
                  </form>
                )}
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                  {state.categories.length === 0 ? (
                    <div className="px-3 py-6 text-center text-xs text-slate-500">
                      Belum ada kategori produk.
                    </div>
                  ) : (
                    state.categories.map((c) => (
                      <div key={c.id} className="px-3 py-2.5 text-xs flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-900">{c.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-slate-500">{c.code}</span>
                          {canDeleteMaster && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Hapus kategori ${c.name}`}
                              onClick={() =>
                                setConfirmDelete({
                                  title: 'Hapus Kategori Produk?',
                                  description: 'Kategori yang dipilih akan dihapus permanen.',
                                  detail: `${c.code} — ${c.name}`,
                                  onConfirm: async () => {
                                    await erp.deleteCategory(c.id);
                                  },
                                })
                              }
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-2">
                <span className="font-semibold text-sm text-[#0B1B3A]">
                  Kategori Supplier ({supplierCategories.length})
                </span>
                <span className="text-[11px] text-slate-500">Dropdown Registrasi Vendor</span>
              </div>
              <CardContent className="space-y-4">
                {canManageSupplierCats && (
                  <form
                    className="flex flex-col sm:flex-row gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const clean = newSupCat.trim();
                      if (!clean || isSavingSupCats) return;
                      if (supplierCategories.some((c) => c.toLowerCase() === clean.toLowerCase())) {
                        return;
                      }
                      setIsSavingSupCats(true);
                      try {
                        const ok = await erp.saveSupplierCategories([...supplierCategories, clean]);
                        if (ok) setNewSupCat('');
                      } finally {
                        setIsSavingSupCats(false);
                      }
                    }}
                  >
                    <Input
                      aria-label="Tambah kategori supplier baru"
                      placeholder="Contoh: Logistik / Ekspedisi"
                      value={newSupCat}
                      maxLength={80}
                      onChange={(e) => setNewSupCat(e.target.value)}
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={isSavingSupCats || !newSupCat.trim()}
                      className="w-full sm:w-auto shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Tambah
                    </Button>
                  </form>
                )}
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                  {supplierCategories.map((cat) => {
                    const isEditing = editingSupCat?.original === cat;
                    const usageCount = state.suppliers.filter(
                      (s) => (s.vendorCategory || '').toLowerCase() === cat.toLowerCase()
                    ).length;
                    return (
                      <div key={cat} className="px-3 py-2.5 text-xs flex items-center justify-between gap-2">
                        {isEditing ? (
                          <div className="flex items-center gap-1.5 flex-1">
                            <Input
                              aria-label={`Edit nama kategori supplier ${cat}`}
                              value={editingSupCat.value}
                              maxLength={80}
                              onChange={(e) =>
                                setEditingSupCat({ original: cat, value: e.target.value })
                              }
                              className="h-8 text-xs"
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="accent"
                              disabled={isSavingSupCats || !editingSupCat.value.trim()}
                              aria-label="Simpan perubahan kategori supplier"
                              onClick={async () => {
                                const trimmed = editingSupCat.value.trim();
                                if (!trimmed) return;
                                setIsSavingSupCats(true);
                                try {
                                  const nextList = supplierCategories.map((item) =>
                                    item === cat ? trimmed : item
                                  );
                                  const ok = await erp.saveSupplierCategories(
                                    nextList,
                                    trimmed !== cat ? { from: cat, to: trimmed } : undefined
                                  );
                                  if (ok) setEditingSupCat(null);
                                } finally {
                                  setIsSavingSupCats(false);
                                }
                              }}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              aria-label="Batal edit kategori supplier"
                              onClick={() => setEditingSupCat(null)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <div className="min-w-0">
                              <span className="font-medium text-slate-900">{cat}</span>
                              {usageCount > 0 && (
                                <span className="ml-2 text-[10px] font-mono text-slate-500">
                                  ({usageCount} vendor)
                                </span>
                              )}
                            </div>
                            {canManageSupplierCats && (
                              <div className="flex items-center gap-1 shrink-0">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  aria-label={`Edit kategori supplier ${cat}`}
                                  onClick={() => setEditingSupCat({ original: cat, value: cat })}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={supplierCategories.length <= 1 || isSavingSupCats}
                                  aria-label={`Hapus kategori supplier ${cat}`}
                                  onClick={() =>
                                    setConfirmDelete({
                                      title: 'Hapus Kategori Supplier?',
                                      description:
                                        usageCount > 0
                                          ? `Kategori ini masih digunakan oleh ${usageCount} supplier. Kategori akan dihapus dari pilihan registrasi baru.`
                                          : 'Kategori akan dihapus dari pilihan registrasi supplier.',
                                      detail: cat,
                                      onConfirm: async () => {
                                        await erp.saveSupplierCategories(
                                          supplierCategories.filter((item) => item !== cat)
                                        );
                                      },
                                    })
                                  }
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50 disabled:opacity-40"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <div className="p-4 border-b border-slate-100 font-semibold text-sm text-[#0B1B3A]">
                Unit of Measure / Satuan ({state.uoms.length})
              </div>
              <CardContent className="space-y-4">
                {canWrite && (
                  <form
                    className="flex flex-col sm:flex-row gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newUomCode.trim() || !newUomName.trim()) return;
                      void erp.saveUom({ code: newUomCode, name: newUomName });
                      setNewUomCode('');
                      setNewUomName('');
                    }}
                  >
                    <Input
                      placeholder="Kode (ex: LTR)"
                      value={newUomCode}
                      onChange={(e) => setNewUomCode(e.target.value)}
                      className="w-full sm:w-28"
                    />
                    <Input
                      placeholder="Nama Satuan"
                      value={newUomName}
                      onChange={(e) => setNewUomName(e.target.value)}
                    />
                    <Button type="submit" size="sm" className="w-full sm:w-auto shrink-0">
                      Tambah
                    </Button>
                  </form>
                )}
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                  {state.uoms.length === 0 ? (
                    <div className="px-3 py-6 text-center text-xs text-slate-500">
                      Belum ada satuan UoM.
                    </div>
                  ) : (
                    state.uoms.map((u) => (
                      <div key={u.id} className="px-3 py-2.5 text-xs flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-slate-900">{u.code}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-600">{u.name}</span>
                          {canDeleteMaster && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Hapus satuan ${u.code}`}
                              onClick={() =>
                                setConfirmDelete({
                                  title: 'Hapus Satuan (UoM)?',
                                  description: 'Satuan UoM yang dipilih akan dihapus permanen.',
                                  detail: `${u.code} — ${u.name}`,
                                  onConfirm: async () => {
                                    await erp.deleteUom(u.id);
                                  },
                                })
                              }
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* USER & ROLE MANAGEMENT TAB */}
        <TabsContent value="users" className="space-y-3">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-[#0B1B3A]">
                Manajemen User &amp; Assign Role RBAC ({state.users.length})
              </div>
              <p className="text-xs text-slate-500">
                {canManageUsers || currentUser?.role === 'Manager'
                  ? 'Tambahkan email Google karyawan dan tentukan role aksesnya. Pengguna otomatis memperoleh role tersebut saat masuk.'
                  : 'Anda melihat profil akun Anda sendiri. Daftar seluruh user & pengaturan role hanya dapat diakses oleh Direktur atau Manager.'}
              </p>
            </div>
            {canManageUsers && (
              <Button type="button" size="sm" onClick={() => openUserForm()} className="w-full sm:w-auto shrink-0">
                <UserPlus className="h-4 w-4" />
                Tambah User
              </Button>
            )}
          </div>

          {/* Mobile User Cards */}
          <div className="space-y-3 md:hidden">
            {filteredUsers.map((u) => {
              const isSelf = currentUser?.uid === u.uid;
              return (
                <Card key={`m_usr_${u.uid}`}>
                  <CardContent className="p-4 space-y-3 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-[#0B1B3A] truncate">
                          {u.displayName}
                          {isSelf && (
                            <span className="ml-1.5 text-[10px] font-semibold text-[#1B5E99]">
                              (Akun Anda)
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">{u.email}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Dept: {u.department || '-'}
                        </div>
                      </div>
                      {canManageUsers && !isSelf ? (
                        <button
                          type="button"
                          onClick={() => void erp.updateUserRole(u.uid, u.role, !u.active)}
                          className="cursor-pointer shrink-0"
                        >
                          <StatusLabel
                            status={u.active ? 'Aktif' : 'Nonaktif'}
                            tone={u.active ? 'success' : 'neutral'}
                          />
                        </button>
                      ) : (
                        <StatusLabel
                          status={u.active ? 'Aktif' : 'Nonaktif'}
                          tone={u.active ? 'success' : 'neutral'}
                        />
                      )}
                    </div>

                    {canManageUsers ? (
                      <div className="space-y-1">
                        <Label className="text-[11px] text-slate-500">Role RBAC</Label>
                        <NativeSelect
                          aria-label={`Ubah role mobile untuk ${u.displayName}`}
                          value={u.role}
                          disabled={isSelf}
                          onChange={(e) =>
                            void erp.updateUserRole(u.uid, e.target.value as UserRole, u.active)
                          }
                        >
                          {ALL_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </NativeSelect>
                      </div>
                    ) : (
                      <StatusLabel status={u.role} tone="info" />
                    )}

                    {canManageUsers && (
                      <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => openUserForm(u)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit User
                        </Button>
                        {!isSelf && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setConfirmDelete({
                                title: 'Hapus Akun Pengguna?',
                                description: 'Akses pengguna ini akan dihapus permanen dari sistem ERP.',
                                detail: `${u.displayName} (${u.email}) — ${u.role}`,
                                onConfirm: async () => {
                                  await erp.deleteUserAccount(u.uid);
                                },
                              })
                            }
                            className="text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Hapus
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Desktop User Table */}
          <Card className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Nama &amp; Email</th>
                    <th className="py-3 px-3 font-semibold">Departemen</th>
                    <th className="py-3 px-3 font-semibold">Role</th>
                    <th className="py-3 px-3 font-semibold">Status</th>
                    {canManageUsers && <th className="py-3 px-4 font-semibold text-right">Aksi</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredUsers.map((u) => {
                    const isSelf = currentUser?.uid === u.uid;
                    return (
                      <tr key={u.uid} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-900">
                            {u.displayName}
                            {isSelf && (
                              <span className="ml-2 text-[10px] font-semibold text-[#1B5E99]">
                                (Akun Anda)
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500">{u.email}</div>
                        </td>
                        <td className="py-3 px-3 text-slate-600">{u.department || '-'}</td>
                        <td className="py-3 px-3">
                          {canManageUsers ? (
                            <NativeSelect
                              aria-label={`Ubah role untuk ${u.displayName}`}
                              value={u.role}
                              disabled={isSelf}
                              onChange={(e) =>
                                void erp.updateUserRole(u.uid, e.target.value as UserRole, u.active)
                              }
                              className="min-h-[34px] h-9 w-44 text-xs"
                            >
                              {ALL_ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </NativeSelect>
                          ) : (
                            <StatusLabel status={u.role} tone="info" />
                          )}
                        </td>
                        <td className="py-3 px-3">
                          {canManageUsers && !isSelf ? (
                            <button
                              type="button"
                              aria-label={`Toggle status aktif untuk ${u.displayName}`}
                              onClick={() => void erp.updateUserRole(u.uid, u.role, !u.active)}
                              className="cursor-pointer"
                              title="Klik untuk ubah status aktif/nonaktif"
                            >
                              <StatusLabel
                                status={u.active ? 'Aktif' : 'Nonaktif'}
                                tone={u.active ? 'success' : 'neutral'}
                              />
                            </button>
                          ) : (
                            <StatusLabel
                              status={u.active ? 'Aktif' : 'Nonaktif'}
                              tone={u.active ? 'success' : 'neutral'}
                            />
                          )}
                        </td>
                        {canManageUsers && (
                          <td className="py-3 px-4 text-right space-x-1 whitespace-nowrap">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Edit user ${u.displayName}`}
                              onClick={() => openUserForm(u)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            {!isSelf && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                aria-label={`Hapus user ${u.displayName}`}
                                onClick={() =>
                                  setConfirmDelete({
                                    title: 'Hapus Akun Pengguna?',
                                    description: 'Akses pengguna ini akan dihapus permanen dari sistem ERP.',
                                    detail: `${u.displayName} (${u.email}) — ${u.role}`,
                                    onConfirm: async () => {
                                      await erp.deleteUserAccount(u.uid);
                                    },
                                  })
                                }
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* PRODUCT MODAL */}
      <Dialog open={productModalOpen} onOpenChange={setProductModalOpen}>
        <DialogContent size="lg" structured>
          <DialogHeader structured>
            <DialogTitle>{editingProduct ? 'Edit Produk / Layanan' : 'Tambah Produk / Layanan Baru'}</DialogTitle>
            <DialogDescription>
              Lengkapi tipe item, kode SKU, harga beli/jual, stok minimum, dan foto produk.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col flex-1 min-h-0"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!pSku.trim() || !pName.trim()) return;
              const defaultStocks: Record<string, number> = {};
              if (!pIsService) {
                state.warehouses.forEach((w) => {
                  defaultStocks[w.id] = editingProduct?.warehouseStocks[w.id] ?? 0;
                });
              }
              await erp.saveProduct({
                isNew: !editingProduct,
                id: editingProduct?.id || '',
                sku: pSku,
                name: pName,
                categoryId: pCatId,
                uomCode: pUom,
                currency: pCurr,
                buyPrice: Number(pBuy),
                sellPrice: Number(pSell),
                minStock: pIsService ? 0 : Number(pMin),
                maxStock: pIsService ? 0 : Number(pMax),
                isService: pIsService,
                description: pDesc,
                imageUrl: editingProduct?.imageUrl,
                warehouseStocks: defaultStocks,
                active: true,
                photoFile: pPhotoFile,
              });
              setProductModalOpen(false);
            }}
          >
            <DialogBody>
              {/* Tipe Item Segmented Switch */}
              <div className="space-y-2">
                <Label htmlFor="prd-type">Tipe Item</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setPIsService(false)}
                    className={`text-left rounded-xl border px-3.5 py-2.5 transition cursor-pointer ${
                      !pIsService
                        ? 'border-[#1B5E99] bg-[#EBF3FA]/70 ring-1 ring-[#1B5E99]/20'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-xs font-semibold text-[#0B1B3A]">Barang Stok (Inventory)</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Menambah &amp; mengurangi stok gudang
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPIsService(true);
                      setPMin('0');
                      setPMax('0');
                    }}
                    className={`text-left rounded-xl border px-3.5 py-2.5 transition cursor-pointer ${
                      pIsService
                        ? 'border-[#1B5E99] bg-[#EBF3FA]/70 ring-1 ring-[#1B5E99]/20'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-xs font-semibold text-[#0B1B3A]">Service / Non-Stok</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Ongkir, jasa packing, instalasi — masuk Beban Operasional
                    </div>
                  </button>
                </div>
                <NativeSelect
                  id="prd-type"
                  className="sr-only"
                  aria-label="Tipe Item"
                  value={pIsService ? 'service' : 'stock'}
                  onChange={(e) => {
                    const nextIsService = e.target.value === 'service';
                    setPIsService(nextIsService);
                    if (nextIsService) {
                      setPMin('0');
                      setPMax('0');
                    }
                  }}
                >
                  <option value="stock">Barang Stok (Inventory — Memengaruhi Stok Gudang)</option>
                  <option value="service">Service / Non-Stok (Ongkir, Packing, Jasa — Tidak Masuk Stok)</option>
                </NativeSelect>
              </div>

              <div className="border-t border-slate-100 pt-5 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="prd-sku">Kode SKU *</Label>
                  <Input id="prd-sku" required value={pSku} onChange={(e) => setPSku(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prd-name">{pIsService ? 'Nama Layanan / Jasa *' : 'Nama Produk *'}</Label>
                  <Input id="prd-name" required value={pName} onChange={(e) => setPName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prd-cat">Kategori</Label>
                  <NativeSelect id="prd-cat" value={pCatId} onChange={(e) => setPCatId(e.target.value)}>
                    {state.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prd-uom">Satuan (UoM)</Label>
                  <NativeSelect id="prd-uom" value={pUom} onChange={(e) => setPUom(e.target.value)}>
                    {state.uoms.map((u) => (
                      <option key={u.id} value={u.code}>
                        {u.code} — {u.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prd-curr">Mata Uang</Label>
                  <NativeSelect
                    id="prd-curr"
                    value={pCurr}
                    onChange={(e) => setPCurr(e.target.value as CurrencyCode)}
                  >
                    <option value="IDR">IDR</option>
                    <option value="USD">USD</option>
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prd-buy">Harga Beli</Label>
                  <Input
                    id="prd-buy"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={pBuy}
                    onChange={(e) => setPBuy(sanitizeDigits(e.target.value))}
                    className="font-mono tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prd-sell">Harga Jual</Label>
                  <Input
                    id="prd-sell"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={pSell}
                    onChange={(e) => setPSell(sanitizeDigits(e.target.value))}
                    className="font-mono tabular-nums"
                  />
                </div>
                {!pIsService && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="prd-min">Stok Min</Label>
                      <Input
                        id="prd-min"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={pMin}
                        onChange={(e) => setPMin(sanitizeDigits(e.target.value))}
                        className="font-mono tabular-nums"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="prd-max">Stok Maks</Label>
                      <Input
                        id="prd-max"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={pMax}
                        onChange={(e) => setPMax(sanitizeDigits(e.target.value))}
                        className="font-mono tabular-nums"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 pt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="prd-desc">Deskripsi</Label>
                  <Textarea
                    id="prd-desc"
                    rows={3}
                    value={pDesc}
                    onChange={(e) => setPDesc(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prd-photo">Foto Produk (Opsional)</Label>
                  <label
                    htmlFor="prd-photo"
                    className="flex items-center gap-2.5 border border-dashed border-slate-300 rounded-lg p-3.5 text-xs text-slate-600 cursor-pointer hover:bg-slate-50 min-h-[82px]"
                  >
                    <Upload className="h-4 w-4 text-[#1B5E99] shrink-0" />
                    <span className="truncate">
                      {pPhotoFile ? pPhotoFile.name : 'Pilih file gambar (.jpg, .png)'}
                    </span>
                    <input
                      id="prd-photo"
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => setPPhotoFile(e.target.files?.[0] || null)}
                    />
                  </label>
                </div>
              </div>
            </DialogBody>

            <DialogFooter className="sm:justify-end">
              <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 w-full sm:w-auto sm:ml-auto">
                <Button type="button" variant="outline" onClick={() => setProductModalOpen(false)}>
                  Batal
                </Button>
                <Button type="submit" variant="accent">
                  Simpan Produk
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* SUPPLIER REGISTRATION MODAL */}
      <Dialog open={supplierModalOpen} onOpenChange={setSupplierModalOpen}>
        <DialogContent size="xl" structured>
          <DialogHeader structured>
            <DialogTitle>
              {editingSupplier ? 'Edit Data Supplier' : 'Form Registrasi Supplier Baru'}
            </DialogTitle>
            <DialogDescription>
              Lengkapi identitas perusahaan, kategori vendor, legalitas NIB/NPWP, rekening bank, dan syarat pembayaran.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col flex-1 min-h-0"
            onSubmit={async (e) => {
              e.preventDefault();
              setIsSavingSupplier(true);
              try {
                const ok = await erp.saveSupplier({
                  isNew: !editingSupplier,
                  id: editingSupplier?.id || '',
                  code: sCode,
                  name: sName,
                  vendorCategory: sCategory,
                  nib: sNib,
                  npwp: sNpwp,
                  taxStatus: sTaxStatus,
                  address: sAddress,
                  contactPerson: sPic,
                  phone: sPhone,
                  email: sEmail,
                  bankName: sBank,
                  bankAccount: sAccount,
                  paymentScheme: sPaymentScheme,
                  paymentTermDays: resolveSupplierTermDays(sPaymentScheme, Number(sTerm)),
                  defaultCurrency: sCurr,
                  verificationStatus: sVerificationStatus,
                  active: sVerificationStatus !== 'Blacklisted',
                });
                if (ok) {
                  setSupplierModalOpen(false);
                }
              } finally {
                setIsSavingSupplier(false);
              }
            }}
          >
            <DialogBody>
              {!canApprovePartner && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                  Status awal pendaftaran supplier oleh Staff Purchasing/Manager adalah <strong>Pending</strong>. Transaksi tempo (TOP) atau nilai besar (&gt; Rp 10 jt) memerlukan klik <strong>Approve (Verified)</strong> dari role Admin.
                </div>
              )}

              {/* Section 1: Identitas & Legalitas */}
              <div className="space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Identitas &amp; Legalitas Perusahaan
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="sup-code">Kode Supplier *</Label>
                    <Input id="sup-code" required value={sCode} onChange={(e) => setSCode(e.target.value)} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="sup-name">Nama PT / CV *</Label>
                    <Input
                      id="sup-name"
                      required
                      placeholder="Contoh: PT Baja Perkasa Industri"
                      value={sName}
                      onChange={(e) => setSName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sup-cat">Kategori Vendor</Label>
                    <NativeSelect
                      id="sup-cat"
                      value={sCategory}
                      onChange={(e) => setSCategory(e.target.value as SupplierCategory)}
                    >
                      {(sCategory && !supplierCategories.includes(sCategory)
                        ? [...supplierCategories, sCategory]
                        : supplierCategories
                      ).map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sup-tax">Status Pajak</Label>
                    <NativeSelect
                      id="sup-tax"
                      value={sTaxStatus}
                      onChange={(e) => setSTaxStatus(e.target.value as TaxPkpStatus)}
                    >
                      {TAX_PKP_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sup-curr">Currency Default</Label>
                    <NativeSelect
                      id="sup-curr"
                      value={sCurr}
                      onChange={(e) => setSCurr(e.target.value as CurrencyCode)}
                    >
                      <option value="IDR">IDR</option>
                      <option value="USD">USD</option>
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sup-nib">Nomor NIB</Label>
                    <Input id="sup-nib" placeholder="13 digit NIB" value={sNib} onChange={(e) => setSNib(e.target.value)} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="sup-npwp">Nomor NPWP</Label>
                    <Input
                      id="sup-npwp"
                      placeholder="XX.XXX.XXX.X-XXX.XXX"
                      value={sNpwp}
                      onChange={(e) => setSNpwp(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Alamat & Kontak PIC */}
              <div className="border-t border-slate-100 pt-5 space-y-3.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Alamat &amp; Kontak PIC
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sup-addr">Alamat Perusahaan</Label>
                  <Textarea id="sup-addr" rows={2} value={sAddress} onChange={(e) => setSAddress(e.target.value)} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="sup-pic">Kontak PIC</Label>
                    <Input id="sup-pic" value={sPic} onChange={(e) => setSPic(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sup-phone">Telepon / WhatsApp</Label>
                    <Input id="sup-phone" type="tel" value={sPhone} onChange={(e) => setSPhone(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sup-email">Email</Label>
                    <Input id="sup-email" type="email" value={sEmail} onChange={(e) => setSEmail(e.target.value)} />
                  </div>
                </div>
              </div>

              {/* Section 3: Rekening Bank & Syarat Pembayaran */}
              <div className="border-t border-slate-100 pt-5 space-y-3.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Rekening Bank &amp; Syarat Pembayaran
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="sup-bank">Nama Bank</Label>
                    <Input id="sup-bank" placeholder="Contoh: Bank Mandiri" value={sBank} onChange={(e) => setSBank(e.target.value)} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="sup-acc">Nomor Rekening &amp; Atas Nama</Label>
                    <Input
                      id="sup-acc"
                      placeholder="Contoh: 1200099118822 a.n PT ..."
                      value={sAccount}
                      onChange={(e) => setSAccount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sup-scheme">Syarat Pembayaran</Label>
                    <NativeSelect
                      id="sup-scheme"
                      value={sPaymentScheme}
                      onChange={(e) => {
                        const next = e.target.value as SupplierPaymentScheme;
                        setSPaymentScheme(next);
                        if (next === 'CBD' || next === 'COD') setSTerm('0');
                        else if (Number(sTerm) <= 0) setSTerm('30');
                      }}
                    >
                      {SUPPLIER_PAYMENT_SCHEMES.map((sc) => (
                        <option key={sc} value={sc}>
                          {sc} {sc === 'TOP' ? '(Tempo)' : sc === 'CBD' ? '(Cash Before Delivery)' : '(Cash On Delivery)'}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  {sPaymentScheme === 'TOP' ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="sup-term">Term Tempo (Hari)</Label>
                      <Input
                        id="sup-term"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={sTerm}
                        onChange={(e) => setSTerm(sanitizeDigits(e.target.value))}
                      />
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <Label>Term Tempo</Label>
                      <div className="h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 flex items-center text-xs text-slate-600">
                        0 Hari ({sPaymentScheme})
                      </div>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="sup-verify">Status Verifikasi</Label>
                    {canApprovePartner ? (
                      <NativeSelect
                        id="sup-verify"
                        value={sVerificationStatus}
                        onChange={(e) => setSVerificationStatus(e.target.value as PartnerVerificationStatus)}
                      >
                        <option value="Pending">Pending</option>
                        <option value="Verified">Verified (Disetujui Admin)</option>
                        <option value="Blacklisted">Blacklisted</option>
                      </NativeSelect>
                    ) : (
                      <div className="h-10 rounded-lg border border-amber-200 bg-amber-50 px-3 flex items-center text-xs font-semibold text-amber-800">
                        {sVerificationStatus} (Dikontrol Admin)
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </DialogBody>

            <DialogFooter className="sm:justify-end">
              <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 w-full sm:w-auto sm:ml-auto">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSavingSupplier}
                  onClick={() => setSupplierModalOpen(false)}
                >
                  Batal
                </Button>
                <Button type="submit" variant="accent" disabled={isSavingSupplier}>
                  {isSavingSupplier ? 'Menyimpan...' : 'Simpan Registrasi Supplier'}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* BUYER (CUSTOMER) REGISTRATION MODAL */}
      <Dialog open={customerModalOpen} onOpenChange={setCustomerModalOpen}>
        <DialogContent size="xl" structured>
          <DialogHeader structured>
            <DialogTitle>
              {editingCustomer ? 'Edit Data Buyer (Klien)' : 'Form Registrasi Buyer (Klien) Baru'}
            </DialogTitle>
            <DialogDescription>
              Lengkapi alamat penagihan, alamat pengiriman, kontak PIC (Purchasing, Gudang, Finance), serta pengajuan skema bayar.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col flex-1 min-h-0"
            onSubmit={async (e) => {
              e.preventDefault();
              setIsSavingCustomer(true);
              try {
                const ok = await erp.saveCustomer({
                  isNew: !editingCustomer,
                  id: editingCustomer?.id || '',
                  code: cCode,
                  name: cName,
                  nib: cNib,
                  npwp: cNpwp,
                  taxStatus: cTaxStatus,
                  address: cBillingAddress,
                  billingAddress: cBillingAddress,
                  shippingAddress: cShippingAddress || cBillingAddress,
                  contactPerson: cPicPurchasingName,
                  phone: cPicPurchasingPhone,
                  email: cEmail,
                  picPurchasingName: cPicPurchasingName,
                  picPurchasingPhone: cPicPurchasingPhone,
                  picWarehouseName: cPicWarehouseName,
                  picWarehousePhone: cPicWarehousePhone,
                  picFinanceName: cPicFinanceName,
                  picFinancePhone: cPicFinancePhone,
                  paymentScheme: cPaymentScheme,
                  creditLimit: canApprovePartner ? Number(cLimit) || 0 : editingCustomer?.creditLimit ?? 0,
                  paymentTermDays: resolveBuyerTermDays(cPaymentScheme),
                  verificationStatus: cVerificationStatus,
                  active: cVerificationStatus !== 'Blacklisted',
                });
                if (ok) {
                  setCustomerModalOpen(false);
                }
              } finally {
                setIsSavingCustomer(false);
              }
            }}
          >
            <DialogBody>
              {/* Section 1: Identitas & Skema Bayar */}
              <div className="space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Identitas Perusahaan &amp; Skema Pembayaran
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="cus-code">Kode Buyer *</Label>
                    <Input id="cus-code" required value={cCode} onChange={(e) => setCCode(e.target.value)} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="cus-name">Nama Perusahaan Buyer *</Label>
                    <Input
                      id="cus-name"
                      required
                      placeholder="Contoh: PT Nusantara Manufaktur"
                      value={cName}
                      onChange={(e) => setCName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cus-scheme">Pengajuan Skema Bayar</Label>
                    <NativeSelect
                      id="cus-scheme"
                      value={cPaymentScheme}
                      onChange={(e) => setCPaymentScheme(e.target.value as BuyerPaymentScheme)}
                    >
                      {BUYER_PAYMENT_SCHEMES.map((sc) => (
                        <option key={sc} value={sc}>
                          {sc} {sc === 'CBD' ? '(Cash Before Delivery)' : '(Tempo)'}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cus-pkp">Status PKP</Label>
                    <NativeSelect
                      id="cus-pkp"
                      value={cTaxStatus}
                      onChange={(e) => setCTaxStatus(e.target.value as TaxPkpStatus)}
                    >
                      {TAX_PKP_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cus-email">Email Perusahaan</Label>
                    <Input id="cus-email" type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cus-nib">
                      Nomor NIB {cPaymentScheme !== 'CBD' && <span className="text-red-600">* (Wajib TOP)</span>}
                    </Label>
                    <Input
                      id="cus-nib"
                      required={cPaymentScheme !== 'CBD'}
                      placeholder="13 digit NIB"
                      value={cNib}
                      onChange={(e) => setCNib(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="cus-npwp">
                      Nomor NPWP {cPaymentScheme !== 'CBD' && <span className="text-red-600">* (Wajib TOP)</span>}
                    </Label>
                    <Input
                      id="cus-npwp"
                      required={cPaymentScheme !== 'CBD'}
                      placeholder="XX.XXX.XXX.X-XXX.XXX"
                      value={cNpwp}
                      onChange={(e) => setCNpwp(e.target.value)}
                    />
                  </div>
                </div>

                {cPaymentScheme !== 'CBD' && (
                  <div className="rounded-lg border border-[#BFD9EF] bg-[#EBF3FA]/60 px-3.5 py-2.5 text-xs text-[#0B1B3A] space-y-1">
                    <div className="font-semibold flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-[#1B5E99]" />
                      Ketentuan Pengajuan Skema Tempo ({cPaymentScheme})
                    </div>
                    <p className="text-[11px] text-slate-700">
                      Buyer skema tempo (TOP) wajib mengisi NIB &amp; NPWP. Persetujuan <strong>Credit Limit</strong> dilakukan oleh role <strong>Admin (Direktur)</strong> sebelum transaksi diproses.
                    </p>
                  </div>
                )}
              </div>

              {/* Section 2: Alamat */}
              <div className="border-t border-slate-100 pt-5 space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Alamat Tagihan &amp; Pengiriman
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="cus-bill-addr">Alamat Tagihan (Billing) *</Label>
                    <Textarea
                      id="cus-bill-addr"
                      required
                      rows={2}
                      value={cBillingAddress}
                      onChange={(e) => setCBillingAddress(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="cus-ship-addr">Alamat Kirim (Gudang) *</Label>
                      <button
                        type="button"
                        onClick={() => setCShippingAddress(cBillingAddress)}
                        className="text-[11px] font-semibold text-[#1B5E99] hover:underline cursor-pointer"
                      >
                        Samakan alamat tagihan
                      </button>
                    </div>
                    <Textarea
                      id="cus-ship-addr"
                      required
                      rows={2}
                      value={cShippingAddress}
                      onChange={(e) => setCShippingAddress(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Section 3: Kontak PIC */}
              <div className="border-t border-slate-100 pt-5 space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Kontak PIC Buyer (Purchasing, Gudang &amp; Finance)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-[#1B5E99]">PIC Purchasing</div>
                    <Input
                      aria-label="Nama PIC Purchasing"
                      placeholder="Nama PIC Purchasing"
                      value={cPicPurchasingName}
                      onChange={(e) => setCPicPurchasingName(e.target.value)}
                    />
                    <Input
                      aria-label="Telepon PIC Purchasing"
                      type="tel"
                      placeholder="No. Telp / WA Purchasing"
                      value={cPicPurchasingPhone}
                      onChange={(e) => setCPicPurchasingPhone(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-[#1B5E99]">PIC Gudang (Surat Jalan)</div>
                    <Input
                      aria-label="Nama PIC Gudang"
                      placeholder="Nama PIC Gudang / Penerima"
                      value={cPicWarehouseName}
                      onChange={(e) => setCPicWarehouseName(e.target.value)}
                    />
                    <Input
                      aria-label="Telepon PIC Gudang"
                      type="tel"
                      placeholder="No. Telp / WA Lapangan"
                      value={cPicWarehousePhone}
                      onChange={(e) => setCPicWarehousePhone(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-[#1B5E99]">PIC Finance (Penagihan)</div>
                    <Input
                      aria-label="Nama PIC Finance"
                      placeholder="Nama PIC Finance / AP"
                      value={cPicFinanceName}
                      onChange={(e) => setCPicFinanceName(e.target.value)}
                    />
                    <Input
                      aria-label="Telepon PIC Finance"
                      type="tel"
                      placeholder="No. Telp / WA Finance"
                      value={cPicFinancePhone}
                      onChange={(e) => setCPicFinancePhone(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Section 4: Credit Limit & Verifikasi */}
              <div className="border-t border-slate-100 pt-5 space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Limit Kredit &amp; Verifikasi Admin
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="cus-limit" className="flex items-center gap-1.5">
                      Credit Limit (IDR)
                      {!canApprovePartner && <Lock className="h-3.5 w-3.5 text-amber-700" />}
                    </Label>
                    {canApprovePartner ? (
                      <Input
                        id="cus-limit"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={cLimit}
                        onChange={(e) => setCLimit(sanitizeDigits(e.target.value))}
                        className="font-mono tabular-nums"
                      />
                    ) : (
                      <div
                        id="cus-limit-locked"
                        className="h-10 rounded-lg border border-amber-200 bg-amber-50 px-3 flex items-center justify-between text-xs text-amber-900"
                      >
                        <span className="font-mono font-semibold">
                          {formatCurrency(editingCustomer?.creditLimit ?? 0, 'IDR')}
                        </span>
                        <span className="text-[11px]">Diisi &amp; disetujui oleh Admin</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="cus-verify">Status Verifikasi</Label>
                    {canApprovePartner ? (
                      <NativeSelect
                        id="cus-verify"
                        value={cVerificationStatus}
                        onChange={(e) => setCVerificationStatus(e.target.value as PartnerVerificationStatus)}
                      >
                        <option value="Pending">Pending</option>
                        <option value="Verified">Verified (Disetujui Admin)</option>
                        <option value="Blacklisted">Blacklisted</option>
                      </NativeSelect>
                    ) : (
                      <div className="h-10 rounded-lg border border-amber-200 bg-amber-50 px-3 flex items-center text-xs font-semibold text-amber-800">
                        {cVerificationStatus} (Menunggu Approve Admin)
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </DialogBody>

            <DialogFooter className="sm:justify-end">
              <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 w-full sm:w-auto sm:ml-auto">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSavingCustomer}
                  onClick={() => setCustomerModalOpen(false)}
                >
                  Batal
                </Button>
                <Button type="submit" variant="accent" disabled={isSavingCustomer}>
                  {isSavingCustomer ? 'Menyimpan...' : 'Simpan Registrasi Buyer'}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ADMIN APPROVE & CREDIT LIMIT BUYER MODAL */}
      <Dialog
        open={!!approveBuyerModalCustomer}
        onOpenChange={(open) => !open && setApproveBuyerModalCustomer(null)}
      >
        <DialogContent size="md" structured>
          <DialogHeader structured>
            <DialogTitle>Persetujuan Admin &amp; Credit Limit Buyer</DialogTitle>
            <DialogDescription>
              Khusus Role Admin (Direktur) untuk menyetujui (Verified) / memblokir Buyer dan menetapkan Credit Limit skema TOP.
            </DialogDescription>
          </DialogHeader>
          {approveBuyerModalCustomer && (
            <form
              className="flex flex-col flex-1 min-h-0"
              onSubmit={async (e) => {
                e.preventDefault();
                setIsApprovingBuyer(true);
                try {
                  const ok = await erp.approveBuyerWithCreditLimit(approveBuyerModalCustomer.id, {
                    verificationStatus: approveBuyerStatus,
                    creditLimit: Number(approveBuyerCreditLimit) || 0,
                  });
                  if (ok) {
                    setApproveBuyerModalCustomer(null);
                  }
                } finally {
                  setIsApprovingBuyer(false);
                }
              }}
            >
              <DialogBody>
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 text-xs space-y-1">
                  <div className="font-semibold text-[#0B1B3A] text-sm">
                    {approveBuyerModalCustomer.name}
                  </div>
                  <div className="font-mono text-slate-500">
                    {approveBuyerModalCustomer.code} · Skema:{' '}
                    <strong className="text-[#0B1B3A]">
                      {approveBuyerModalCustomer.paymentScheme ||
                        `NET ${approveBuyerModalCustomer.paymentTermDays} Hari`}
                    </strong>
                  </div>
                  <div className="font-mono text-slate-600">
                    NIB: {approveBuyerModalCustomer.nib || '-'} · NPWP: {approveBuyerModalCustomer.npwp || '-'}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="adm-buyer-status">Status Verifikasi Admin</Label>
                  <NativeSelect
                    id="adm-buyer-status"
                    value={approveBuyerStatus}
                    onChange={(e) => setApproveBuyerStatus(e.target.value as PartnerVerificationStatus)}
                  >
                    <option value="Verified">Verified (Disetujui untuk Transaksi)</option>
                    <option value="Pending">Pending (Tahan Transaksi Tempo)</option>
                    <option value="Blacklisted">Blacklisted (Blokir Total)</option>
                  </NativeSelect>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="adm-buyer-limit">Credit Limit Disetujui (IDR)</Label>
                  <Input
                    id="adm-buyer-limit"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={approveBuyerCreditLimit}
                    onChange={(e) => setApproveBuyerCreditLimit(sanitizeDigits(e.target.value))}
                    className="font-mono tabular-nums"
                  />
                  <p className="text-[11px] text-slate-500">
                    Preview:{' '}
                    <strong className="text-[#0B1B3A] font-mono">
                      {formatCurrency(Number(approveBuyerCreditLimit) || 0, 'IDR')}
                    </strong>
                  </p>
                </div>
              </DialogBody>

              <DialogFooter className="sm:justify-end">
                <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 w-full sm:w-auto sm:ml-auto">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isApprovingBuyer}
                    onClick={() => setApproveBuyerModalCustomer(null)}
                  >
                    Batal
                  </Button>
                  <Button type="submit" variant="accent" disabled={isApprovingBuyer}>
                    <ShieldCheck className="h-4 w-4" />
                    {isApprovingBuyer ? 'Menyimpan...' : 'Simpan Keputusan Admin'}
                  </Button>
                </div>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* WAREHOUSE MODAL */}
      <Dialog open={warehouseModalOpen} onOpenChange={setWarehouseModalOpen}>
        <DialogContent size="md" structured>
          <DialogHeader structured>
            <DialogTitle>{editingWarehouse ? 'Edit Gudang' : 'Tambah Gudang Baru'}</DialogTitle>
            <DialogDescription>
              Atur kode gudang, nama lokasi, PIC gudang, dan alamat lengkap.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col flex-1 min-h-0"
            onSubmit={async (e) => {
              e.preventDefault();
              await erp.saveWarehouse({
                isNew: !editingWarehouse,
                id: editingWarehouse?.id || '',
                code: wCode,
                name: wName,
                address: wAddress,
                picName: wPic,
                phone: wPhone,
                active: true,
              });
              setWarehouseModalOpen(false);
            }}
          >
            <DialogBody>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="wh-code">Kode Gudang *</Label>
                  <Input id="wh-code" required value={wCode} onChange={(e) => setWCode(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wh-name">Nama Gudang *</Label>
                  <Input id="wh-name" required value={wName} onChange={(e) => setWName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wh-pic">PIC Gudang</Label>
                  <Input id="wh-pic" value={wPic} onChange={(e) => setWPic(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wh-phone">Telepon</Label>
                  <Input id="wh-phone" type="tel" value={wPhone} onChange={(e) => setWPhone(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wh-addr">Alamat Lengkap</Label>
                <Textarea id="wh-addr" rows={3} value={wAddress} onChange={(e) => setWAddress(e.target.value)} />
              </div>
            </DialogBody>

            <DialogFooter className="sm:justify-end">
              <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 w-full sm:w-auto sm:ml-auto">
                <Button type="button" variant="outline" onClick={() => setWarehouseModalOpen(false)}>
                  Batal
                </Button>
                <Button type="submit" variant="accent">
                  Simpan Gudang
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* USER MODAL */}
      <Dialog open={userModalOpen} onOpenChange={setUserModalOpen}>
        <DialogContent size="md" structured>
          <DialogHeader structured>
            <DialogTitle>{editingUser ? 'Edit Pengguna' : 'Tambah User Baru'}</DialogTitle>
            <DialogDescription>
              Daftarkan akun Google karyawan beserta departemen dan hak akses RBAC.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col flex-1 min-h-0"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await erp.saveUserAccount({
                isNew: !editingUser,
                uid: editingUser?.uid,
                displayName: uDisplayName,
                email: uEmail,
                department: uDepartment,
                role: uRole,
                active: uActive,
              });
              if (ok) {
                setUserModalOpen(false);
              }
            }}
          >
            <DialogBody>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="usr-name">Nama Lengkap *</Label>
                  <Input
                    id="usr-name"
                    required
                    placeholder="Contoh: Budi Santoso"
                    value={uDisplayName}
                    onChange={(e) => setUDisplayName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="usr-email">Email Google *</Label>
                  <Input
                    id="usr-email"
                    type="email"
                    required
                    disabled={Boolean(editingUser)}
                    placeholder="nama@domestiqhub.com"
                    value={uEmail}
                    onChange={(e) => setUEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="usr-dept">Departemen</Label>
                  <Input
                    id="usr-dept"
                    placeholder="Contoh: Procurement / Warehouse"
                    value={uDepartment}
                    onChange={(e) => setUDepartment(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="usr-role">Role RBAC</Label>
                  <NativeSelect
                    id="usr-role"
                    value={uRole}
                    disabled={editingUser?.uid === currentUser?.uid}
                    onChange={(e) => setURole(e.target.value as UserRole)}
                  >
                    {ALL_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>
              <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5">
                {getRoleDescription(uRole)}
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="usr-active">Status Akun</Label>
                <NativeSelect
                  id="usr-active"
                  value={uActive ? 'true' : 'false'}
                  disabled={editingUser?.uid === currentUser?.uid}
                  onChange={(e) => setUActive(e.target.value === 'true')}
                >
                  <option value="true">Aktif</option>
                  <option value="false">Nonaktif</option>
                </NativeSelect>
              </div>
            </DialogBody>

            <DialogFooter className="sm:justify-end">
              <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 w-full sm:w-auto sm:ml-auto">
                <Button type="button" variant="outline" onClick={() => setUserModalOpen(false)}>
                  Batal
                </Button>
                <Button type="submit" variant="accent">
                  Simpan User
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* CONFIRM CLEAR DUMMY DATA MODAL */}
      <Dialog open={confirmDummyOpen} onOpenChange={setConfirmDummyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus Semua Data Dummy Master?</DialogTitle>
            <DialogDescription>
              Tindakan ini hanya menghapus data bawaan/dummy sistem. Data produk, supplier, customer, atau gudang baru yang Anda buat sendiri tetap aman dan tidak terhapus.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-1.5">
            <div className="font-semibold text-slate-900">
              Total data dummy yang akan dihapus: {dummyTargets.totalCount} entri
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
              <div>Produk: <span className="font-mono font-semibold">{dummyTargets.productIds.length}</span></div>
              <div>Supplier: <span className="font-mono font-semibold">{dummyTargets.supplierIds.length}</span></div>
              <div>Customer: <span className="font-mono font-semibold">{dummyTargets.customerIds.length}</span></div>
              <div>Gudang: <span className="font-mono font-semibold">{dummyTargets.warehouseIds.length}</span></div>
              <div>Kategori: <span className="font-mono font-semibold">{dummyTargets.categoryIds.length}</span></div>
              <div>Satuan: <span className="font-mono font-semibold">{dummyTargets.uomIds.length}</span></div>
            </div>
            <p className="text-[11px] text-slate-500 pt-1">
              Data dummy yang sudah dihapus tidak akan muncul kembali saat Anda login berikutnya.
            </p>
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={isClearingDummy}
              onClick={() => setConfirmDummyOpen(false)}
            >
              Batal
            </Button>
            <Button
              type="button"
              disabled={isClearingDummy}
              onClick={async () => {
                setIsClearingDummy(true);
                try {
                  await erp.clearDummyMasterData();
                  setConfirmDummyOpen(false);
                } finally {
                  setIsClearingDummy(false);
                }
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {isClearingDummy ? 'Menghapus...' : 'Ya, Hapus Data Dummy'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* CONFIRM DELETE MASTER RECORD DIALOG */}
      <Dialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmDelete?.title}</DialogTitle>
            <DialogDescription>{confirmDelete?.description}</DialogDescription>
          </DialogHeader>
          {confirmDelete && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-medium text-slate-800">
              {confirmDelete.detail}
            </div>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={isConfirmDeleting}
              onClick={() => setConfirmDelete(null)}
            >
              Batal
            </Button>
            <Button
              type="button"
              disabled={isConfirmDeleting}
              onClick={async () => {
                if (!confirmDelete) return;
                setIsConfirmDeleting(true);
                try {
                  await confirmDelete.onConfirm();
                  setConfirmDelete(null);
                } finally {
                  setIsConfirmDeleting(false);
                }
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {isConfirmDeleting ? 'Menghapus...' : 'Ya, Hapus Permanen'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

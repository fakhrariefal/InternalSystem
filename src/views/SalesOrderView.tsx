import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileDown,
  MapPin,
  Plus,
  Printer,
  Receipt,
  RotateCcw,
  Tag,
  Trash2,
  Truck,
  Upload,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { usePrintDocument } from '../components/PrintableDocumentModal';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
  calculateOrderTotals,
  checkSoStockAvailability,
  computeOpenArForCustomerIdr,
  convertToIdr,
  findSeededDummyOrderTargets,
  formatCurrency,
  getEffectiveTaxRatePercent,
  getPartnerVerificationStatus,
  isBuyerTopScheme,
  isCompanyPkp,
  isSafeDocumentUrl,
  isServiceOrderItem,
  resolveBuyerTermDays,
  resolveEffectiveUnitPrice,
  validateBuyerForSalesOrder,
} from '../models/erpLogic';
import {
  buildSalesInvoicePrintDoc,
  buildSalesOrderPrintDoc,
  buildSalesQuotationPrintDoc,
  buildSuratJalanPrintDoc,
} from '../models/printDocumentModel';
import { hasPermission } from '../models/rbac';
import { createInitialSeedState } from '../models/seedData';
import type {
  CurrencyCode,
  CustomerPriceTier,
  GoodsReturn,
  QuotationStatus,
  SalesOrder,
  SalesQuotation,
  SoStatus,
} from '../models/types';
import {
  exportSalesInvoicePdf,
  exportSalesOrderCsv,
  exportSalesOrderPdf,
  exportSalesQuotationPdf,
  exportSuratJalanCsv,
  exportSuratJalanPdf,
} from '../services/exportService';

function getSoTone(status: SoStatus): 'neutral' | 'success' | 'warning' | 'info' {
  switch (status) {
    case 'Confirmed':
      return 'info';
    case 'Partially Delivered':
      return 'warning';
    case 'Fully Delivered':
    case 'Invoiced':
    case 'Closed':
      return 'success';
    default:
      return 'neutral';
  }
}

function sanitizeDigits(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  return digits.replace(/^0+(?=\d)/, '');
}

export function SalesOrderView({ erp }: { erp: ErpController }) {
  const { state, currentUser } = erp;
  const { tr } = useI18n();
  const { openPrintPreview } = usePrintDocument();
  const canCreate = hasPermission(currentUser?.role, 'so:create');
  const canDeliver =
    hasPermission(currentUser?.role, 'so:deliver') || canCreate;
  const canInvoice =
    hasPermission(currentUser?.role, 'accounting:write') || canCreate;
  const canDelete = hasPermission(currentUser?.role, 'master:users');
  const canQuotation = hasPermission(currentUser?.role, 'quotation:write');
  const canReturn = hasPermission(currentUser?.role, 'return:write');
  const canContract =
    hasPermission(currentUser?.role, 'buyer:write') ||
    hasPermission(currentUser?.role, 'partner:approve');
  const rate = state.settings.defaultExchangeRateUsdIdr;

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedSoId, setSelectedSoId] = useState<string | null>(null);
  const [confirmDeleteSo, setConfirmDeleteSo] = useState<SalesOrder | null>(null);
  const [confirmItemDelete, setConfirmItemDelete] = useState<{
    title: string;
    description: string;
    detail: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [confirmDummyOpen, setConfirmDummyOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deliverMode, setDeliverMode] = useState(false);
  const [deliverQtys, setDeliverQtys] = useState<Record<string, string>>({});
  const [deliverNotes, setDeliverNotes] = useState('');
  const [podReceiverName, setPodReceiverName] = useState('');
  const [podFile, setPodFile] = useState<File | null>(null);

  type DraftOrderRow = {
    productId: string;
    qty: number;
    unitPrice: number;
    isService?: boolean;
    isManualService?: boolean;
    productName?: string;
    sku?: string;
    uomCode?: string;
  };

  // Create SO form
  const [customerId, setCustomerId] = useState(state.customers[0]?.id || '');
  const [warehouseId, setWarehouseId] = useState(state.warehouses[0]?.id || '');
  const [currency, setCurrency] = useState<CurrencyCode>('IDR');
  const [dueDate, setDueDate] = useState('2026-12-20');
  const [notes, setNotes] = useState('');
  const [draftItems, setDraftItems] = useState<DraftOrderRow[]>([
    {
      productId: state.products[0]?.id || '',
      qty: 5,
      unitPrice: state.products[0]?.sellPrice || 135000,
    },
  ]);

  // Quotation modal state
  const [qtOpen, setQtOpen] = useState(false);
  const [qtCustomerId, setQtCustomerId] = useState(state.customers[0]?.id || '');
  const [qtWarehouseId, setQtWarehouseId] = useState(state.warehouses[0]?.id || '');
  const [qtCurrency, setQtCurrency] = useState<CurrencyCode>('IDR');
  const [qtValidUntil, setQtValidUntil] = useState('2026-12-15');
  const [qtNotes, setQtNotes] = useState('');
  const [qtItems, setQtItems] = useState<DraftOrderRow[]>([
    {
      productId: state.products[0]?.id || '',
      qty: 10,
      unitPrice: state.products[0]?.sellPrice || 135000,
    },
  ]);

  // Buyer contract price editor state
  const [contractCustomerId, setContractCustomerId] = useState(state.customers[0]?.id || '');
  const [contractDraftTiers, setContractDraftTiers] = useState<CustomerPriceTier[]>(
    state.customers[0]?.contractPrices || []
  );

  // Sales Return modal state
  const returnableSos = useMemo(
    () =>
      state.salesOrders.filter((s) =>
        ['Partially Delivered', 'Fully Delivered', 'Invoiced', 'Closed'].includes(s.status)
      ),
    [state.salesOrders]
  );
  const salesReturns: GoodsReturn[] = useMemo(
    () => state.goodsReturns.filter((r) => r.returnType === 'SALES_RETURN'),
    [state.goodsReturns]
  );
  const [retOpen, setRetOpen] = useState(false);
  const [retSoId, setRetSoId] = useState('');
  const [retDate, setRetDate] = useState(new Date().toISOString().slice(0, 10));
  const [retReason, setRetReason] = useState('');
  const [retQtys, setRetQtys] = useState<Record<string, string>>({});

  const selectedSo: SalesOrder | undefined = state.salesOrders.find(
    (s) => s.id === selectedSoId
  );

  const companyIsPkp = isCompanyPkp(state.settings);
  const effectiveTaxRate = getEffectiveTaxRatePercent(state.settings);

  const stockCheck = checkSoStockAvailability(
    draftItems.map((i) => ({
      productId: i.productId,
      qty: i.qty,
      fulfilledQty: 0,
      isService: i.isService,
    })),
    warehouseId,
    state.products
  );
  const totals = calculateOrderTotals(draftItems, effectiveTaxRate);
  const qtTotals = calculateOrderTotals(qtItems, effectiveTaxRate);
  const selectedCustomer = state.customers.find((c) => c.id === customerId);
  const newOrderAmountIdr = convertToIdr(
    totals.totalAmount,
    currency,
    state.settings.defaultExchangeRateUsdIdr
  );
  const openArIdr = selectedCustomer
    ? computeOpenArForCustomerIdr(
        state.invoices,
        selectedCustomer.id,
        state.settings.defaultExchangeRateUsdIdr
      )
    : 0;
  const buyerEligibility = selectedCustomer
    ? validateBuyerForSalesOrder({
        customer: selectedCustomer,
        newOrderAmountIdr,
        openArIdr,
      })
    : { allowed: true };
  const selectedSoCustomer = selectedSo
    ? state.customers.find((c) => c.id === selectedSo.customerId)
    : undefined;
  const selectedSoInvoice = selectedSo
    ? state.invoices.find(
        (inv) =>
          inv.ledgerType === 'AR' &&
          (inv.referenceOrderId === selectedSo.id ||
            inv.referenceOrderNumber === selectedSo.soNumber)
      )
    : undefined;

  const openSoDetail = (so: SalesOrder, openDelivery: boolean = false) => {
    setSelectedSoId(so.id);
    setDeliverMode(openDelivery);
    const map: Record<string, string> = {};
    so.items.forEach((it) => {
      map[it.productId] = String(Math.max(0, it.qty - it.fulfilledQty));
    });
    setDeliverQtys(map);
    setDeliverNotes('');
    setPodReceiverName('');
    setPodFile(null);
  };

  const dummyTargets = useMemo(
    () => findSeededDummyOrderTargets(state, createInitialSeedState()),
    [state]
  );

  const applyContractPricesToItems = (
    items: DraftOrderRow[],
    targetCustomerId: string,
    targetCurr: CurrencyCode
  ) => {
    const cus = state.customers.find((c) => c.id === targetCustomerId);
    return items.map((it) => {
      if (it.isService) return it;
      const prod = state.products.find((p) => p.id === it.productId);
      if (!prod || prod.isService) return it;
      const resolved = resolveEffectiveUnitPrice(cus, prod, it.qty || 1, targetCurr, rate);
      return { ...it, unitPrice: resolved.unitPrice };
    });
  };

  const buildManualServiceRow = (): DraftOrderRow => ({
    productId: `svc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    qty: 1,
    unitPrice: 0,
    isService: true,
    isManualService: true,
    productName: '',
    sku: 'SRV-MANUAL',
    uomCode: 'JASA',
  });

  const openCreateModal = () => {
    const cusId = customerId || state.customers[0]?.id || '';
    if (!customerId && cusId) setCustomerId(cusId);
    if (!warehouseId && state.warehouses[0]) setWarehouseId(state.warehouses[0].id);
    const baseItems: DraftOrderRow[] =
      (!draftItems[0]?.productId || draftItems.length === 0) && state.products[0]
        ? [{ productId: state.products[0].id, qty: 5, unitPrice: state.products[0].sellPrice || 135000 }]
        : draftItems;
    setDraftItems(applyContractPricesToItems(baseItems, cusId, currency));
    setCreateOpen(true);
  };

  const openQuotationModal = () => {
    const cusId = qtCustomerId || state.customers[0]?.id || '';
    if (!qtCustomerId && cusId) setQtCustomerId(cusId);
    if (!qtWarehouseId && state.warehouses[0]) setQtWarehouseId(state.warehouses[0].id);
    const baseItems: DraftOrderRow[] =
      (!qtItems[0]?.productId || qtItems.length === 0) && state.products[0]
        ? [{ productId: state.products[0].id, qty: 10, unitPrice: state.products[0].sellPrice || 135000 }]
        : qtItems;
    setQtItems(applyContractPricesToItems(baseItems, cusId, qtCurrency));
    setQtOpen(true);
  };

  const openReturnModal = () => {
    const firstSo = returnableSos[0];
    setRetSoId(firstSo?.id || '');
    const map: Record<string, string> = {};
    firstSo?.items.forEach((it) => {
      map[it.productId] = '0';
    });
    setRetQtys(map);
    setRetReason('');
    setRetOpen(true);
  };

  const selectContractCustomer = (cid: string) => {
    setContractCustomerId(cid);
    const cus = state.customers.find((c) => c.id === cid);
    setContractDraftTiers(cus?.contractPrices ? [...cus.contractPrices] : []);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-[#0B1B3A]">
            {tr('Sales Order (SO)', 'Sales Orders (SO)')}
          </h2>
          <p className="text-xs sm:text-sm text-slate-600">
            {tr(
              'Pengelolaan pesanan customer B2B dengan pengecekan stok gudang real-time, pengiriman, dan penerbitan invoice AR.',
              'Manage B2B customer orders with real-time warehouse stock checks, fulfillment delivery, and AR invoicing.'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canDelete && dummyTargets.soIds.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmDummyOpen(true)}
              className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 whitespace-nowrap flex-1 sm:flex-none"
            >
              <Trash2 className="h-4 w-4" />
              {tr('Hapus Dummy', 'Remove Sample')} ({dummyTargets.soIds.length})
            </Button>
          )}
          {canCreate && (
            <Button
              type="button"
              variant="accent"
              size="sm"
              onClick={openCreateModal}
              className="flex-1 sm:flex-none"
            >
              <Plus className="h-4 w-4" />
              {tr('Buat Sales Order', 'Create Sales Order')}
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">
            Daftar SO ({state.salesOrders.length})
          </TabsTrigger>
          <TabsTrigger value="quotations">
            Penawaran / Quotation ({state.salesQuotations.length})
          </TabsTrigger>
          <TabsTrigger value="contracts">
            Harga Kontrak Buyer
          </TabsTrigger>
          <TabsTrigger value="returns">
            Retur Penjualan ({salesReturns.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="space-y-4">
      {/* Mobile SO Cards */}
      <div className="space-y-3 md:hidden">
        {state.salesOrders.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-xs text-slate-500">
              Belum ada data Sales Order.
            </CardContent>
          </Card>
        ) : (
          state.salesOrders.map((so) => (
            <Card key={`m_so_${so.id}`}>
              <CardContent className="p-4 space-y-3 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono font-bold text-[#0B1B3A] text-sm">{so.soNumber}</div>
                    <div className="text-[11px] text-slate-500">
                      {so.invoiceNumber ? `Inv: ${so.invoiceNumber}` : `${so.items.length} item`} · Tempo {so.dueDate || '-'}
                    </div>
                  </div>
                  <StatusLabel status={so.status} tone={getSoTone(so.status)} />
                </div>

                <div className="space-y-1">
                  <div className="font-semibold text-[#0B1B3A]">{so.customerName}</div>
                  <div className="text-[11px] text-slate-500">Gudang: {so.warehouseName}</div>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-[#F4F7FB] px-3 py-2.5">
                  <span className="text-[11px] text-slate-500">Total Order</span>
                  <span className="font-mono tabular-nums font-bold text-[#0B1B3A] text-sm">
                    {formatCurrency(so.totalAmount, so.currency)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openSoDetail(so, false)}
                  >
                    Detail SO
                  </Button>
                  {canDeliver && ['Confirmed', 'Partially Delivered'].includes(so.status) ? (
                    <Button
                      type="button"
                      variant="accent"
                      size="sm"
                      onClick={() => openSoDetail(so, true)}
                    >
                      <Truck className="h-3.5 w-3.5" />
                      Kirim Barang
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        exportSuratJalanPdf(
                          so,
                          state.settings,
                          state.customers.find((c) => c.id === so.customerId),
                          state.warehouses.find((w) => w.id === so.warehouseId)
                        )
                      }
                    >
                      <Truck className="h-3.5 w-3.5 text-[#D9AA32]" />
                      Surat Jalan
                    </Button>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Cetak SO ${so.soNumber}`}
                      onClick={() => {
                        const cust = state.customers.find((c) => c.id === so.customerId);
                        const wh = state.warehouses.find((w) => w.id === so.warehouseId);
                        openPrintPreview(
                          buildSalesOrderPrintDoc(so, state.settings, cust, wh),
                          () => exportSalesOrderPdf(so, state.settings, cust, wh)
                        );
                      }}
                    >
                      <Printer className="h-3.5 w-3.5 text-[#0B1B3A]" />
                      Cetak SO
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void exportSalesOrderPdf(
                          so,
                          state.settings,
                          state.customers.find((c) => c.id === so.customerId),
                          state.warehouses.find((w) => w.id === so.warehouseId)
                        )
                      }
                    >
                      <FileDown className="h-3.5 w-3.5 text-[#1B5E99]" />
                      PDF SO
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void exportSuratJalanPdf(
                          so,
                          state.settings,
                          state.customers.find((c) => c.id === so.customerId),
                          state.warehouses.find((w) => w.id === so.warehouseId)
                        )
                      }
                    >
                      <Truck className="h-3.5 w-3.5 text-[#D9AA32]" />
                      SJ PDF
                    </Button>
                  </div>
                  {canDelete && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Hapus SO ${so.soNumber}`}
                      onClick={() => setConfirmDeleteSo(so)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Hapus
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Desktop SO Table */}
      <Card className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 font-semibold">Nomor SO</th>
                <th className="py-3 px-3 font-semibold">Customer</th>
                <th className="py-3 px-3 font-semibold">Gudang Pengirim</th>
                <th className="py-3 px-3 font-semibold">Jatuh Tempo</th>
                <th className="py-3 px-3 font-semibold text-right">Total</th>
                <th className="py-3 px-3 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {state.salesOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Belum ada data Sales Order.
                  </td>
                </tr>
              ) : (
                state.salesOrders.map((so) => (
                  <tr key={so.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <div className="font-mono font-semibold text-slate-900">{so.soNumber}</div>
                      <div className="text-[11px] text-slate-500">
                        {so.invoiceNumber ? `Invoice: ${so.invoiceNumber}` : `${so.items.length} item`}
                      </div>
                    </td>
                    <td className="py-3 px-3 font-medium text-slate-800">{so.customerName}</td>
                    <td className="py-3 px-3 text-slate-600">{so.warehouseName}</td>
                    <td className="py-3 px-3 font-mono tabular-nums text-slate-600">
                      {so.dueDate || '-'}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold">
                      {formatCurrency(so.totalAmount, so.currency)}
                    </td>
                    <td className="py-3 px-3">
                      <StatusLabel status={so.status} tone={getSoTone(so.status)} />
                    </td>
                    <td className="py-3 px-4 text-right space-x-1 whitespace-nowrap">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Cetak SO ${so.soNumber}`}
                        onClick={() => {
                          const cust = state.customers.find((c) => c.id === so.customerId);
                          const wh = state.warehouses.find((w) => w.id === so.warehouseId);
                          openPrintPreview(
                            buildSalesOrderPrintDoc(so, state.settings, cust, wh),
                            () => exportSalesOrderPdf(so, state.settings, cust, wh)
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
                        aria-label={`Export PDF SO ${so.soNumber}`}
                        onClick={() =>
                          void exportSalesOrderPdf(
                            so,
                            state.settings,
                            state.customers.find((c) => c.id === so.customerId),
                            state.warehouses.find((w) => w.id === so.warehouseId)
                          )
                        }
                      >
                        <FileDown className="h-3.5 w-3.5 text-[#1B5E99]" />
                        PDF SO
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Export Surat Jalan ${so.soNumber}`}
                        onClick={() =>
                          void exportSuratJalanPdf(
                            so,
                            state.settings,
                            state.customers.find((c) => c.id === so.customerId),
                            state.warehouses.find((w) => w.id === so.warehouseId)
                          )
                        }
                      >
                        <Truck className="h-3.5 w-3.5 text-[#D9AA32]" />
                        Surat Jalan
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openSoDetail(so, false)}
                      >
                        Detail
                      </Button>
                      {canDeliver &&
                        ['Confirmed', 'Partially Delivered'].includes(so.status) && (
                          <Button
                            type="button"
                            variant="accent"
                            size="sm"
                            onClick={() => openSoDetail(so, true)}
                          >
                            <Truck className="h-3.5 w-3.5" />
                            Kirim Barang
                          </Button>
                        )}
                      {canDelete && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Hapus SO ${so.soNumber}`}
                          onClick={() => setConfirmDeleteSo(so)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
        </TabsContent>

        {/* TAB 2: SALES QUOTATIONS */}
        <TabsContent value="quotations" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl p-3.5">
            <div>
              <div className="text-sm font-semibold text-[#0B1B3A]">
                Penawaran Harga Resmi (Sales Quotation)
              </div>
              <div className="text-xs text-slate-500">
                Terapkan harga kontrak buyer otomatis, ekspor PDF dengan QR verifikasi, dan konversi 1 klik menjadi Sales Order.
              </div>
            </div>
            {canQuotation && (
              <Button
                type="button"
                variant="accent"
                size="sm"
                onClick={openQuotationModal}
                className="w-full sm:w-auto shrink-0"
              >
                <Plus className="h-4 w-4" />
                Buat Quotation
              </Button>
            )}
          </div>

          <div className="space-y-3 md:hidden">
            {state.salesQuotations.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-xs text-slate-500">
                  Belum ada data penawaran harga (Quotation).
                </CardContent>
              </Card>
            ) : (
              state.salesQuotations.map((qt) => (
                <Card key={`m_qt_${qt.id}`}>
                  <CardContent className="p-4 space-y-2.5 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono font-bold text-[#0B1B3A] text-sm">
                          {qt.quotationNumber}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Berlaku s/d {qt.validUntil}
                        </div>
                      </div>
                      <StatusLabel
                        status={qt.status}
                        tone={
                          qt.status === 'Converted' || qt.status === 'Accepted'
                            ? 'success'
                            : qt.status === 'Rejected' || qt.status === 'Expired'
                            ? 'danger'
                            : qt.status === 'Sent'
                            ? 'info'
                            : 'neutral'
                        }
                      />
                    </div>
                    <div className="font-semibold text-[#0B1B3A]">{qt.customerName}</div>
                    <div className="flex items-center justify-between rounded-lg bg-[#F4F7FB] p-2.5">
                      <span className="text-slate-500">{qt.items.length} item</span>
                      <span className="font-mono font-bold text-[#0B1B3A]">
                        {formatCurrency(qt.totalAmount, qt.currency)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Cetak Quotation ${qt.quotationNumber}`}
                        onClick={() => {
                          const cust = state.customers.find((c) => c.id === qt.customerId);
                          const wh = state.warehouses.find((w) => w.id === qt.warehouseId);
                          openPrintPreview(
                            buildSalesQuotationPrintDoc(qt, state.settings, cust, wh),
                            () => exportSalesQuotationPdf(qt, state.settings, cust, wh)
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
                          void exportSalesQuotationPdf(
                            qt,
                            state.settings,
                            state.customers.find((c) => c.id === qt.customerId),
                            state.warehouses.find((w) => w.id === qt.warehouseId)
                          )
                        }
                      >
                        <FileDown className="h-3.5 w-3.5 text-[#1B5E99]" />
                        PDF
                      </Button>
                      {canQuotation && qt.status === 'Draft' && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void erp.updateQuotationStatus(qt.id, 'Sent')}
                        >
                          Tandai Sent
                        </Button>
                      )}
                      {canQuotation && qt.status === 'Sent' && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void erp.updateQuotationStatus(qt.id, 'Accepted')}
                        >
                          Accept
                        </Button>
                      )}
                      {canCreate && qt.status !== 'Converted' && qt.status !== 'Rejected' && (
                        <Button
                          type="button"
                          variant="accent"
                          size="sm"
                          onClick={() => void erp.convertQuotationToSo(qt.id)}
                        >
                          Konversi ke SO
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Hapus quotation ${qt.quotationNumber}`}
                          onClick={() =>
                            setConfirmItemDelete({
                              title: 'Hapus Sales Quotation?',
                              description: 'Dokumen penawaran harga ini akan dihapus permanen.',
                              detail: `${qt.quotationNumber} · ${qt.customerName} (${qt.status})`,
                              onConfirm: async () => {
                                await erp.deleteSalesQuotation(qt.id);
                              },
                            })
                          }
                          className="text-red-600 hover:bg-red-50 ml-auto"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Hapus
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          <Card className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-semibold">No. Quotation</th>
                    <th className="py-3 px-3 font-semibold">Buyer / Customer</th>
                    <th className="py-3 px-3 font-semibold">Gudang</th>
                    <th className="py-3 px-3 font-semibold">Berlaku s/d</th>
                    <th className="py-3 px-3 font-semibold text-right">Total</th>
                    <th className="py-3 px-3 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {state.salesQuotations.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500">
                        Belum ada data Quotation.
                      </td>
                    </tr>
                  ) : (
                    state.salesQuotations.map((qt) => (
                      <tr key={qt.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-4">
                          <div className="font-mono font-semibold text-[#0B1B3A]">{qt.quotationNumber}</div>
                          {qt.convertedSoNumber && (
                            <div className="text-[11px] font-mono text-emerald-700">
                              → {qt.convertedSoNumber}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-800">{qt.customerName}</td>
                        <td className="py-2.5 px-3 text-slate-600">{qt.warehouseName}</td>
                        <td className="py-2.5 px-3 font-mono tabular-nums text-slate-600">
                          {qt.validUntil}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                          {formatCurrency(qt.totalAmount, qt.currency)}
                        </td>
                        <td className="py-2.5 px-3">
                          <StatusLabel
                            status={qt.status}
                            tone={
                              qt.status === 'Converted' || qt.status === 'Accepted'
                                ? 'success'
                                : qt.status === 'Rejected' || qt.status === 'Expired'
                                ? 'danger'
                                : qt.status === 'Sent'
                                ? 'info'
                                : 'neutral'
                            }
                          />
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap space-x-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={`Cetak Quotation ${qt.quotationNumber}`}
                            onClick={() => {
                              const cust = state.customers.find((c) => c.id === qt.customerId);
                              const wh = state.warehouses.find((w) => w.id === qt.warehouseId);
                              openPrintPreview(
                                buildSalesQuotationPrintDoc(qt, state.settings, cust, wh),
                                () => exportSalesQuotationPdf(qt, state.settings, cust, wh)
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
                              void exportSalesQuotationPdf(
                                qt,
                                state.settings,
                                state.customers.find((c) => c.id === qt.customerId),
                                state.warehouses.find((w) => w.id === qt.warehouseId)
                              )
                            }
                          >
                            <FileDown className="h-3.5 w-3.5 text-[#1B5E99]" />
                            PDF
                          </Button>
                          {canQuotation && qt.status === 'Draft' && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => void erp.updateQuotationStatus(qt.id, 'Sent')}
                            >
                              Sent
                            </Button>
                          )}
                          {canQuotation && qt.status === 'Sent' && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => void erp.updateQuotationStatus(qt.id, 'Accepted')}
                            >
                              Accept
                            </Button>
                          )}
                          {canCreate && qt.status !== 'Converted' && qt.status !== 'Rejected' && (
                            <Button
                              type="button"
                              variant="accent"
                              size="sm"
                              onClick={() => void erp.convertQuotationToSo(qt.id)}
                            >
                              Konversi ke SO
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Hapus quotation ${qt.quotationNumber}`}
                              onClick={() =>
                                setConfirmItemDelete({
                                  title: 'Hapus Sales Quotation?',
                                  description: 'Dokumen penawaran harga ini akan dihapus permanen.',
                                  detail: `${qt.quotationNumber} · ${qt.customerName} (${qt.status})`,
                                  onConfirm: async () => {
                                    await erp.deleteSalesQuotation(qt.id);
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
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* TAB 3: BUYER CONTRACT PRICES */}
        <TabsContent value="contracts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Daftar Harga Kontrak Khusus Buyer (Contract Pricing)</CardTitle>
              <p className="text-xs text-slate-500">
                Harga kontrak otomatis diterapkan saat Sales membuat Quotation atau Sales Order sesuai minimal kuantitas dan masa berlaku.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                <div className="space-y-1 flex-1 max-w-md">
                  <Label htmlFor="contract-cus">Pilih Buyer / Customer</Label>
                  <NativeSelect
                    id="contract-cus"
                    value={contractCustomerId}
                    onChange={(e) => selectContractCustomer(e.target.value)}
                  >
                    {state.customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.contractPrices?.length || 0} kontrak)
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                {canContract && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const firstProd = state.products[0];
                      if (!firstProd) return;
                      setContractDraftTiers((prev) => [
                        ...prev,
                        {
                          productId: firstProd.id,
                          currency: firstProd.currency,
                          minQty: 1,
                          unitPrice: firstProd.sellPrice,
                          validUntil: '2027-12-31',
                        },
                      ]);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Tambah Item Kontrak
                  </Button>
                )}
              </div>

              {contractDraftTiers.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
                  Belum ada harga kontrak khusus untuk buyer ini. Klik &ldquo;Tambah Item Kontrak&rdquo; untuk menambahkan.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {contractDraftTiers.map((tier, idx) => (
                    <div
                      key={`tier_${idx}`}
                      className="grid grid-cols-12 gap-2.5 items-end rounded-lg border border-slate-200 bg-[#F4F7FB] p-3 text-xs"
                    >
                      <div className="col-span-12 sm:col-span-4 space-y-1">
                        <Label className="text-[11px]">Produk</Label>
                        <NativeSelect
                          disabled={!canContract}
                          value={tier.productId}
                          onChange={(e) =>
                            setContractDraftTiers((prev) =>
                              prev.map((t, i) =>
                                i === idx ? { ...t, productId: e.target.value } : t
                              )
                            )
                          }
                        >
                          {state.products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.sku} — {p.name}
                            </option>
                          ))}
                        </NativeSelect>
                      </div>
                      <div className="col-span-4 sm:col-span-2 space-y-1">
                        <Label className="text-[11px]">Mata Uang</Label>
                        <NativeSelect
                          disabled={!canContract}
                          value={tier.currency || 'IDR'}
                          onChange={(e) =>
                            setContractDraftTiers((prev) =>
                              prev.map((t, i) =>
                                i === idx ? { ...t, currency: e.target.value as CurrencyCode } : t
                              )
                            )
                          }
                        >
                          <option value="IDR">IDR</option>
                          <option value="USD">USD</option>
                        </NativeSelect>
                      </div>
                      <div className="col-span-4 sm:col-span-1 space-y-1">
                        <Label className="text-[11px]">Min Qty</Label>
                        <Input
                          disabled={!canContract}
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={String(tier.minQty || 1)}
                          onChange={(e) => {
                            const clean = sanitizeDigits(e.target.value);
                            setContractDraftTiers((prev) =>
                              prev.map((t, i) =>
                                i === idx ? { ...t, minQty: clean ? Number(clean) : 1 } : t
                              )
                            );
                          }}
                          className="font-mono text-right bg-white"
                        />
                      </div>
                      <div className="col-span-8 sm:col-span-2 space-y-1">
                        <Label className="text-[11px]">Harga Kontrak</Label>
                        <Input
                          disabled={!canContract}
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={String(tier.unitPrice || 0)}
                          onChange={(e) => {
                            const clean = sanitizeDigits(e.target.value);
                            setContractDraftTiers((prev) =>
                              prev.map((t, i) =>
                                i === idx ? { ...t, unitPrice: clean ? Number(clean) : 0 } : t
                              )
                            );
                          }}
                          className="font-mono text-right bg-white"
                        />
                      </div>
                      <div className="col-span-9 sm:col-span-2 space-y-1">
                        <Label className="text-[11px]">Berlaku s/d</Label>
                        <Input
                          disabled={!canContract}
                          type="date"
                          value={tier.validUntil || ''}
                          onChange={(e) =>
                            setContractDraftTiers((prev) =>
                              prev.map((t, i) =>
                                i === idx ? { ...t, validUntil: e.target.value } : t
                              )
                            )
                          }
                          className="bg-white"
                        />
                      </div>
                      <div className="col-span-3 sm:col-span-1 flex justify-end">
                        {canContract && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setContractDraftTiers((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {canContract && (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="accent"
                    onClick={() =>
                      void erp.saveCustomerContractPrices(contractCustomerId, contractDraftTiers)
                    }
                  >
                    Simpan Harga Kontrak Buyer
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 4: SALES RETURNS (CREDIT NOTE) */}
        <TabsContent value="returns" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl p-3.5">
            <div>
              <div className="text-sm font-semibold text-[#0B1B3A]">
                Retur Penjualan / Credit Note ({salesReturns.length})
              </div>
              <div className="text-xs text-slate-500">
                Retur dari buyer mengembalikan stok ke gudang dan membalikkan omzet, PPN Keluaran, serta HPP otomatis.
              </div>
            </div>
            {canReturn && returnableSos.length > 0 && (
              <Button
                type="button"
                variant="accent"
                size="sm"
                onClick={openReturnModal}
                className="w-full sm:w-auto shrink-0"
              >
                <RotateCcw className="h-4 w-4" />
                Ajukan Retur Penjualan
              </Button>
            )}
          </div>

          <div className="space-y-3 md:hidden">
            {salesReturns.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-xs text-slate-500">
                  Belum ada dokumen retur penjualan.
                </CardContent>
              </Card>
            ) : (
              salesReturns.map((ret) => (
                <Card key={`m_sret_${ret.id}`}>
                  <CardContent className="p-4 space-y-2.5 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono font-bold text-[#0B1B3A]">{ret.returnNumber}</div>
                        <div className="text-[11px] font-mono text-slate-500">
                          Ref: {ret.referenceOrderNumber} · {ret.returnDate}
                        </div>
                      </div>
                      <StatusLabel
                        status={ret.status}
                        tone={
                          ret.status === 'Completed'
                            ? 'success'
                            : ret.status === 'Cancelled'
                            ? 'danger'
                            : 'warning'
                        }
                      />
                    </div>
                    <div className="font-semibold text-[#0B1B3A]">{ret.counterpartyName}</div>
                    <div className="text-[11px] text-slate-600">{ret.reason}</div>
                    <div className="flex items-center justify-between rounded-lg bg-[#F4F7FB] p-2.5">
                      <span className="text-slate-500">{ret.items.length} item</span>
                      <span className="font-mono font-bold text-[#0B1B3A]">
                        {formatCurrency(ret.totalAmount, ret.currency)}
                      </span>
                    </div>
                    {(ret.status === 'Pending' || canDelete) && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {ret.status === 'Pending' && canInvoice && (
                          <Button
                            type="button"
                            variant="accent"
                            size="sm"
                            className="flex-1"
                            onClick={() => void erp.completeGoodsReturn(ret.id)}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Selesaikan &amp; Posting
                          </Button>
                        )}
                        {ret.status === 'Pending' && canReturn && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void erp.cancelGoodsReturn(ret.id)}
                            className="text-red-600 border-red-200"
                          >
                            Batalkan
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Hapus retur ${ret.returnNumber}`}
                            onClick={() =>
                              setConfirmItemDelete({
                                title: 'Hapus Riwayat Retur Penjualan?',
                                description: 'Catatan retur penjualan yang dipilih akan dihapus permanen.',
                                detail: `${ret.returnNumber} · ${ret.counterpartyName} (${ret.status})`,
                                onConfirm: async () => {
                                  await erp.deleteGoodsReturn(ret.id);
                                },
                              })
                            }
                            className="text-red-600 hover:bg-red-50 ml-auto"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Hapus
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          <Card className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-semibold">No. Retur</th>
                    <th className="py-3 px-3 font-semibold">Ref SO</th>
                    <th className="py-3 px-3 font-semibold">Buyer</th>
                    <th className="py-3 px-3 font-semibold">Alasan</th>
                    <th className="py-3 px-3 font-semibold text-right">Nilai Credit Note</th>
                    <th className="py-3 px-3 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {salesReturns.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500">
                        Belum ada dokumen retur penjualan.
                      </td>
                    </tr>
                  ) : (
                    salesReturns.map((ret) => (
                      <tr key={ret.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-4 font-mono font-semibold text-[#0B1B3A]">
                          {ret.returnNumber}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-600">{ret.referenceOrderNumber}</td>
                        <td className="py-2.5 px-3 font-medium">{ret.counterpartyName}</td>
                        <td className="py-2.5 px-3 text-slate-600 max-w-xs truncate">{ret.reason}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                          {formatCurrency(ret.totalAmount, ret.currency)}
                        </td>
                        <td className="py-2.5 px-3">
                          <StatusLabel
                            status={ret.status}
                            tone={
                              ret.status === 'Completed'
                                ? 'success'
                                : ret.status === 'Cancelled'
                                ? 'danger'
                                : 'warning'
                            }
                          />
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap space-x-1">
                          {ret.status === 'Pending' && canInvoice && (
                            <Button
                              type="button"
                              variant="accent"
                              size="sm"
                              onClick={() => void erp.completeGoodsReturn(ret.id)}
                            >
                              Selesaikan &amp; Posting
                            </Button>
                          )}
                          {ret.status === 'Pending' && canReturn && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => void erp.cancelGoodsReturn(ret.id)}
                              className="text-red-600 border-red-200"
                            >
                              Batalkan
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Hapus retur ${ret.returnNumber}`}
                              onClick={() =>
                                setConfirmItemDelete({
                                  title: 'Hapus Riwayat Retur Penjualan?',
                                  description: 'Catatan retur penjualan yang dipilih akan dihapus permanen.',
                                  detail: `${ret.returnNumber} · ${ret.counterpartyName} (${ret.status})`,
                                  onConfirm: async () => {
                                    await erp.deleteGoodsReturn(ret.id);
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
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* CREATE SO MODAL */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent size="xl" structured>
          <DialogHeader structured>
            <DialogTitle>Buat Sales Order Baru</DialogTitle>
            <DialogDescription>
              Lengkapi tujuan pengiriman, item produk, atau jasa tambahan. Stok gudang diverifikasi otomatis.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col flex-1 min-h-0"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await erp.createSalesOrder({
                customerId,
                warehouseId,
                currency,
                dueDate,
                notes,
                items: draftItems,
                confirmImmediately: stockCheck.sufficient,
              });
              if (ok) {
                setCreateOpen(false);
              }
            }}
          >
            <DialogBody>
              {/* Section 1: Header Info */}
              <div className="space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Informasi Pesanan
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                  <div className="space-y-1.5 col-span-2">
                    <Label htmlFor="so-cus">Customer / Buyer</Label>
                    <NativeSelect
                      id="so-cus"
                      value={customerId}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        setCustomerId(nextId);
                        setDraftItems((prev) => applyContractPricesToItems(prev, nextId, currency));
                        const cus = state.customers.find((c) => c.id === nextId);
                        if (cus) {
                          const days = cus.paymentScheme
                            ? resolveBuyerTermDays(cus.paymentScheme)
                            : cus.paymentTermDays || 0;
                          const nextDue = new Date(Date.now() + days * 86400000)
                            .toISOString()
                            .slice(0, 10);
                          setDueDate(nextDue);
                        }
                      }}
                    >
                      {state.customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.paymentScheme || `NET ${c.paymentTermDays}`} · {getPartnerVerificationStatus(c)})
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label htmlFor="so-wh">Gudang Sumber</Label>
                    <NativeSelect
                      id="so-wh"
                      value={warehouseId}
                      onChange={(e) => setWarehouseId(e.target.value)}
                    >
                      {state.warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5 col-span-1 lg:col-span-2">
                    <Label htmlFor="so-curr">Mata Uang</Label>
                    <NativeSelect
                      id="so-curr"
                      value={currency}
                      onChange={(e) => {
                        const nextCurr = e.target.value as CurrencyCode;
                        setCurrency(nextCurr);
                        setDraftItems((prev) => applyContractPricesToItems(prev, customerId, nextCurr));
                      }}
                    >
                      <option value="IDR">IDR (Rupiah)</option>
                      <option value="USD">USD (Dollar)</option>
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5 col-span-1 lg:col-span-2">
                    <Label htmlFor="so-due">Jatuh Tempo</Label>
                    <Input
                      id="so-due"
                      type="date"
                      required
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                    />
                  </div>
                </div>

                {selectedCustomer && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-slate-600">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>
                        Skema Bayar:{' '}
                        <strong className="text-[#0B1B3A]">
                          {selectedCustomer.paymentScheme || `NET ${selectedCustomer.paymentTermDays} Hari`}
                        </strong>
                      </span>
                      <span className="text-slate-300">·</span>
                      <span>
                        Status:{' '}
                        <strong className="text-[#0B1B3A]">
                          {getPartnerVerificationStatus(selectedCustomer)}
                        </strong>
                      </span>
                    </div>
                    {isBuyerTopScheme(selectedCustomer) && (
                      <div className="font-mono text-[11px] text-slate-600">
                        AR: {formatCurrency(openArIdr, 'IDR')} / Limit:{' '}
                        <strong className="text-[#0B1B3A]">
                          {formatCurrency(selectedCustomer.creditLimit, 'IDR')}
                        </strong>
                      </div>
                    )}
                  </div>
                )}

                {!buyerEligibility.allowed && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold">Persetujuan Admin / Credit Limit Diperlukan</div>
                      <div>{buyerEligibility.reason}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Section 2: Items & Services */}
              <div className="border-t border-slate-100 pt-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Item Produk &amp; Jasa ({draftItems.length})
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setDraftItems((prev) => [...prev, buildManualServiceRow()])}
                      className="border-[#BFD9EF] text-[#154C7E] hover:bg-[#EBF3FA]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Service
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const p = state.products[0];
                        if (!p) return;
                        const resolved = resolveEffectiveUnitPrice(selectedCustomer, p, 1, currency, rate);
                        setDraftItems((prev) => [
                          ...prev,
                          {
                            productId: p.id,
                            qty: 1,
                            unitPrice: resolved.unitPrice,
                            isService: Boolean(p.isService),
                            isManualService: false,
                            productName: p.name,
                            sku: p.sku,
                            uomCode: p.uomCode,
                          },
                        ]);
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Tambah Produk
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
                  {/* Desktop Table Header */}
                  <div className="hidden md:grid md:grid-cols-[minmax(0,1fr)_88px_148px_132px_36px] gap-2.5 px-3.5 py-2.5 bg-slate-50/90 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <div>Produk / Jasa Manual</div>
                    <div className="text-right">Qty</div>
                    <div className="text-right">Harga ({currency})</div>
                    <div className="text-right">Subtotal</div>
                    <div />
                  </div>

                  <div className="divide-y divide-slate-100">
                    {draftItems.map((row, idx) => {
                      const prod = state.products.find((p) => p.id === row.productId);
                      const isManualSvc = Boolean(row.isManualService || (row.isService && !prod));
                      const isSvc = Boolean(row.isService || prod?.isService);
                      const avail = prod?.warehouseStocks[warehouseId] ?? 0;
                      const lineTotal = (row.qty || 0) * (row.unitPrice || 0);
                      const contractCheck =
                        prod && !isSvc
                          ? resolveEffectiveUnitPrice(selectedCustomer, prod, row.qty || 1, currency, rate)
                          : { isContractPrice: false, unitPrice: row.unitPrice };
                      return (
                        <div
                          key={row.productId && isManualSvc ? row.productId : `so_row_${idx}`}
                          className="p-3.5 md:py-3 md:px-3.5 grid grid-cols-12 md:grid-cols-[minmax(0,1fr)_88px_148px_132px_36px] gap-2.5 items-start"
                        >
                          <div className="col-span-12 md:col-span-1 space-y-1">
                            <div className="flex items-center justify-between md:hidden">
                              <Label className="text-[11px] text-slate-500">
                                {isManualSvc ? `Service #${idx + 1}` : `Produk #${idx + 1}`}
                              </Label>
                              {draftItems.length > 1 && (
                                <button
                                  type="button"
                                  aria-label={`Hapus item SO ${idx + 1}`}
                                  onClick={() =>
                                    setDraftItems((prev) => prev.filter((_, i) => i !== idx))
                                  }
                                  className="text-xs font-medium text-red-600 hover:underline cursor-pointer"
                                >
                                  Hapus
                                </button>
                              )}
                            </div>

                            {isManualSvc ? (
                              <Input
                                required
                                aria-label={`Nama service SO ${idx + 1}`}
                                placeholder="Ketik nama jasa (misal: Jasa pengiriman, angkut, packing)"
                                value={row.productName || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setDraftItems((prev) =>
                                    prev.map((it, i) => (i === idx ? { ...it, productName: val } : it))
                                  );
                                }}
                              />
                            ) : (
                              <NativeSelect
                                aria-label={`Produk SO ${idx + 1}`}
                                value={row.productId}
                                onChange={(e) => {
                                  const pid = e.target.value;
                                  const p = state.products.find((pr) => pr.id === pid);
                                  const resolved =
                                    p && !p.isService
                                      ? resolveEffectiveUnitPrice(selectedCustomer, p, row.qty || 1, currency, rate)
                                      : undefined;
                                  setDraftItems((prev) =>
                                    prev.map((it, i) =>
                                      i === idx
                                        ? {
                                            ...it,
                                            productId: pid,
                                            isService: Boolean(p?.isService),
                                            isManualService: false,
                                            productName: p?.name,
                                            sku: p?.sku,
                                            uomCode: p?.uomCode,
                                            unitPrice: resolved?.unitPrice ?? p?.sellPrice ?? it.unitPrice,
                                          }
                                        : it
                                    )
                                  );
                                }}
                              >
                                {state.products.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.sku} — {p.name}
                                    {p.isService
                                      ? ' [Service / Non-Stok]'
                                      : ` (Stok: ${p.warehouseStocks[warehouseId] ?? 0})`}
                                  </option>
                                ))}
                              </NativeSelect>
                            )}

                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] pl-0.5">
                              {isSvc ? (
                                <span className="text-[#154C7E] font-medium">
                                  Service / Non-Stok · Tidak memengaruhi stok &amp; HPP
                                </span>
                              ) : (
                                <span
                                  className={`font-mono ${
                                    avail >= row.qty ? 'text-emerald-700' : 'text-red-600 font-semibold'
                                  }`}
                                >
                                  Stok gudang: {avail} {prod?.uomCode || ''}
                                </span>
                              )}
                              {contractCheck.isContractPrice && (
                                <span className="inline-flex items-center gap-1 font-medium text-[#8F670D]">
                                  <Tag className="h-3 w-3" />
                                  Harga kontrak diterapkan
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="col-span-4 md:col-span-1 space-y-1">
                            <Label className="text-[11px] text-slate-500 md:hidden">Qty</Label>
                            <Input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              aria-label={`Qty SO ${idx + 1}`}
                              value={row.qty === 0 ? '' : String(row.qty)}
                              onChange={(e) => {
                                const clean = sanitizeDigits(e.target.value);
                                const nextQty = clean ? Number(clean) : 0;
                                const resolved =
                                  prod && !isSvc
                                    ? resolveEffectiveUnitPrice(
                                        selectedCustomer,
                                        prod,
                                        Math.max(1, nextQty),
                                        currency,
                                        rate
                                      )
                                    : undefined;
                                setDraftItems((prev) =>
                                  prev.map((it, i) =>
                                    i === idx
                                      ? {
                                          ...it,
                                          qty: nextQty,
                                          unitPrice: resolved?.isContractPrice ? resolved.unitPrice : it.unitPrice,
                                        }
                                      : it
                                  )
                                );
                              }}
                              className="text-right font-mono tabular-nums"
                            />
                          </div>

                          <div className="col-span-8 md:col-span-1 space-y-1">
                            <Label className="text-[11px] text-slate-500 md:hidden">
                              {isSvc ? `Biaya (${currency})` : `Harga (${currency})`}
                            </Label>
                            <Input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              aria-label={`Harga SO ${idx + 1}`}
                              value={row.unitPrice === 0 ? '' : String(row.unitPrice)}
                              onChange={(e) => {
                                const clean = sanitizeDigits(e.target.value);
                                setDraftItems((prev) =>
                                  prev.map((it, i) =>
                                    i === idx ? { ...it, unitPrice: clean ? Number(clean) : 0 } : it
                                  )
                                );
                              }}
                              className="text-right font-mono tabular-nums"
                            />
                          </div>

                          <div className="col-span-12 md:col-span-1 flex items-center justify-between md:justify-end md:min-h-[40px] pt-1 md:pt-0 text-xs font-mono tabular-nums font-semibold text-[#0B1B3A]">
                            <span className="text-slate-500 font-sans font-normal md:hidden">Subtotal</span>
                            <span>{formatCurrency(lineTotal, currency)}</span>
                          </div>

                          <div className="hidden md:flex items-center justify-center md:min-h-[40px]">
                            {draftItems.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Hapus item SO ${idx + 1}`}
                                onClick={() =>
                                  setDraftItems((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {!stockCheck.sufficient && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs text-amber-800">
                    Stok gudang belum mencukupi untuk sebagian item — order akan disimpan sebagai Draft.
                  </div>
                )}
              </div>

              {/* Section 3: Notes */}
              <div className="border-t border-slate-100 pt-5 space-y-1.5">
                <Label htmlFor="so-notes">Catatan Order (Opsional)</Label>
                <Textarea
                  id="so-notes"
                  placeholder="Instruksi pengiriman, jadwal bongkar, atau catatan tambahan..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="min-h-[72px]"
                />
              </div>
            </DialogBody>

            <DialogFooter>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="text-slate-600">
                  Subtotal:{' '}
                  <strong className="font-mono tabular-nums text-[#0B1B3A]">
                    {formatCurrency(totals.subtotal, currency)}
                  </strong>
                </span>
                <span className="text-slate-600">
                  {companyIsPkp ? `PPN (${effectiveTaxRate}%)` : 'PPN (Non-PKP · 0%)'}:{' '}
                  <strong className="font-mono tabular-nums text-[#0B1B3A]">
                    {formatCurrency(totals.taxAmount, currency)}
                  </strong>
                </span>
                <span className="text-sm font-bold text-[#0B1B3A] font-mono tabular-nums">
                  Total: {formatCurrency(totals.totalAmount, currency)}
                </span>
              </div>
              <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 shrink-0">
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                  Batal
                </Button>
                <Button type="submit" variant="accent" disabled={!buyerEligibility.allowed}>
                  {stockCheck.sufficient ? 'Simpan & Konfirmasi SO' : 'Simpan sebagai Draft'}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* SO DETAIL + DELIVERY MODAL */}
      <Dialog open={!!selectedSo} onOpenChange={(open) => !open && setSelectedSoId(null)}>
        <DialogContent size="xl" structured>
          {selectedSo && (
            <>
              <DialogHeader structured>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <DialogTitle className="font-mono">{selectedSo.soNumber}</DialogTitle>
                    <DialogDescription>
                      {selectedSo.customerName} · Gudang: {selectedSo.warehouseName}
                    </DialogDescription>
                  </div>
                  <StatusLabel status={selectedSo.status} tone={getSoTone(selectedSo.status)} />
                </div>
              </DialogHeader>

              <DialogBody>

              {selectedSoCustomer && (
                <div className="rounded-lg border border-[#BFD9EF] bg-[#EBF3FA]/60 px-3 py-2.5 text-xs text-[#0B1B3A] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-[#1B5E99] shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold">Alamat Pengiriman: </span>
                      <span>{selectedSoCustomer.shippingAddress || selectedSoCustomer.address || '-'}</span>
                    </div>
                  </div>
                  <div className="text-[11px] font-medium shrink-0">
                    PIC Lapangan:{' '}
                    <strong>
                      {selectedSoCustomer.picWarehouseName || selectedSoCustomer.contactPerson || '-'}
                    </strong>{' '}
                    ({selectedSoCustomer.picWarehousePhone || selectedSoCustomer.phone || '-'})
                  </div>
                </div>
              )}

              {/* Mobile Line Items Cards */}
              <div className="space-y-2.5 md:hidden">
                {selectedSo.items.map((it) => {
                  const rem = Math.max(0, it.qty - it.fulfilledQty);
                  const isSvc = isServiceOrderItem(it, state.products);
                  return (
                    <div
                      key={`m_so_it_${it.productId}`}
                      className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-[#0B1B3A] flex items-center gap-1.5 flex-wrap">
                            <span>{it.productName}</span>
                            {isSvc && (
                              <span className="inline-flex px-1.5 py-0.5 rounded bg-[#EBF3FA] text-[#154C7E] text-[10px] font-semibold">
                                Non-Stok
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">{it.sku}</div>
                        </div>
                        <span className="font-mono font-semibold text-[#0B1B3A] shrink-0">
                          {formatCurrency(it.lineTotal, selectedSo.currency)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 rounded bg-[#F4F7FB] p-2 text-[11px]">
                        <div>
                          <span className="text-slate-500 block">Order</span>
                          <span className="font-mono font-semibold">
                            {it.qty} {it.uomCode}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-slate-500 block">Terkirim</span>
                          <span className="font-mono font-semibold text-[#1B5E99]">
                            {it.fulfilledQty} {it.uomCode}
                          </span>
                        </div>
                      </div>

                      {deliverMode && (
                        <div className="space-y-1 pt-1">
                          <Label className="text-[11px] text-[#0B1B3A]">
                            Kirim Sekarang (Sisa: {rem} {it.uomCode})
                          </Label>
                          <Input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={deliverQtys[it.productId] ?? '0'}
                            onChange={(e) =>
                              setDeliverQtys((prev) => ({
                                ...prev,
                                [it.productId]: sanitizeDigits(e.target.value),
                              }))
                            }
                            className="text-right font-mono tabular-nums"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Desktop Line Items Table */}
              <div className="hidden md:block border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2.5 px-3">Produk</th>
                      <th className="py-2.5 px-3 text-right">Order</th>
                      <th className="py-2.5 px-3 text-right">Terkirim</th>
                      <th className="py-2.5 px-3 text-right">Total</th>
                      {deliverMode && <th className="py-2.5 px-3 text-right">Kirim Sekarang</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedSo.items.map((it) => {
                      const rem = Math.max(0, it.qty - it.fulfilledQty);
                      const isSvc = isServiceOrderItem(it, state.products);
                      return (
                        <tr key={it.productId}>
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-slate-900 flex items-center gap-1.5 flex-wrap">
                              <span>{it.productName}</span>
                              {isSvc && (
                                <span className="inline-flex px-1.5 py-0.5 rounded bg-[#EBF3FA] text-[#154C7E] text-[10px] font-semibold">
                                  Non-Stok
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500">{it.sku}</div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {it.qty} {it.uomCode}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#1B5E99] font-semibold">
                            {it.fulfilledQty} {it.uomCode}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {formatCurrency(it.lineTotal, selectedSo.currency)}
                          </td>
                          {deliverMode && (
                            <td className="py-2.5 px-3 text-right">
                              <Input
                                type="number"
                                min={0}
                                max={rem}
                                value={deliverQtys[it.productId] ?? '0'}
                                onChange={(e) =>
                                  setDeliverQtys((prev) => ({
                                    ...prev,
                                    [it.productId]: e.target.value,
                                  }))
                                }
                                className="h-9 w-24 ml-auto text-right font-mono"
                              />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {selectedSo.podReceiverName && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2.5 text-xs text-emerald-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold">
                      e-POD Terverifikasi — Diterima oleh: {selectedSo.podReceiverName}
                    </div>
                    <div className="text-[11px] text-emerald-700 font-mono">
                      {(selectedSo.podTimestamp || '').slice(0, 16).replace('T', ' ')}
                      {selectedSo.podFileName ? ` · Bukti: ${selectedSo.podFileName}` : ''}
                    </div>
                  </div>
                  {isSafeDocumentUrl(selectedSo.podImageUrl) && (
                    <a
                      href={selectedSo.podImageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-[#1B5E99] hover:underline shrink-0"
                    >
                      Lihat Foto / Bukti e-POD
                    </a>
                  )}
                </div>
              )}

              {deliverMode && (
                <div className="space-y-3 bg-[#EBF3FA]/60 border border-[#BFD9EF] rounded-lg p-3.5 sm:p-4">
                  <div className="text-xs font-semibold text-[#0B1B3A]">
                    Konversi ke Delivery / Goods Issue &amp; e-POD Lapangan
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="so-pod-name" className="text-[11px]">Nama Penerima (e-POD)</Label>
                      <Input
                        id="so-pod-name"
                        placeholder="Nama penerima & jabatan di lokasi..."
                        value={podReceiverName}
                        onChange={(e) => setPodReceiverName(e.target.value)}
                        className="bg-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="so-pod-file" className="text-[11px]">Upload Foto / Bukti Serah Terima (JPG/PNG/PDF)</Label>
                      <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 min-h-[40px] text-xs cursor-pointer hover:bg-slate-50">
                        <Upload className="h-3.5 w-3.5 text-[#1B5E99] shrink-0" />
                        <span className="truncate text-slate-600">
                          {podFile ? podFile.name : 'Pilih foto e-POD / tanda terima...'}
                        </span>
                        <input
                          id="so-pod-file"
                          type="file"
                          accept="image/*,application/pdf"
                          className="sr-only"
                          onChange={(e) => setPodFile(e.target.files?.[0] || null)}
                        />
                      </label>
                    </div>
                  </div>
                  <Input
                    placeholder="Nomor resi ekspedisi / catatan surat jalan..."
                    value={deliverNotes}
                    onChange={(e) => setDeliverNotes(e.target.value)}
                    className="bg-white"
                  />
                  <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setDeliverMode(false)}>
                      Batal
                    </Button>
                    <Button
                      type="button"
                      variant="accent"
                      size="sm"
                      onClick={async () => {
                        const map: Record<string, number> = {};
                        Object.entries(deliverQtys).forEach(([k, v]) => {
                          map[k] = Number(v) || 0;
                        });
                        await erp.deliverSalesOrder(selectedSo.id, map, deliverNotes, {
                          receiverName: podReceiverName.trim() || undefined,
                          file: podFile,
                        });
                        setDeliverMode(false);
                        setSelectedSoId(null);
                      }}
                    >
                      <Truck className="h-4 w-4" />
                      Konfirmasi Pengiriman (Kurangi Stok)
                    </Button>
                  </div>
                </div>
              )}
              </DialogBody>

              {!deliverMode && (
                <DialogFooter className="sm:items-center">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const cust = state.customers.find((c) => c.id === selectedSo.customerId);
                        const wh = state.warehouses.find((w) => w.id === selectedSo.warehouseId);
                        openPrintPreview(
                          buildSalesOrderPrintDoc(selectedSo, state.settings, cust, wh),
                          () => exportSalesOrderPdf(selectedSo, state.settings, cust, wh)
                        );
                      }}
                    >
                      <Printer className="h-3.5 w-3.5 text-[#0B1B3A]" />
                      Cetak SO
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void exportSalesOrderPdf(
                          selectedSo,
                          state.settings,
                          state.customers.find((c) => c.id === selectedSo.customerId),
                          state.warehouses.find((w) => w.id === selectedSo.warehouseId)
                        )
                      }
                    >
                      <FileDown className="h-3.5 w-3.5 text-[#1B5E99]" />
                      PDF SO
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => exportSalesOrderCsv(selectedSo)}
                    >
                      <Download className="h-3.5 w-3.5 text-slate-700" />
                      CSV SO
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const cust = state.customers.find((c) => c.id === selectedSo.customerId);
                        const wh = state.warehouses.find((w) => w.id === selectedSo.warehouseId);
                        openPrintPreview(
                          buildSuratJalanPrintDoc(selectedSo, state.settings, cust, wh),
                          () => exportSuratJalanPdf(selectedSo, state.settings, cust, wh)
                        );
                      }}
                    >
                      <Printer className="h-3.5 w-3.5 text-[#D9AA32]" />
                      Cetak SJ
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void exportSuratJalanPdf(
                          selectedSo,
                          state.settings,
                          state.customers.find((c) => c.id === selectedSo.customerId),
                          state.warehouses.find((w) => w.id === selectedSo.warehouseId)
                        )
                      }
                    >
                      <Truck className="h-3.5 w-3.5 text-[#D9AA32]" />
                      Surat Jalan
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => exportSuratJalanCsv(selectedSo)}
                    >
                      <Download className="h-3.5 w-3.5 text-slate-700" />
                      CSV SJ
                    </Button>
                    {selectedSoInvoice && (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            openPrintPreview(
                              buildSalesInvoicePrintDoc(
                                selectedSoInvoice,
                                state.settings,
                                selectedSoCustomer,
                                selectedSo
                              ),
                              () =>
                                exportSalesInvoicePdf(
                                  selectedSoInvoice,
                                  state.settings,
                                  selectedSoCustomer,
                                  selectedSo
                                )
                            )
                          }
                        >
                          <Printer className="h-3.5 w-3.5 text-emerald-700" />
                          Cetak Invoice
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void exportSalesInvoicePdf(
                              selectedSoInvoice,
                              state.settings,
                              selectedSoCustomer,
                              selectedSo
                            )
                          }
                        >
                          <Receipt className="h-3.5 w-3.5 text-emerald-700" />
                          Invoice PDF
                        </Button>
                      </>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 shrink-0">
                    {canCreate && selectedSo.status === 'Draft' && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void erp.transitionSalesOrder(selectedSo.id, 'Confirmed')}
                      >
                        Konfirmasi SO
                      </Button>
                    )}
                    {canDeliver &&
                      ['Confirmed', 'Partially Delivered'].includes(selectedSo.status) && (
                        <Button
                          type="button"
                          variant="accent"
                          size="sm"
                          onClick={() => setDeliverMode(true)}
                        >
                          <Truck className="h-4 w-4" />
                          Proses Pengiriman
                        </Button>
                      )}
                    {canInvoice && selectedSo.status === 'Fully Delivered' && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void erp.transitionSalesOrder(selectedSo.id, 'Invoiced')}
                      >
                        <Receipt className="h-4 w-4" />
                        Terbitkan Invoice AR
                      </Button>
                    )}
                    {canInvoice && selectedSo.status === 'Invoiced' && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void erp.transitionSalesOrder(selectedSo.id, 'Closed')}
                      >
                        Tutup Sales Order
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmDeleteSo(selectedSo)}
                        className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Hapus SO
                      </Button>
                    )}
                  </div>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* CONFIRM DELETE SINGLE SO MODAL */}
      <Dialog open={!!confirmDeleteSo} onOpenChange={(open) => !open && setConfirmDeleteSo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus Sales Order?</DialogTitle>
            <DialogDescription>
              Dokumen Sales Order akan dihapus permanen dari sistem.
            </DialogDescription>
          </DialogHeader>
          {confirmDeleteSo && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
              <div className="font-mono font-semibold text-slate-900">{confirmDeleteSo.soNumber}</div>
              <div>Customer: {confirmDeleteSo.customerName}</div>
              <div>
                Status: {confirmDeleteSo.status} · Total:{' '}
                <span className="font-mono font-semibold">
                  {formatCurrency(confirmDeleteSo.totalAmount, confirmDeleteSo.currency)}
                </span>
              </div>
            </div>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={isDeleting}
              onClick={() => setConfirmDeleteSo(null)}
            >
              Batal
            </Button>
            <Button
              type="button"
              disabled={isDeleting}
              onClick={async () => {
                if (!confirmDeleteSo) return;
                setIsDeleting(true);
                try {
                  const targetId = confirmDeleteSo.id;
                  await erp.deleteSalesOrder(targetId);
                  if (selectedSoId === targetId) setSelectedSoId(null);
                  setConfirmDeleteSo(null);
                } finally {
                  setIsDeleting(false);
                }
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {isDeleting ? 'Menghapus...' : 'Ya, Hapus SO'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* CONFIRM CLEAR DUMMY SO MODAL */}
      <Dialog open={confirmDummyOpen} onOpenChange={setConfirmDummyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus Semua SO Dummy?</DialogTitle>
            <DialogDescription>
              Tindakan ini hanya menghapus {dummyTargets.soIds.length} Sales Order bawaan/dummy sistem. SO yang Anda buat sendiri tetap aman dan tidak terhapus.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={isDeleting}
              onClick={() => setConfirmDummyOpen(false)}
            >
              Batal
            </Button>
            <Button
              type="button"
              disabled={isDeleting}
              onClick={async () => {
                setIsDeleting(true);
                try {
                  await erp.clearDummySalesOrders();
                  setSelectedSoId(null);
                  setConfirmDummyOpen(false);
                } finally {
                  setIsDeleting(false);
                }
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {isDeleting ? 'Menghapus...' : 'Ya, Hapus SO Dummy'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* CREATE QUOTATION MODAL */}
      <Dialog open={qtOpen} onOpenChange={setQtOpen}>
        <DialogContent size="xl" structured>
          <DialogHeader structured>
            <DialogTitle>Buat Penawaran Harga (Sales Quotation)</DialogTitle>
            <DialogDescription>
              Harga kontrak khusus buyer otomatis diterapkan bila berlaku. Tambahkan produk atau jasa manual.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col flex-1 min-h-0"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await erp.saveSalesQuotation({
                isNew: true,
                customerId: qtCustomerId,
                warehouseId: qtWarehouseId,
                currency: qtCurrency,
                validUntil: qtValidUntil,
                notes: qtNotes,
                items: qtItems,
                sendImmediately: true,
              });
              if (ok) setQtOpen(false);
            }}
          >
            <DialogBody>
              <div className="space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Informasi Penawaran
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="qt-cus">Buyer / Customer</Label>
                    <NativeSelect
                      id="qt-cus"
                      value={qtCustomerId}
                      onChange={(e) => {
                        const cid = e.target.value;
                        setQtCustomerId(cid);
                        setQtItems((prev) => applyContractPricesToItems(prev, cid, qtCurrency));
                      }}
                    >
                      {state.customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="qt-wh">Gudang Sumber</Label>
                    <NativeSelect
                      id="qt-wh"
                      value={qtWarehouseId}
                      onChange={(e) => setQtWarehouseId(e.target.value)}
                    >
                      {state.warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5 sm:col-span-1 lg:col-span-2">
                    <Label htmlFor="qt-curr">Mata Uang</Label>
                    <NativeSelect
                      id="qt-curr"
                      value={qtCurrency}
                      onChange={(e) => {
                        const nextCurr = e.target.value as CurrencyCode;
                        setQtCurrency(nextCurr);
                        setQtItems((prev) => applyContractPricesToItems(prev, qtCustomerId, nextCurr));
                      }}
                    >
                      <option value="IDR">IDR (Rupiah)</option>
                      <option value="USD">USD (Dollar)</option>
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5 sm:col-span-1 lg:col-span-2">
                    <Label htmlFor="qt-valid">Berlaku Hingga</Label>
                    <Input
                      id="qt-valid"
                      type="date"
                      required
                      value={qtValidUntil}
                      onChange={(e) => setQtValidUntil(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Item Penawaran &amp; Jasa ({qtItems.length})
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setQtItems((prev) => [...prev, buildManualServiceRow()])}
                      className="border-[#BFD9EF] text-[#154C7E] hover:bg-[#EBF3FA]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Service
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const p = state.products[0];
                        if (!p) return;
                        const cus = state.customers.find((c) => c.id === qtCustomerId);
                        const res = resolveEffectiveUnitPrice(cus, p, 1, qtCurrency, rate);
                        setQtItems((prev) => [
                          ...prev,
                          {
                            productId: p.id,
                            qty: 1,
                            unitPrice: res.unitPrice,
                            isService: Boolean(p.isService),
                            isManualService: false,
                            productName: p.name,
                            sku: p.sku,
                            uomCode: p.uomCode,
                          },
                        ]);
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Tambah Produk
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
                  <div className="hidden md:grid md:grid-cols-[minmax(0,1fr)_88px_148px_132px_36px] gap-2.5 px-3.5 py-2.5 bg-slate-50/90 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <div>Produk / Jasa Manual</div>
                    <div className="text-right">Qty</div>
                    <div className="text-right">Harga ({qtCurrency})</div>
                    <div className="text-right">Subtotal</div>
                    <div />
                  </div>
                  <div className="divide-y divide-slate-100">
                    {qtItems.map((row, idx) => {
                      const prod = state.products.find((p) => p.id === row.productId);
                      const isManualSvc = Boolean(row.isManualService || (row.isService && !prod));
                      const isSvc = Boolean(row.isService || prod?.isService);
                      const lineTotal = (row.qty || 0) * (row.unitPrice || 0);
                      return (
                        <div
                          key={row.productId && isManualSvc ? row.productId : `qt_it_${idx}`}
                          className="p-3.5 md:py-3 md:px-3.5 grid grid-cols-12 md:grid-cols-[minmax(0,1fr)_88px_148px_132px_36px] gap-2.5 items-start"
                        >
                          <div className="col-span-12 md:col-span-1 space-y-1">
                            <div className="flex items-center justify-between md:hidden">
                              <Label className="text-[11px] text-slate-500">
                                {isManualSvc ? `Service #${idx + 1}` : `Produk #${idx + 1}`}
                              </Label>
                              {qtItems.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setQtItems((prev) => prev.filter((_, i) => i !== idx))}
                                  className="text-xs font-medium text-red-600 hover:underline cursor-pointer"
                                >
                                  Hapus
                                </button>
                              )}
                            </div>

                            {isManualSvc ? (
                              <Input
                                required
                                placeholder="Ketik nama jasa (misal: Jasa pengiriman, angkut, packing)"
                                value={row.productName || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setQtItems((prev) =>
                                    prev.map((it, i) => (i === idx ? { ...it, productName: val } : it))
                                  );
                                }}
                              />
                            ) : (
                              <NativeSelect
                                value={row.productId}
                                onChange={(e) => {
                                  const pid = e.target.value;
                                  const foundProd = state.products.find((p) => p.id === pid);
                                  const cus = state.customers.find((c) => c.id === qtCustomerId);
                                  const res =
                                    foundProd && !foundProd.isService
                                      ? resolveEffectiveUnitPrice(cus, foundProd, row.qty || 1, qtCurrency, rate)
                                      : undefined;
                                  setQtItems((prev) =>
                                    prev.map((it, i) =>
                                      i === idx
                                        ? {
                                            ...it,
                                            productId: pid,
                                            isService: Boolean(foundProd?.isService),
                                            isManualService: false,
                                            productName: foundProd?.name,
                                            sku: foundProd?.sku,
                                            uomCode: foundProd?.uomCode,
                                            unitPrice: res?.unitPrice ?? foundProd?.sellPrice ?? it.unitPrice,
                                          }
                                        : it
                                    )
                                  );
                                }}
                              >
                                {state.products.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.sku} — {p.name} {p.isService ? '[Service / Non-Stok]' : ''}
                                  </option>
                                ))}
                              </NativeSelect>
                            )}

                            {isSvc && (
                              <div className="text-[11px] text-[#154C7E] font-medium pl-0.5">
                                Service / Non-Stok · Tidak memengaruhi stok &amp; HPP
                              </div>
                            )}
                          </div>

                          <div className="col-span-4 md:col-span-1 space-y-1">
                            <Label className="text-[11px] text-slate-500 md:hidden">Qty</Label>
                            <Input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={row.qty === 0 ? '' : String(row.qty)}
                              onChange={(e) => {
                                const clean = sanitizeDigits(e.target.value);
                                const nextQty = clean ? Number(clean) : 0;
                                const cus = state.customers.find((c) => c.id === qtCustomerId);
                                const res =
                                  prod && !isSvc
                                    ? resolveEffectiveUnitPrice(cus, prod, Math.max(1, nextQty), qtCurrency, rate)
                                    : undefined;
                                setQtItems((prev) =>
                                  prev.map((it, i) =>
                                    i === idx
                                      ? {
                                          ...it,
                                          qty: nextQty,
                                          unitPrice: res?.isContractPrice ? res.unitPrice : it.unitPrice,
                                        }
                                      : it
                                  )
                                );
                              }}
                              className="text-right font-mono tabular-nums"
                            />
                          </div>

                          <div className="col-span-8 md:col-span-1 space-y-1">
                            <Label className="text-[11px] text-slate-500 md:hidden">
                              {isSvc ? `Biaya (${qtCurrency})` : `Harga (${qtCurrency})`}
                            </Label>
                            <Input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={row.unitPrice === 0 ? '' : String(row.unitPrice)}
                              onChange={(e) => {
                                const clean = sanitizeDigits(e.target.value);
                                setQtItems((prev) =>
                                  prev.map((it, i) =>
                                    i === idx ? { ...it, unitPrice: clean ? Number(clean) : 0 } : it
                                  )
                                );
                              }}
                              className="text-right font-mono tabular-nums"
                            />
                          </div>

                          <div className="col-span-12 md:col-span-1 flex items-center justify-between md:justify-end md:min-h-[40px] pt-1 md:pt-0 text-xs font-mono tabular-nums font-semibold text-[#0B1B3A]">
                            <span className="text-slate-500 font-sans font-normal md:hidden">Subtotal</span>
                            <span>{formatCurrency(lineTotal, qtCurrency)}</span>
                          </div>

                          <div className="hidden md:flex items-center justify-center md:min-h-[40px]">
                            {qtItems.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Hapus item quotation ${idx + 1}`}
                                onClick={() => setQtItems((prev) => prev.filter((_, i) => i !== idx))}
                                className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-5 space-y-1.5">
                <Label htmlFor="qt-notes">Ketentuan &amp; Catatan Penawaran</Label>
                <Textarea
                  id="qt-notes"
                  placeholder="Masa berlaku harga, syarat pengiriman, atau ketentuan pembayaran..."
                  value={qtNotes}
                  onChange={(e) => setQtNotes(e.target.value)}
                  className="min-h-[72px]"
                />
              </div>
            </DialogBody>

            <DialogFooter>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="text-slate-600">
                  Subtotal:{' '}
                  <strong className="font-mono tabular-nums text-[#0B1B3A]">
                    {formatCurrency(qtTotals.subtotal, qtCurrency)}
                  </strong>
                </span>
                <span className="text-slate-600">
                  {companyIsPkp ? `PPN (${effectiveTaxRate}%)` : 'PPN (Non-PKP · 0%)'}:{' '}
                  <strong className="font-mono tabular-nums text-[#0B1B3A]">
                    {formatCurrency(qtTotals.taxAmount, qtCurrency)}
                  </strong>
                </span>
                <span className="text-sm font-bold text-[#0B1B3A] font-mono tabular-nums">
                  Total: {formatCurrency(qtTotals.totalAmount, qtCurrency)}
                </span>
              </div>
              <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 shrink-0">
                <Button type="button" variant="outline" onClick={() => setQtOpen(false)}>
                  Batal
                </Button>
                <Button type="submit" variant="accent">
                  Simpan &amp; Terbitkan Quotation
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* CREATE SALES RETURN MODAL */}
      <Dialog open={retOpen} onOpenChange={setRetOpen}>
        <DialogContent size="lg" structured>
          <DialogHeader structured>
            <DialogTitle>Ajukan Retur Penjualan (Credit Note)</DialogTitle>
            <DialogDescription>
              Pilih Sales Order yang sudah dikirim untuk mencatat barang retur dari customer.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col flex-1 min-h-0"
            onSubmit={async (e) => {
              e.preventDefault();
              const items = Object.entries(retQtys)
                .map(([productId, qtyStr]) => ({ productId, qty: Number(qtyStr) || 0 }))
                .filter((x) => x.qty > 0);
              const ok = await erp.saveGoodsReturn({
                returnType: 'SALES_RETURN',
                referenceOrderId: retSoId,
                returnDate: retDate,
                reason: retReason,
                items,
              });
              if (ok) setRetOpen(false);
            }}
          >
            <DialogBody>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="sret-so">Referensi Sales Order</Label>
                  <NativeSelect
                    id="sret-so"
                    value={retSoId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setRetSoId(nextId);
                      const found = returnableSos.find((s) => s.id === nextId);
                      const map: Record<string, string> = {};
                      found?.items.forEach((it) => {
                        map[it.productId] = '0';
                      });
                      setRetQtys(map);
                    }}
                  >
                    {returnableSos.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.soNumber} — {s.customerName}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sret-date">Tanggal Retur</Label>
                  <Input
                    id="sret-date"
                    type="date"
                    required
                    value={retDate}
                    onChange={(e) => setRetDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-5 space-y-2.5">
                <Label>Kuantitas Item Diretur</Label>
                <div className="rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100 bg-white">
                  {(returnableSos.find((s) => s.id === retSoId)?.items || []).map((it) => (
                    <div
                      key={it.productId}
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-[#0B1B3A] truncate">{it.productName}</div>
                        <div className="text-[11px] font-mono text-slate-500">
                          Terkirim: {it.fulfilledQty} {it.uomCode}
                        </div>
                      </div>
                      <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={retQtys[it.productId] ?? '0'}
                        onChange={(e) =>
                          setRetQtys((prev) => ({
                            ...prev,
                            [it.productId]: sanitizeDigits(e.target.value),
                          }))
                        }
                        className="w-24 text-right font-mono tabular-nums"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-100 pt-5 space-y-1.5">
                <Label htmlFor="sret-reason">Alasan Retur *</Label>
                <Textarea
                  id="sret-reason"
                  required
                  placeholder="Contoh: Barang tidak sesuai spesifikasi PO / rusak pengiriman..."
                  value={retReason}
                  onChange={(e) => setRetReason(e.target.value)}
                />
              </div>
            </DialogBody>

            <DialogFooter className="sm:justify-end">
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 w-full sm:w-auto">
                <Button type="button" variant="outline" onClick={() => setRetOpen(false)}>
                  Batal
                </Button>
                <Button type="submit" variant="accent">
                  Simpan Dokumen Retur
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {/* CONFIRM DELETE QUOTATION / SALES RETURN DIALOG */}
      <Dialog open={!!confirmItemDelete} onOpenChange={(open) => !open && setConfirmItemDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmItemDelete?.title}</DialogTitle>
            <DialogDescription>{confirmItemDelete?.description}</DialogDescription>
          </DialogHeader>
          {confirmItemDelete && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-medium text-slate-800">
              {confirmItemDelete.detail}
            </div>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={isDeleting}
              onClick={() => setConfirmItemDelete(null)}
            >
              Batal
            </Button>
            <Button
              type="button"
              disabled={isDeleting}
              onClick={async () => {
                if (!confirmItemDelete) return;
                setIsDeleting(true);
                try {
                  await confirmItemDelete.onConfirm();
                  setConfirmItemDelete(null);
                } finally {
                  setIsDeleting(false);
                }
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {isDeleting ? 'Menghapus...' : 'Ya, Hapus Permanen'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

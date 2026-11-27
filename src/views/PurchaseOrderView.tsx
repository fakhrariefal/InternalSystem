import {
  AlertTriangle,
  Award,
  CheckCircle2,
  Download,
  GitCompare,
  PackageCheck,
  Plus,
  Printer,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { usePrintDocument } from '../components/PrintableDocumentModal';
import { BulkActionBar, SelectCheckbox } from '../components/ui/BulkActions';
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
import { useBulkSelection } from '../hooks/useBulkSelection';
import { useI18n } from '../lib/i18n';
import {
  calculateOrderTotals,
  computeThreeWayMatchStatus,
  convertToIdr,
  DEFAULT_MANAGER_APPROVAL_LIMIT_IDR,
  findSeededDummyOrderTargets,
  formatCurrency,
  getEffectiveTaxRatePercent,
  getPartnerVerificationStatus,
  isCompanyPkp,
  isServiceOrderItem,
  requiresDirectorApproval,
  validateSupplierForPurchaseOrder,
  type ThreeWayMatchStatus,
} from '../models/erpLogic';
import { hasPermission } from '../models/rbac';
import { buildPurchaseOrderPrintDoc } from '../models/printDocumentModel';
import { createInitialSeedState } from '../models/seedData';
import type {
  CurrencyCode,
  GoodsReturn,
  PoStatus,
  PurchaseOrder,
  VendorRfq,
} from '../models/types';
import {
  exportPurchaseOrderCsv,
  exportPurchaseOrderPdf,
  exportTableToCsv,
} from '../services/exportService';

function getPoStatusTone(status: PoStatus): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'Approved by Manager':
    case 'Ordered':
      return 'info';
    case 'Partially Received':
    case 'Submitted':
      return 'warning';
    case 'Fully Received':
    case 'Closed':
      return 'success';
    case 'Cancelled':
      return 'danger';
    default:
      return 'neutral';
  }
}

function getMatchTone(status: ThreeWayMatchStatus): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'MATCHED':
      return 'success';
    case 'PARTIAL_GR':
      return 'info';
    case 'VARIANCE':
      return 'danger';
    default:
      return 'neutral';
  }
}

function getReturnTone(status: GoodsReturn['status']): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'Completed') return 'success';
  if (status === 'Cancelled') return 'danger';
  return 'warning';
}

function sanitizeDigits(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  return digits.replace(/^0+(?=\d)/, '');
}

export function PurchaseOrderView({ erp }: { erp: ErpController }) {
  const { state, currentUser } = erp;
  const { tr } = useI18n();
  const { openPrintPreview } = usePrintDocument();
  const canCreate = hasPermission(currentUser?.role, 'po:create');
  const canApprove = hasPermission(currentUser?.role, 'po:approve');
  const canApproveDirector = hasPermission(currentUser?.role, 'director:approve');
  const canReceive = hasPermission(currentUser?.role, 'po:receive');
  const canClose = hasPermission(currentUser?.role, 'po:close');
  const canRfq = hasPermission(currentUser?.role, 'rfq:write');
  const canReturn = hasPermission(currentUser?.role, 'return:write');
  const canCompleteReturn = hasPermission(currentUser?.role, 'accounting:write');
  const canDelete = hasPermission(currentUser?.role, 'master:users');

  const rate = state.settings.defaultExchangeRateUsdIdr || 16250;
  const managerLimitIdr =
    state.settings.managerApprovalLimitIdr ?? DEFAULT_MANAGER_APPROVAL_LIMIT_IDR;

  const [activeTab, setActiveTab] = useState('orders');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null);
  const [confirmDeletePo, setConfirmDeletePo] = useState<PurchaseOrder | null>(null);
  const [confirmItemDelete, setConfirmItemDelete] = useState<{
    title: string;
    description: string;
    detail: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [confirmDummyOpen, setConfirmDummyOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [receiveMode, setReceiveMode] = useState(false);
  const [receiveQtys, setReceiveQtys] = useState<Record<string, string>>({});
  const [receiveNotes, setReceiveNotes] = useState('');

  type DraftPoRow = {
    productId: string;
    qty: number;
    unitPrice: number;
    isService?: boolean;
    isManualService?: boolean;
    productName?: string;
    sku?: string;
    uomCode?: string;
  };

  // Create PO form
  const [supplierId, setSupplierId] = useState(state.suppliers[0]?.id || '');
  const [warehouseId, setWarehouseId] = useState(state.warehouses[0]?.id || '');
  const [currency, setCurrency] = useState<CurrencyCode>('IDR');
  const [expectedDate, setExpectedDate] = useState('2026-12-15');
  const [notes, setNotes] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [draftItems, setDraftItems] = useState<DraftPoRow[]>([
    {
      productId: state.products[0]?.id || '',
      qty: 10,
      unitPrice: state.products[0]?.buyPrice || 100000,
    },
  ]);

  const buildPoManualServiceRow = (): DraftPoRow => ({
    productId: `svc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    qty: 1,
    unitPrice: 0,
    isService: true,
    isManualService: true,
    productName: '',
    sku: 'SRV-MANUAL',
    uomCode: 'JASA',
  });

  // RFQ Create & Quote Dialogs
  const [rfqCreateOpen, setRfqCreateOpen] = useState(false);
  const [rfqTitle, setRfqTitle] = useState('');
  const [rfqWarehouseId, setRfqWarehouseId] = useState(state.warehouses[0]?.id || '');
  const [rfqDeadline, setRfqDeadline] = useState('2026-12-20');
  const [rfqNotes, setRfqNotes] = useState('');
  const [rfqSupplierIds, setRfqSupplierIds] = useState<string[]>(
    state.suppliers.slice(0, 2).map((s) => s.id)
  );
  const [rfqItems, setRfqItems] = useState<Array<{ productId: string; qty: number; unitPrice: number }>>([
    {
      productId: state.products[0]?.id || '',
      qty: 10,
      unitPrice: state.products[0]?.buyPrice || 100000,
    },
  ]);

  const [quoteModalRfq, setQuoteModalRfq] = useState<VendorRfq | null>(null);
  const [quoteSupplierId, setQuoteSupplierId] = useState(state.suppliers[0]?.id || '');
  const [quoteCurrency, setQuoteCurrency] = useState<CurrencyCode>('IDR');
  const [quoteLeadDays, setQuoteLeadDays] = useState('5');
  const [quoteNotes, setQuoteNotes] = useState('');
  const [quotePrices, setQuotePrices] = useState<Record<string, string>>({});

  // Purchase Return Dialog
  const [returnOpen, setReturnOpen] = useState(false);
  const [retPoId, setRetPoId] = useState('');
  const [retDate, setRetDate] = useState(new Date().toISOString().slice(0, 10));
  const [retReason, setRetReason] = useState('');
  const [retQtys, setRetQtys] = useState<Record<string, string>>({});

  const selectedPo: PurchaseOrder | undefined = state.purchaseOrders.find(
    (p) => p.id === selectedPoId
  );

  const filteredPos = state.purchaseOrders.filter((p) =>
    statusFilter === 'ALL' ? true : p.status === statusFilter
  );

  const purchaseReturns = useMemo(
    () => state.goodsReturns.filter((r) => r.returnType === 'PURCHASE_RETURN'),
    [state.goodsReturns]
  );

  const returnablePos = useMemo(
    () =>
      state.purchaseOrders.filter((p) =>
        ['Partially Received', 'Fully Received', 'Closed'].includes(p.status)
      ),
    [state.purchaseOrders]
  );

  const poIds = useMemo(() => filteredPos.map((p) => p.id), [filteredPos]);
  const poSelection = useBulkSelection(poIds);
  const rfqIds = useMemo(() => state.vendorRfqs.map((r) => r.id), [state.vendorRfqs]);
  const rfqSelection = useBulkSelection(rfqIds);
  const returnIds = useMemo(() => purchaseReturns.map((r) => r.id), [purchaseReturns]);
  const returnSelection = useBulkSelection(returnIds);

  const selectedPos = useMemo(() => poSelection.pickSelected(filteredPos), [filteredPos, poSelection]);
  const selectedSubmittedPoIds = useMemo(
    () => selectedPos.filter((p) => p.status === 'Submitted').map((p) => p.id),
    [selectedPos]
  );
  const selectedReturns = useMemo(
    () => returnSelection.pickSelected(purchaseReturns),
    [purchaseReturns, returnSelection]
  );
  const selectedPendingReturnIds = useMemo(
    () => selectedReturns.filter((r) => r.status === 'Pending').map((r) => r.id),
    [selectedReturns]
  );

  const exportSelectedPos = () => {
    if (selectedPos.length === 0) return;
    exportTableToCsv(
      `Purchase_Orders_Terpilih_${new Date().toISOString().slice(0, 10)}`,
      ['No. PO', 'Supplier', 'Gudang', 'Target Kirim', 'Mata Uang', 'Total', 'Status'],
      selectedPos.map((p) => [
        p.poNumber || '-',
        p.supplierName || '-',
        p.warehouseName || '-',
        p.expectedDate || '-',
        p.currency || 'IDR',
        p.totalAmount ?? 0,
        p.status || '-',
      ])
    );
    toast.success(`${selectedPos.length} Purchase Order diekspor ke CSV.`);
  };

  const exportSelectedRfqs = () => {
    const picked = rfqSelection.pickSelected(state.vendorRfqs);
    if (picked.length === 0) return;
    exportTableToCsv(
      `Vendor_RFQ_Terpilih_${new Date().toISOString().slice(0, 10)}`,
      ['No. RFQ', 'Judul', 'Gudang', 'Deadline', 'Penawaran Masuk', 'Status', 'PO Terbit'],
      picked.map((r) => [
        r.rfqNumber,
        r.title,
        r.warehouseName || r.warehouseId,
        r.deadlineDate,
        r.quotes.length,
        r.status,
        r.awardedPoNumber || '-',
      ])
    );
    toast.success(`${picked.length} Vendor RFQ diekspor ke CSV.`);
  };

  const exportSelectedReturns = () => {
    if (selectedReturns.length === 0) return;
    exportTableToCsv(
      `Retur_Pembelian_Terpilih_${new Date().toISOString().slice(0, 10)}`,
      ['No. Retur', 'Ref PO', 'Supplier', 'Tanggal', 'Alasan', 'Mata Uang', 'Total', 'Status'],
      selectedReturns.map((r) => [
        r.returnNumber,
        r.referenceOrderNumber,
        r.counterpartyName,
        r.returnDate,
        r.reason,
        r.currency,
        r.totalAmount,
        r.status,
      ])
    );
    toast.success(`${selectedReturns.length} Retur Pembelian diekspor ke CSV.`);
  };

  const companyIsPkp = isCompanyPkp(state.settings);
  const effectiveTaxRate = getEffectiveTaxRatePercent(state.settings);
  const previewTotals = calculateOrderTotals(draftItems, effectiveTaxRate);
  const selectedSupplier = state.suppliers.find((s) => s.id === supplierId);
  const previewTotalIdr = convertToIdr(previewTotals.totalAmount, currency, rate);
  const previewNeedsDirector = requiresDirectorApproval(previewTotalIdr, managerLimitIdr);
  const supplierEligibility = selectedSupplier
    ? validateSupplierForPurchaseOrder({
        supplier: selectedSupplier,
        totalAmountIdr: previewTotalIdr,
      })
    : { allowed: true };

  const openPoDetail = (po: PurchaseOrder, openGr: boolean = false) => {
    setSelectedPoId(po.id);
    setReceiveMode(openGr);
    const defaults: Record<string, string> = {};
    po.items.forEach((it) => {
      defaults[it.productId] = String(Math.max(0, it.qty - it.fulfilledQty));
    });
    setReceiveQtys(defaults);
    setReceiveNotes('');
  };

  const dummyTargets = useMemo(
    () => findSeededDummyOrderTargets(state, createInitialSeedState()),
    [state]
  );

  const openCreateModal = () => {
    if (!supplierId && state.suppliers[0]) setSupplierId(state.suppliers[0].id);
    if (!warehouseId && state.warehouses[0]) setWarehouseId(state.warehouses[0].id);
    if ((!draftItems[0]?.productId || draftItems.length === 0) && state.products[0]) {
      setDraftItems([
        {
          productId: state.products[0].id,
          qty: 10,
          unitPrice: state.products[0].buyPrice || 100000,
        },
      ]);
    }
    setCreateOpen(true);
  };

  const openQuoteModal = (rfq: VendorRfq) => {
    setQuoteModalRfq(rfq);
    const defaultSup =
      rfq.invitedSupplierIds[0] || state.suppliers[0]?.id || '';
    setQuoteSupplierId(defaultSup);
    const sup = state.suppliers.find((s) => s.id === defaultSup);
    setQuoteCurrency(sup?.defaultCurrency || 'IDR');
    setQuoteLeadDays('5');
    setQuoteNotes('');
    const priceDefaults: Record<string, string> = {};
    rfq.items.forEach((it) => {
      priceDefaults[it.productId] = String(it.unitPrice || 0);
    });
    setQuotePrices(priceDefaults);
  };

  const openReturnCreateModal = () => {
    const firstPo = returnablePos[0] || state.purchaseOrders[0];
    setRetPoId(firstPo?.id || '');
    setRetDate(new Date().toISOString().slice(0, 10));
    setRetReason('');
    const initQtys: Record<string, string> = {};
    firstPo?.items.forEach((it) => {
      initQtys[it.productId] = '0';
    });
    setRetQtys(initQtys);
    setReturnOpen(true);
  };

  const activeRetPo = state.purchaseOrders.find((p) => p.id === retPoId);
  const selectedPoMatch = selectedPo
    ? computeThreeWayMatchStatus(selectedPo, state.invoices, rate)
    : null;
  const selectedPoTotalIdr = selectedPo
    ? convertToIdr(selectedPo.totalAmount, selectedPo.currency, selectedPo.exchangeRate || rate)
    : 0;
  const selectedPoNeedsDirector = selectedPo
    ? selectedPo.approvalTierRequired === 'Direktur' ||
      requiresDirectorApproval(selectedPoTotalIdr, managerLimitIdr)
    : false;

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-[#0B1B3A]">
            {tr('Pengadaan, RFQ & Retur Pembelian', 'Procurement, Vendor RFQ & Purchase Returns')}
          </h2>
          <p className="text-xs sm:text-sm text-slate-600">
            {tr(
              'Komparasi harga vendor (RFQ), approval bertingkat Manager/Direktur, 3-Way Matching, hingga retur ke supplier.',
              'Vendor RFQ price comparison, tiered Manager/Director approval, 3-Way Matching, and supplier returns.'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canDelete && dummyTargets.poIds.length > 0 && activeTab === 'orders' && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmDummyOpen(true)}
              className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 whitespace-nowrap flex-1 sm:flex-none"
            >
              <Trash2 className="h-4 w-4" />
              {tr('Hapus Dummy', 'Remove Sample')} ({dummyTargets.poIds.length})
            </Button>
          )}
          {canRfq && activeTab === 'rfq' && (
            <Button
              type="button"
              variant="accent"
              size="sm"
              onClick={() => {
                if (!rfqWarehouseId && state.warehouses[0]) setRfqWarehouseId(state.warehouses[0].id);
                if ((!rfqItems[0]?.productId || rfqItems.length === 0) && state.products[0]) {
                  setRfqItems([
                    {
                      productId: state.products[0].id,
                      qty: 10,
                      unitPrice: state.products[0].buyPrice || 100000,
                    },
                  ]);
                }
                setRfqCreateOpen(true);
              }}
              className="flex-1 sm:flex-none"
            >
              <Plus className="h-4 w-4" />
              {tr('Buat Vendor RFQ', 'Create Vendor RFQ')}
            </Button>
          )}
          {canReturn && activeTab === 'returns' && (
            <Button
              type="button"
              variant="accent"
              size="sm"
              onClick={openReturnCreateModal}
              className="flex-1 sm:flex-none"
            >
              <RotateCcw className="h-4 w-4" />
              {tr('Buat Retur Pembelian', 'Create Purchase Return')}
            </Button>
          )}
          {canCreate && activeTab === 'orders' && (
            <Button
              type="button"
              variant="accent"
              size="sm"
              onClick={openCreateModal}
              className="flex-1 sm:flex-none"
            >
              <Plus className="h-4 w-4" />
              {tr('Buat Purchase Order', 'Create Purchase Order')}
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="orders">
            {tr('Daftar PO', 'Purchase Orders')} ({state.purchaseOrders.length})
          </TabsTrigger>
          <TabsTrigger value="rfq">
            {tr('Vendor RFQ & Perbandingan', 'Vendor RFQ & Matrix')} ({state.vendorRfqs.length})
          </TabsTrigger>
          <TabsTrigger value="returns">
            {tr('Retur Pembelian', 'Purchase Returns')} ({purchaseReturns.length})
          </TabsTrigger>
        </TabsList>

        {/* =============================================================== */}
        {/* TAB 1: PURCHASE ORDERS                                          */}
        {/* =============================================================== */}
        <TabsContent value="orders" className="space-y-4">
          <div className="flex flex-nowrap overflow-x-auto no-scrollbar max-w-full sm:flex-wrap items-center gap-1.5 bg-[#EBF3FA]/70 border border-slate-200/80 p-1 rounded-lg sm:w-fit">
            {[
              'ALL',
              'Draft',
              'Submitted',
              'Approved by Manager',
              'Ordered',
              'Partially Received',
              'Fully Received',
              'Closed',
            ].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 min-h-[38px] rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer shrink-0 ${
                  statusFilter === st
                    ? 'bg-[#0B1B3A] text-white shadow-xs'
                    : 'text-slate-600 hover:text-[#0B1B3A]'
                }`}
              >
                {st === 'ALL' ? 'Semua Status' : st}
              </button>
            ))}
          </div>

          {filteredPos.length > 0 && (
            <div className="flex items-center justify-between gap-2 md:hidden px-1">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <SelectCheckbox
                  checked={poSelection.allVisibleSelected}
                  indeterminate={poSelection.someVisibleSelected}
                  onChange={poSelection.toggleAllVisible}
                  ariaLabel="Pilih semua Purchase Order"
                />
                <span>Pilih Semua ({filteredPos.length})</span>
              </label>
            </div>
          )}

          <BulkActionBar
            selectedCount={poSelection.selectedCount}
            itemLabel="Purchase Order"
            onClear={poSelection.clearSelection}
            actions={[
              {
                id: 'export-po-csv',
                label: 'Export Terpilih CSV',
                icon: <Download className="h-3.5 w-3.5" />,
                variant: 'outline',
                onClick: exportSelectedPos,
              },
              ...(canApprove && selectedSubmittedPoIds.length > 0
                ? [
                    {
                      id: 'approve-po-bulk',
                      label: `Setujui PO (${selectedSubmittedPoIds.length})`,
                      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
                      variant: 'accent' as const,
                      onClick: async () => {
                        await erp.bulkApprovePurchaseOrders(selectedSubmittedPoIds);
                        poSelection.clearSelection();
                      },
                    },
                  ]
                : []),
              ...(canDelete
                ? [
                    {
                      id: 'delete-po-bulk',
                      label: 'Hapus Terpilih',
                      icon: <Trash2 className="h-3.5 w-3.5" />,
                      variant: 'destructive' as const,
                      requiresConfirm: true,
                      confirmLabel: `Konfirmasi Hapus (${poSelection.selectedCount})`,
                      onClick: async () => {
                        await erp.bulkDeletePurchaseOrders(Array.from(poSelection.selectedIds));
                        poSelection.clearSelection();
                      },
                    },
                  ]
                : []),
            ]}
          />

          {/* Mobile PO Cards */}
          <div className="space-y-3 md:hidden max-h-[540px] overflow-y-auto pr-1">
            {filteredPos.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-xs text-slate-500">
                  Belum ada data Purchase Order.
                </CardContent>
              </Card>
            ) : (
              filteredPos.map((po) => {
                const match = computeThreeWayMatchStatus(po, state.invoices, rate);
                const poIdr = convertToIdr(po.totalAmount, po.currency, po.exchangeRate || rate);
                const tier =
                  po.approvalTierRequired ||
                  (requiresDirectorApproval(poIdr, managerLimitIdr) ? 'Direktur' : 'Manager');
                const canRecvPo =
                  canReceive &&
                  ['Approved by Manager', 'Ordered', 'Partially Received'].includes(po.status);
                return (
                  <Card key={`m_po_${po.id}`} className={poSelection.isSelected(po.id) ? 'border-[#1B5E99] bg-[#F4F8FC]' : ''}>
                    <CardContent className="p-4 space-y-3 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                          <SelectCheckbox
                            checked={poSelection.isSelected(po.id)}
                            onChange={() => poSelection.toggleOne(po.id)}
                            ariaLabel={`Pilih PO ${po.poNumber}`}
                            className="mt-0.5"
                          />
                          <div className="min-w-0">
                            <div className="font-mono font-bold text-[#0B1B3A] text-sm">
                              {po.poNumber}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {po.items.length} item · Target {po.expectedDate || '-'} · Tier {tier}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <StatusLabel status={po.status} tone={getPoStatusTone(po.status)} />
                          <StatusLabel status={`3W: ${match.status}`} tone={getMatchTone(match.status)} />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="font-semibold text-[#0B1B3A]">{po.supplierName}</div>
                        <div className="text-[11px] text-slate-500">Gudang: {po.warehouseName}</div>
                      </div>

                      <div className="flex items-center justify-between rounded-lg bg-[#F4F7FB] px-3 py-2.5">
                        <span className="text-[11px] text-slate-500">Total PO</span>
                        <span className="font-mono tabular-nums font-bold text-[#0B1B3A] text-sm">
                          {formatCurrency(po.totalAmount, po.currency)}
                        </span>
                      </div>

                      <div className={canRecvPo ? 'grid grid-cols-2 gap-2 pt-1' : 'pt-1'}>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className={canRecvPo ? '' : 'w-full'}
                          onClick={() => openPoDetail(po, false)}
                        >
                          Detail PO
                        </Button>
                        {canRecvPo && (
                          <Button
                            type="button"
                            variant="accent"
                            size="sm"
                            onClick={() => openPoDetail(po, true)}
                          >
                            <PackageCheck className="h-3.5 w-3.5" />
                            Terima Barang
                          </Button>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={`Cetak Preview PO ${po.poNumber}`}
                            onClick={() => {
                              const sup = state.suppliers.find((s) => s.id === po.supplierId);
                              openPrintPreview(
                                buildPurchaseOrderPrintDoc(po, state.settings, sup),
                                () => exportPurchaseOrderPdf(po, state.settings, sup)
                              );
                            }}
                          >
                            <Printer className="h-3.5 w-3.5 text-[#0B1B3A]" />
                            Cetak Preview
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => exportPurchaseOrderCsv(po)}
                          >
                            <Download className="h-3.5 w-3.5 text-slate-600" />
                            CSV
                          </Button>
                        </div>
                        {canDelete && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Hapus PO ${po.poNumber}`}
                            onClick={() => setConfirmDeletePo(po)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Hapus
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>

          {/* Desktop PO Table */}
          <Card className="hidden md:block">
            <div className="max-h-[500px] overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 pl-4 pr-2 w-10">
                      <SelectCheckbox
                        checked={poSelection.allVisibleSelected}
                        indeterminate={poSelection.someVisibleSelected}
                        onChange={poSelection.toggleAllVisible}
                        ariaLabel="Pilih semua Purchase Order"
                      />
                    </th>
                    <th className="py-3 px-4 font-semibold">Nomor PO</th>
                    <th className="py-3 px-3 font-semibold">Supplier</th>
                    <th className="py-3 px-3 font-semibold">Gudang Tujuan</th>
                    <th className="py-3 px-3 font-semibold">Target Kirim</th>
                    <th className="py-3 px-3 font-semibold text-right">Total</th>
                    <th className="py-3 px-3 font-semibold">3-Way Match</th>
                    <th className="py-3 px-3 font-semibold">Status &amp; Tier</th>
                    <th className="py-3 px-4 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPos.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-500">
                        Belum ada data Purchase Order.
                      </td>
                    </tr>
                  ) : (
                    filteredPos.map((po) => {
                      const match = computeThreeWayMatchStatus(po, state.invoices, rate);
                      const poIdr = convertToIdr(
                        po.totalAmount,
                        po.currency,
                        po.exchangeRate || rate
                      );
                      const tier =
                        po.approvalTierRequired ||
                        (requiresDirectorApproval(poIdr, managerLimitIdr) ? 'Direktur' : 'Manager');
                      return (
                        <tr key={po.id} className={poSelection.isSelected(po.id) ? 'bg-[#F0F6FC]' : 'hover:bg-slate-50/70'}>
                          <td className="py-3 pl-4 pr-2">
                            <SelectCheckbox
                              checked={poSelection.isSelected(po.id)}
                              onChange={() => poSelection.toggleOne(po.id)}
                              ariaLabel={`Pilih PO ${po.poNumber}`}
                            />
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-mono font-semibold text-slate-900">
                              {po.poNumber}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {po.items.length} item · Tier {tier}
                            </div>
                          </td>
                          <td className="py-3 px-3 font-medium text-slate-800">{po.supplierName}</td>
                          <td className="py-3 px-3 text-slate-600">{po.warehouseName}</td>
                          <td className="py-3 px-3 font-mono tabular-nums text-slate-600">
                            {po.expectedDate || '-'}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold">
                            {formatCurrency(po.totalAmount, po.currency)}
                          </td>
                          <td className="py-3 px-3">
                            <StatusLabel status={match.status} tone={getMatchTone(match.status)} />
                          </td>
                          <td className="py-3 px-3">
                            <StatusLabel status={po.status} tone={getPoStatusTone(po.status)} />
                          </td>
                          <td className="py-3 px-4 text-right space-x-1 whitespace-nowrap">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              aria-label={`Cetak Preview PO ${po.poNumber}`}
                              onClick={() => {
                                const sup = state.suppliers.find((s) => s.id === po.supplierId);
                                openPrintPreview(
                                  buildPurchaseOrderPrintDoc(po, state.settings, sup),
                                  () => exportPurchaseOrderPdf(po, state.settings, sup)
                                );
                              }}
                            >
                              <Printer className="h-3.5 w-3.5 text-[#0B1B3A]" />
                              Cetak Preview
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              aria-label={`Export CSV ${po.poNumber}`}
                              onClick={() => exportPurchaseOrderCsv(po)}
                            >
                              <Download className="h-3.5 w-3.5 text-slate-600" />
                              CSV
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openPoDetail(po, false)}
                            >
                              Detail
                            </Button>
                            {canReceive &&
                              ['Approved by Manager', 'Ordered', 'Partially Received'].includes(
                                po.status
                              ) && (
                                <Button
                                  type="button"
                                  variant="accent"
                                  size="sm"
                                  onClick={() => openPoDetail(po, true)}
                                >
                                  <PackageCheck className="h-3.5 w-3.5" />
                                  Terima Barang
                                </Button>
                              )}
                            {canDelete && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                aria-label={`Hapus PO ${po.poNumber}`}
                                onClick={() => setConfirmDeletePo(po)}
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
        </TabsContent>

        {/* =============================================================== */}
        {/* TAB 2: VENDOR RFQ & COMPARISON MATRIX                           */}
        {/* =============================================================== */}
        <TabsContent value="rfq" className="space-y-4">
          {state.vendorRfqs.length > 0 && (
            <div className="flex items-center justify-between gap-2 px-1">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <SelectCheckbox
                  checked={rfqSelection.allVisibleSelected}
                  indeterminate={rfqSelection.someVisibleSelected}
                  onChange={rfqSelection.toggleAllVisible}
                  ariaLabel="Pilih semua Vendor RFQ"
                />
                <span>Pilih Semua RFQ ({state.vendorRfqs.length})</span>
              </label>
            </div>
          )}

          <BulkActionBar
            selectedCount={rfqSelection.selectedCount}
            itemLabel="Vendor RFQ"
            onClear={rfqSelection.clearSelection}
            actions={[
              {
                id: 'export-rfq-csv',
                label: 'Export Terpilih CSV',
                icon: <Download className="h-3.5 w-3.5" />,
                variant: 'outline',
                onClick: exportSelectedRfqs,
              },
              ...(canDelete
                ? [
                    {
                      id: 'delete-rfq-bulk',
                      label: 'Hapus Terpilih',
                      icon: <Trash2 className="h-3.5 w-3.5" />,
                      variant: 'destructive' as const,
                      requiresConfirm: true,
                      confirmLabel: `Konfirmasi Hapus (${rfqSelection.selectedCount})`,
                      onClick: async () => {
                        await erp.bulkDeleteVendorRfqs(Array.from(rfqSelection.selectedIds));
                        rfqSelection.clearSelection();
                      },
                    },
                  ]
                : []),
            ]}
          />

          {state.vendorRfqs.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-xs text-slate-500">
                Belum ada permintaan penawaran vendor (RFQ). Klik &ldquo;Buat Vendor RFQ&rdquo; untuk memulai perbandingan harga beberapa supplier.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4 max-h-[560px] overflow-y-auto pr-1">
              {state.vendorRfqs.map((rfq) => {
                const quoteMetrics = rfq.quotes.map((q) => {
                  const totalOrigin = rfq.items.reduce(
                    (s, it) => s + it.qty * Number(q.unitPrices[it.productId] ?? it.unitPrice),
                    0
                  );
                  const totalIdr = convertToIdr(totalOrigin, q.currency, rate);
                  return { quote: q, totalOrigin, totalIdr };
                });
                const minIdr =
                  quoteMetrics.length > 0 ? Math.min(...quoteMetrics.map((m) => m.totalIdr)) : 0;
                const minLead =
                  quoteMetrics.length > 0
                    ? Math.min(...quoteMetrics.map((m) => m.quote.leadTimeDays))
                    : 0;

                return (
                  <Card key={rfq.id} className={rfqSelection.isSelected(rfq.id) ? 'border-[#1B5E99] bg-[#F4F8FC]' : ''}>
                    <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <SelectCheckbox
                            checked={rfqSelection.isSelected(rfq.id)}
                            onChange={() => rfqSelection.toggleOne(rfq.id)}
                            ariaLabel={`Pilih RFQ ${rfq.rfqNumber}`}
                          />
                          <span className="font-mono font-bold text-[#0B1B3A]">{rfq.rfqNumber}</span>
                          <StatusLabel
                            status={rfq.status}
                            tone={
                              rfq.status === 'Awarded'
                                ? 'success'
                                : rfq.status === 'Open'
                                ? 'info'
                                : rfq.status === 'Cancelled'
                                ? 'danger'
                                : 'neutral'
                            }
                          />
                          {rfq.awardedPoNumber && (
                            <span className="text-xs font-mono font-semibold text-emerald-700">
                              PO Terbit: {rfq.awardedPoNumber}
                            </span>
                          )}
                        </div>
                        <CardTitle className="mt-1">{rfq.title}</CardTitle>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Gudang: {rfq.warehouseName || rfq.warehouseId} · Deadline:{' '}
                          <span className="font-mono">{rfq.deadlineDate}</span> ·{' '}
                          {rfq.quotes.length} Penawaran Masuk
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {canRfq && rfq.status !== 'Awarded' && rfq.status !== 'Cancelled' && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openQuoteModal(rfq)}
                          >
                            <GitCompare className="h-4 w-4 text-[#1B5E99]" />
                            Input Penawaran Vendor
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Hapus RFQ ${rfq.rfqNumber}`}
                            onClick={() =>
                              setConfirmItemDelete({
                                title: 'Hapus Vendor RFQ?',
                                description: 'Data RFQ beserta riwayat penawaran vendor akan dihapus permanen.',
                                detail: `${rfq.rfqNumber} — ${rfq.title}`,
                                onConfirm: async () => {
                                  await erp.deleteVendorRfq(rfq.id);
                                },
                              })
                            }
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Hapus RFQ
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {quoteMetrics.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500 text-center">
                          Belum ada penawaran harga vendor tercatat. Klik &ldquo;Input Penawaran Vendor&rdquo; untuk memasukkan harga dari supplier.
                        </div>
                      ) : (
                        <>
                          {/* Mobile quote comparison cards */}
                          <div className="space-y-2.5 md:hidden">
                            {quoteMetrics.map(({ quote, totalOrigin, totalIdr }) => {
                              const isCheapest = totalIdr === minIdr;
                              const isFastest = quote.leadTimeDays === minLead;
                              const isWinner = rfq.awardedSupplierId === quote.supplierId;
                              return (
                                <div
                                  key={`m_q_${rfq.id}_${quote.supplierId}`}
                                  className="rounded-lg border border-slate-200 bg-[#F4F7FB] p-3 space-y-2 text-xs"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <div className="font-bold text-[#0B1B3A]">
                                        {quote.supplierName}
                                      </div>
                                      <div className="text-[11px] text-slate-500">
                                        Lead time: {quote.leadTimeDays} hari · {quote.currency}
                                      </div>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                      {isCheapest && (
                                        <StatusLabel status="Termurah" tone="success" />
                                      )}
                                      {isFastest && (
                                        <StatusLabel status="Tercepat" tone="info" />
                                      )}
                                      {isWinner && (
                                        <StatusLabel status="Pemenang (Awarded)" tone="warning" />
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center justify-between pt-1 border-t border-slate-200">
                                    <span className="text-slate-600">Total Penawaran</span>
                                    <span className="font-mono tabular-nums font-bold text-[#0B1B3A]">
                                      {formatCurrency(totalOrigin, quote.currency)}
                                    </span>
                                  </div>
                                  {canCreate && rfq.status !== 'Awarded' && rfq.status !== 'Cancelled' && (
                                    <Button
                                      type="button"
                                      variant="accent"
                                      size="sm"
                                      className="w-full"
                                      onClick={() => void erp.awardRfqToPo(rfq.id, quote.supplierId)}
                                    >
                                      <Award className="h-3.5 w-3.5" />
                                      Award &amp; Buat PO
                                    </Button>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {/* Desktop Comparison Matrix */}
                          <div className="hidden md:block overflow-x-auto border border-slate-200 rounded-lg">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                                <tr>
                                  <th className="py-2.5 px-3 font-semibold">Supplier</th>
                                  {rfq.items.map((it) => (
                                    <th key={it.productId} className="py-2.5 px-3 font-semibold text-right">
                                      {it.sku} ({it.qty} {it.uomCode})
                                    </th>
                                  ))}
                                  <th className="py-2.5 px-3 font-semibold text-right">Lead Time</th>
                                  <th className="py-2.5 px-3 font-semibold text-right">Total (IDR Eqv)</th>
                                  <th className="py-2.5 px-3 font-semibold">Rekomendasi</th>
                                  <th className="py-2.5 px-3 font-semibold text-right">Aksi</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {quoteMetrics.map(({ quote, totalOrigin, totalIdr }) => {
                                  const isCheapest = totalIdr === minIdr;
                                  const isFastest = quote.leadTimeDays === minLead;
                                  const isWinner = rfq.awardedSupplierId === quote.supplierId;
                                  return (
                                    <tr key={quote.supplierId} className="hover:bg-slate-50/70">
                                      <td className="py-2.5 px-3 font-semibold text-[#0B1B3A]">
                                        <div>{quote.supplierName}</div>
                                        {quote.notes && (
                                          <div className="text-[11px] font-normal text-slate-500">
                                            {quote.notes}
                                          </div>
                                        )}
                                      </td>
                                      {rfq.items.map((it) => (
                                        <td
                                          key={it.productId}
                                          className="py-2.5 px-3 text-right font-mono tabular-nums"
                                        >
                                          {formatCurrency(
                                            Number(qPrice(quote.unitPrices, it.productId, it.unitPrice)),
                                            quote.currency
                                          )}
                                        </td>
                                      ))}
                                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                                        {quote.leadTimeDays} hr
                                      </td>
                                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-[#0B1B3A]">
                                        <div>{formatCurrency(totalOrigin, quote.currency)}</div>
                                        {quote.currency === 'USD' && (
                                          <div className="text-[10px] font-normal text-slate-400">
                                            ≈ {formatCurrency(totalIdr, 'IDR')}
                                          </div>
                                        )}
                                      </td>
                                      <td className="py-2.5 px-3 space-x-1">
                                        {isCheapest && <StatusLabel status="Termurah" tone="success" />}
                                        {isFastest && <StatusLabel status="Tercepat" tone="info" />}
                                        {isWinner && <StatusLabel status="Awarded" tone="warning" />}
                                      </td>
                                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                        {canCreate &&
                                          rfq.status !== 'Awarded' &&
                                          rfq.status !== 'Cancelled' && (
                                            <Button
                                              type="button"
                                              variant="accent"
                                              size="sm"
                                              onClick={() =>
                                                void erp.awardRfqToPo(rfq.id, quote.supplierId)
                                              }
                                            >
                                              <Award className="h-3.5 w-3.5" />
                                              Award &amp; Buat PO
                                            </Button>
                                          )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* =============================================================== */}
        {/* TAB 3: PURCHASE RETURNS (RETUR PEMBELIAN)                       */}
        {/* =============================================================== */}
        <TabsContent value="returns" className="space-y-4">
          {purchaseReturns.length > 0 && (
            <div className="flex items-center justify-between gap-2 md:hidden px-1">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <SelectCheckbox
                  checked={returnSelection.allVisibleSelected}
                  indeterminate={returnSelection.someVisibleSelected}
                  onChange={returnSelection.toggleAllVisible}
                  ariaLabel="Pilih semua Retur Pembelian"
                />
                <span>Pilih Semua ({purchaseReturns.length})</span>
              </label>
            </div>
          )}

          <BulkActionBar
            selectedCount={returnSelection.selectedCount}
            itemLabel="retur pembelian"
            onClear={returnSelection.clearSelection}
            actions={[
              {
                id: 'export-ret-csv',
                label: 'Export Terpilih CSV',
                icon: <Download className="h-3.5 w-3.5" />,
                variant: 'outline',
                onClick: exportSelectedReturns,
              },
              ...(canCompleteReturn && selectedPendingReturnIds.length > 0
                ? [
                    {
                      id: 'complete-ret-bulk',
                      label: `Selesaikan (${selectedPendingReturnIds.length})`,
                      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
                      variant: 'accent' as const,
                      onClick: async () => {
                        await erp.bulkCompleteGoodsReturns(selectedPendingReturnIds);
                        returnSelection.clearSelection();
                      },
                    },
                  ]
                : []),
              ...(canReturn && selectedPendingReturnIds.length > 0
                ? [
                    {
                      id: 'cancel-ret-bulk',
                      label: `Batalkan (${selectedPendingReturnIds.length})`,
                      variant: 'outline' as const,
                      onClick: async () => {
                        await erp.bulkCancelGoodsReturns(selectedPendingReturnIds);
                        returnSelection.clearSelection();
                      },
                    },
                  ]
                : []),
              ...(canDelete
                ? [
                    {
                      id: 'delete-ret-bulk',
                      label: 'Hapus Terpilih',
                      icon: <Trash2 className="h-3.5 w-3.5" />,
                      variant: 'destructive' as const,
                      requiresConfirm: true,
                      confirmLabel: `Konfirmasi Hapus (${returnSelection.selectedCount})`,
                      onClick: async () => {
                        await erp.bulkDeleteGoodsReturns(Array.from(returnSelection.selectedIds));
                        returnSelection.clearSelection();
                      },
                    },
                  ]
                : []),
            ]}
          />

          {/* Mobile Purchase Returns Cards */}
          <div className="space-y-3 md:hidden max-h-[540px] overflow-y-auto pr-1">
            {purchaseReturns.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-xs text-slate-500">
                  Belum ada catatan Retur Pembelian.
                </CardContent>
              </Card>
            ) : (
              purchaseReturns.map((ret) => (
                <Card key={`m_ret_po_${ret.id}`} className={returnSelection.isSelected(ret.id) ? 'border-[#1B5E99] bg-[#F4F8FC]' : ''}>
                  <CardContent className="p-4 space-y-2.5 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0">
                        <SelectCheckbox
                          checked={returnSelection.isSelected(ret.id)}
                          onChange={() => returnSelection.toggleOne(ret.id)}
                          ariaLabel={`Pilih retur ${ret.returnNumber}`}
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <div className="font-mono font-bold text-[#0B1B3A]">{ret.returnNumber}</div>
                          <div className="text-[11px] text-slate-500">
                            Ref PO: {ret.referenceOrderNumber} · {ret.returnDate}
                          </div>
                        </div>
                      </div>
                      <StatusLabel status={ret.status} tone={getReturnTone(ret.status)} />
                    </div>
                    <div className="font-semibold text-[#0B1B3A]">{ret.counterpartyName}</div>
                    <div className="text-[11px] text-slate-600">{ret.reason}</div>
                    <div className="flex items-center justify-between rounded-lg bg-[#F4F7FB] px-3 py-2">
                      <span className="text-slate-500">Nilai Debit Note</span>
                      <span className="font-mono font-bold tabular-nums text-[#0B1B3A]">
                        {formatCurrency(ret.totalAmount, ret.currency)}
                      </span>
                    </div>
                    {(ret.status === 'Pending' || canDelete) && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {ret.status === 'Pending' && canCompleteReturn && (
                          <Button
                            type="button"
                            variant="accent"
                            size="sm"
                            className="flex-1"
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
                                title: 'Hapus Riwayat Retur Pembelian?',
                                description: 'Catatan retur pembelian yang dipilih akan dihapus permanen.',
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

          {/* Desktop Purchase Returns Table */}
          <Card className="hidden md:block">
            <div className="max-h-[500px] overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 pl-4 pr-2 w-10">
                      <SelectCheckbox
                        checked={returnSelection.allVisibleSelected}
                        indeterminate={returnSelection.someVisibleSelected}
                        onChange={returnSelection.toggleAllVisible}
                        ariaLabel="Pilih semua Retur Pembelian"
                      />
                    </th>
                    <th className="py-3 px-4 font-semibold">No. Retur</th>
                    <th className="py-3 px-3 font-semibold">Ref. PO</th>
                    <th className="py-3 px-3 font-semibold">Supplier</th>
                    <th className="py-3 px-3 font-semibold">Tanggal</th>
                    <th className="py-3 px-3 font-semibold">Alasan</th>
                    <th className="py-3 px-3 font-semibold text-right">Total</th>
                    <th className="py-3 px-3 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {purchaseReturns.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-500">
                        Belum ada catatan Retur Pembelian.
                      </td>
                    </tr>
                  ) : (
                    purchaseReturns.map((ret) => (
                      <tr key={ret.id} className={returnSelection.isSelected(ret.id) ? 'bg-[#F0F6FC]' : 'hover:bg-slate-50/70'}>
                        <td className="py-3 pl-4 pr-2">
                          <SelectCheckbox
                            checked={returnSelection.isSelected(ret.id)}
                            onChange={() => returnSelection.toggleOne(ret.id)}
                            ariaLabel={`Pilih retur ${ret.returnNumber}`}
                          />
                        </td>
                        <td className="py-3 px-4 font-mono font-semibold text-[#0B1B3A]">
                          {ret.returnNumber}
                        </td>
                        <td className="py-3 px-3 font-mono text-slate-600">
                          {ret.referenceOrderNumber}
                        </td>
                        <td className="py-3 px-3 font-medium text-slate-800">
                          {ret.counterpartyName}
                        </td>
                        <td className="py-3 px-3 font-mono tabular-nums text-slate-600">
                          {ret.returnDate}
                        </td>
                        <td className="py-3 px-3 text-slate-600 max-w-xs truncate">{ret.reason}</td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold">
                          {formatCurrency(ret.totalAmount, ret.currency)}
                        </td>
                        <td className="py-3 px-3">
                          <StatusLabel status={ret.status} tone={getReturnTone(ret.status)} />
                        </td>
                        <td className="py-3 px-4 text-right space-x-1 whitespace-nowrap">
                          {ret.status === 'Pending' && canCompleteReturn && (
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
                                  title: 'Hapus Riwayat Retur Pembelian?',
                                  description: 'Catatan retur pembelian yang dipilih akan dihapus permanen.',
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

      {/* CREATE PO MODAL */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent size="xl" structured>
          <DialogHeader structured>
            <DialogTitle>Buat Purchase Order Baru</DialogTitle>
            <DialogDescription>
              Pilih supplier, gudang tujuan, dan item barang atau jasa operasional yang dipesan.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col flex-1 min-h-0"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await erp.createPurchaseOrder({
                supplierId,
                warehouseId,
                currency,
                expectedDate,
                notes,
                items: draftItems,
                submitImmediately: true,
                attachmentFile: docFile,
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
                  Informasi Pembelian
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                  <div className="space-y-1.5 col-span-2">
                    <Label htmlFor="po-sup">Supplier</Label>
                    <NativeSelect
                      id="po-sup"
                      value={supplierId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setSupplierId(id);
                        const sup = state.suppliers.find((s) => s.id === id);
                        if (sup) setCurrency(sup.defaultCurrency);
                      }}
                    >
                      {state.suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.defaultCurrency} · {getPartnerVerificationStatus(s)})
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label htmlFor="po-wh">Gudang Tujuan</Label>
                    <NativeSelect
                      id="po-wh"
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
                    <Label htmlFor="po-curr">Mata Uang</Label>
                    <NativeSelect
                      id="po-curr"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                    >
                      <option value="IDR">IDR (Rupiah)</option>
                      <option value="USD">USD (Dollar)</option>
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5 col-span-1 lg:col-span-2">
                    <Label htmlFor="po-date">Target Kirim</Label>
                    <Input
                      id="po-date"
                      type="date"
                      required
                      value={expectedDate}
                      onChange={(e) => setExpectedDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-slate-600">
                  <span>
                    Otoritas Approval (Batas Manager:{' '}
                    <span className="font-mono font-medium text-[#0B1B3A]">
                      {formatCurrency(managerLimitIdr, 'IDR')}
                    </span>
                    )
                  </span>
                  <StatusLabel
                    status={previewNeedsDirector ? 'Approval Direktur' : 'Approval Manager'}
                    tone={previewNeedsDirector ? 'warning' : 'info'}
                  />
                </div>

                {!supplierEligibility.allowed && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold">Transaksi Membutuhkan Verifikasi Admin</div>
                      <div>{supplierEligibility.reason}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Section 2: Items & Services */}
              <div className="border-t border-slate-100 pt-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Daftar Item &amp; Jasa ({draftItems.length})
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setDraftItems((prev) => [...prev, buildPoManualServiceRow()])}
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
                        setDraftItems((prev) => [
                          ...prev,
                          {
                            productId: p.id,
                            qty: 1,
                            unitPrice: p.buyPrice,
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
                    <div className="text-right">Harga ({currency})</div>
                    <div className="text-right">Subtotal</div>
                    <div />
                  </div>

                  <div className="divide-y divide-slate-100">
                    {draftItems.map((row, idx) => {
                      const prod = state.products.find((pr) => pr.id === row.productId);
                      const isManualSvc = Boolean(row.isManualService || (row.isService && !prod));
                      const isSvc = Boolean(row.isService || prod?.isService);
                      const lineTotal = (row.qty || 0) * (row.unitPrice || 0);
                      return (
                        <div
                          key={row.productId && isManualSvc ? row.productId : `po_row_${idx}`}
                          className="p-3.5 md:py-3 md:px-3.5 grid grid-cols-12 md:grid-cols-[minmax(0,1fr)_88px_148px_132px_36px] gap-2.5 items-start"
                        >
                          <div className="col-span-12 md:col-span-1 space-y-1">
                            <div className="flex items-center justify-between md:hidden">
                              <Label className="text-[11px] text-slate-500">
                                {isManualSvc ? `Service #${idx + 1}` : `Item #${idx + 1}`}
                              </Label>
                              {draftItems.length > 1 && (
                                <button
                                  type="button"
                                  aria-label={`Hapus baris ${idx + 1}`}
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
                                aria-label={`Nama service baris ${idx + 1}`}
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
                                aria-label={`Produk baris ${idx + 1}`}
                                value={row.productId}
                                onChange={(e) => {
                                  const pid = e.target.value;
                                  const p = state.products.find((pr) => pr.id === pid);
                                  setDraftItems((prev) =>
                                    prev.map((it, i) =>
                                      i === idx
                                        ? {
                                            ...it,
                                            productId: pid,
                                            unitPrice: p?.buyPrice ?? it.unitPrice,
                                            isService: Boolean(p?.isService),
                                            isManualService: false,
                                            productName: p?.name,
                                            sku: p?.sku,
                                            uomCode: p?.uomCode,
                                          }
                                        : it
                                    )
                                  );
                                }}
                              >
                                {state.products.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.sku} — {p.name}
                                    {p.isService ? ' [Service / Non-Stok]' : ''}
                                  </option>
                                ))}
                              </NativeSelect>
                            )}

                            <div className="text-[11px] pl-0.5">
                              {isSvc ? (
                                <span className="text-[#154C7E] font-medium">
                                  Service / Non-Stok · Otomatis masuk Beban Operasional (tidak menambah stok)
                                </span>
                              ) : (
                                <span className="text-slate-500">
                                  Barang Stok · {prod?.uomCode || row.uomCode || 'PCS'}
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
                              aria-label={`Qty baris ${idx + 1}`}
                              value={row.qty === 0 ? '' : String(row.qty)}
                              onChange={(e) => {
                                const clean = sanitizeDigits(e.target.value);
                                setDraftItems((prev) =>
                                  prev.map((it, i) =>
                                    i === idx ? { ...it, qty: clean ? Number(clean) : 0 } : it
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
                              aria-label={`Harga baris ${idx + 1}`}
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

                          <div className="col-span-12 md:col-span-1 flex items-center justify-between md:justify-end md:h-10 text-xs font-mono tabular-nums font-semibold text-[#0B1B3A] pt-1 md:pt-0">
                            <span className="text-[11px] font-sans font-normal text-slate-500 md:hidden">
                              Subtotal baris
                            </span>
                            <span>{formatCurrency(lineTotal, currency)}</span>
                          </div>

                          <div className="hidden md:flex items-center justify-center h-10">
                            {draftItems.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Hapus baris ${idx + 1}`}
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
              </div>

              {/* Section 3: Notes & Attachment */}
              <div className="border-t border-slate-100 pt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="po-notes">Catatan Pembelian</Label>
                  <Textarea
                    id="po-notes"
                    rows={3}
                    placeholder="Instruksi pengiriman, syarat pembayaran, atau detail tambahan..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="po-doc">Dokumen Pendukung (Quotation / Proforma)</Label>
                  <label
                    htmlFor="po-doc"
                    className="flex items-center gap-2.5 border border-dashed border-slate-300 rounded-lg p-3.5 text-xs text-slate-600 cursor-pointer hover:bg-slate-50 min-h-[82px]"
                  >
                    <Upload className="h-4 w-4 text-[#1B5E99] shrink-0" />
                    <span className="truncate">
                      {docFile ? docFile.name : 'Unggah PDF / gambar quotation supplier'}
                    </span>
                    <input
                      id="po-doc"
                      type="file"
                      className="sr-only"
                      onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                    />
                  </label>
                </div>
              </div>
            </DialogBody>

            <DialogFooter>
              <div className="text-xs text-slate-600 space-y-0.5">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                  <span>
                    Subtotal:{' '}
                    <strong className="font-mono text-[#0B1B3A]">
                      {formatCurrency(previewTotals.subtotal, currency)}
                    </strong>
                  </span>
                  <span className="text-slate-300">·</span>
                  <span>
                    {companyIsPkp ? `PPN (${effectiveTaxRate}%):` : 'PPN (Non-PKP · 0%):'}{' '}
                    <strong className="font-mono text-[#0B1B3A]">
                      {formatCurrency(previewTotals.taxAmount, currency)}
                    </strong>
                  </span>
                </div>
                <div className="text-sm font-bold text-[#0B1B3A] font-mono tabular-nums">
                  Grand Total: {formatCurrency(previewTotals.totalAmount, currency)}
                </div>
              </div>
              <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2">
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                  Batal
                </Button>
                <Button type="submit" variant="accent" disabled={!supplierEligibility.allowed}>
                  Simpan &amp; Ajukan Approval
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* CREATE VENDOR RFQ MODAL */}
      <Dialog open={rfqCreateOpen} onOpenChange={setRfqCreateOpen}>
        <DialogContent size="xl" structured>
          <DialogHeader structured>
            <DialogTitle>Buat Vendor RFQ Baru</DialogTitle>
            <DialogDescription>
              Undang beberapa supplier untuk membandingkan harga dan lead time sebelum menerbitkan PO.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col flex-1 min-h-0"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await erp.saveVendorRfq({
                isNew: true,
                title: rfqTitle,
                warehouseId: rfqWarehouseId,
                deadlineDate: rfqDeadline,
                notes: rfqNotes,
                invitedSupplierIds: rfqSupplierIds,
                items: rfqItems,
                openImmediately: true,
              });
              if (ok) {
                setRfqCreateOpen(false);
                setRfqTitle('');
                setRfqNotes('');
              }
            }}
          >
            <DialogBody>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div className="sm:col-span-2 space-y-1.5">
                  <Label htmlFor="rfq-title">Judul Permintaan Penawaran</Label>
                  <Input
                    id="rfq-title"
                    required
                    placeholder="Pengadaan Safety & Packaging Q4..."
                    value={rfqTitle}
                    onChange={(e) => setRfqTitle(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rfq-deadline">Batas Waktu</Label>
                  <Input
                    id="rfq-deadline"
                    type="date"
                    required
                    value={rfqDeadline}
                    onChange={(e) => setRfqDeadline(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-3 space-y-1.5">
                  <Label htmlFor="rfq-wh">Gudang Penerima</Label>
                  <NativeSelect
                    id="rfq-wh"
                    value={rfqWarehouseId}
                    onChange={(e) => setRfqWarehouseId(e.target.value)}
                  >
                    {state.warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-5 space-y-2">
                <Label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Supplier yang Diundang ({rfqSupplierIds.length})
                </Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border border-slate-200 rounded-xl p-3.5 bg-slate-50/70 max-h-40 overflow-y-auto">
                  {state.suppliers.map((sup) => {
                    const checked = rfqSupplierIds.includes(sup.id);
                    return (
                      <label key={sup.id} className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setRfqSupplierIds((prev) =>
                              e.target.checked
                                ? [...prev, sup.id]
                                : prev.filter((id) => id !== sup.id)
                            );
                          }}
                        />
                        <span className="truncate font-medium text-[#0B1B3A]">{sup.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-slate-100 pt-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Item yang Diminta ({rfqItems.length})
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const p = state.products[0];
                      if (!p) return;
                      setRfqItems((prev) => [
                        ...prev,
                        { productId: p.id, qty: 10, unitPrice: p.buyPrice },
                      ]);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Tambah Produk
                  </Button>
                </div>
                <div className="rounded-xl border border-slate-200 overflow-hidden bg-white divide-y divide-slate-100">
                  {rfqItems.map((row, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 grid grid-cols-12 md:grid-cols-[minmax(0,1fr)_96px_36px] gap-2.5 items-center"
                    >
                      <div className="col-span-8 md:col-span-1 space-y-1">
                        <Label className="text-[11px] text-slate-500 md:hidden">Produk</Label>
                        <NativeSelect
                          value={row.productId}
                          onChange={(e) => {
                            const pid = e.target.value;
                            const p = state.products.find((pr) => pr.id === pid);
                            setRfqItems((prev) =>
                              prev.map((it, i) =>
                                i === idx ? { ...it, productId: pid, unitPrice: p?.buyPrice ?? 0 } : it
                              )
                            );
                          }}
                        >
                          {state.products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.sku} — {p.name}
                            </option>
                          ))}
                        </NativeSelect>
                      </div>
                      <div className="col-span-3 md:col-span-1 space-y-1">
                        <Label className="text-[11px] text-slate-500 md:hidden">Qty</Label>
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={row.qty === 0 ? '' : String(row.qty)}
                          onChange={(e) => {
                            const clean = sanitizeDigits(e.target.value);
                            setRfqItems((prev) =>
                              prev.map((it, i) =>
                                i === idx ? { ...it, qty: clean ? Number(clean) : 0 } : it
                              )
                            );
                          }}
                          className="text-right font-mono tabular-nums"
                        />
                      </div>
                      <div className="col-span-1 flex justify-end">
                        {rfqItems.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Hapus item RFQ ${idx + 1}`}
                            onClick={() => setRfqItems((prev) => prev.filter((_, i) => i !== idx))}
                            className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-100 pt-5 space-y-1.5">
                <Label htmlFor="rfq-notes">Catatan Spesifikasi</Label>
                <Textarea
                  id="rfq-notes"
                  rows={2}
                  value={rfqNotes}
                  onChange={(e) => setRfqNotes(e.target.value)}
                />
              </div>
            </DialogBody>

            <DialogFooter className="sm:justify-end">
              <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 w-full sm:w-auto sm:ml-auto">
                <Button type="button" variant="outline" onClick={() => setRfqCreateOpen(false)}>
                  Batal
                </Button>
                <Button type="submit" variant="accent">
                  Simpan &amp; Buka RFQ
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* INPUT VENDOR QUOTE DIALOG */}
      <Dialog open={!!quoteModalRfq} onOpenChange={(o) => !o && setQuoteModalRfq(null)}>
        <DialogContent size="lg" structured>
          {quoteModalRfq && (
            <>
              <DialogHeader structured>
                <DialogTitle>Input Penawaran Supplier ({quoteModalRfq.rfqNumber})</DialogTitle>
                <DialogDescription>{quoteModalRfq.title}</DialogDescription>
              </DialogHeader>
              <form
                className="flex flex-col flex-1 min-h-0"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const unitPrices: Record<string, number> = {};
                  quoteModalRfq.items.forEach((it) => {
                    unitPrices[it.productId] = Number(quotePrices[it.productId] ?? it.unitPrice) || 0;
                  });
                  const ok = await erp.submitVendorRfqQuote(quoteModalRfq.id, {
                    supplierId: quoteSupplierId,
                    currency: quoteCurrency,
                    leadTimeDays: Number(quoteLeadDays) || 1,
                    unitPrices,
                    notes: quoteNotes,
                  });
                  if (ok) setQuoteModalRfq(null);
                }}
              >
                <DialogBody>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                    <div className="space-y-1.5">
                      <Label htmlFor="qt-sup">Supplier</Label>
                      <NativeSelect
                        id="qt-sup"
                        value={quoteSupplierId}
                        onChange={(e) => {
                          const sid = e.target.value;
                          setQuoteSupplierId(sid);
                          const sup = state.suppliers.find((s) => s.id === sid);
                          if (sup) setQuoteCurrency(sup.defaultCurrency);
                        }}
                      >
                        {state.suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="qt-curr">Mata Uang</Label>
                      <NativeSelect
                        id="qt-curr"
                        value={quoteCurrency}
                        onChange={(e) => setQuoteCurrency(e.target.value as CurrencyCode)}
                      >
                        <option value="IDR">IDR</option>
                        <option value="USD">USD</option>
                      </NativeSelect>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="qt-lead">Lead Time (Hari)</Label>
                      <Input
                        id="qt-lead"
                        type="text"
                        inputMode="numeric"
                        value={quoteLeadDays}
                        onChange={(e) => setQuoteLeadDays(sanitizeDigits(e.target.value))}
                        className="font-mono"
                      />
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-5 space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Harga Penawaran per Item ({quoteCurrency})
                    </div>
                    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white divide-y divide-slate-100">
                      {quoteModalRfq.items.map((it) => (
                        <div
                          key={it.productId}
                          className="p-3.5 grid grid-cols-12 gap-3 items-center text-xs"
                        >
                          <div className="col-span-7">
                            <div className="font-semibold text-[#0B1B3A]">{it.productName}</div>
                            <div className="text-[11px] font-mono text-slate-500">
                              {it.sku} · {it.qty} {it.uomCode}
                            </div>
                          </div>
                          <div className="col-span-5">
                            <Input
                              type="text"
                              inputMode="numeric"
                              value={quotePrices[it.productId] ?? ''}
                              onChange={(e) =>
                                setQuotePrices((prev) => ({
                                  ...prev,
                                  [it.productId]: sanitizeDigits(e.target.value),
                                }))
                              }
                              className="text-right font-mono tabular-nums"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-5 space-y-1.5">
                    <Label htmlFor="qt-notes">Catatan Penawaran</Label>
                    <Input
                      id="qt-notes"
                      placeholder="Garansi / syarat pengiriman..."
                      value={quoteNotes}
                      onChange={(e) => setQuoteNotes(e.target.value)}
                    />
                  </div>
                </DialogBody>

                <DialogFooter className="sm:justify-end">
                  <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 w-full sm:w-auto sm:ml-auto">
                    <Button type="button" variant="outline" onClick={() => setQuoteModalRfq(null)}>
                      Batal
                    </Button>
                    <Button type="submit" variant="accent">
                      Simpan Penawaran
                    </Button>
                  </div>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* CREATE PURCHASE RETURN DIALOG */}
      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent size="lg" structured>
          <DialogHeader structured>
            <DialogTitle>Buat Retur Pembelian (Debit Note)</DialogTitle>
            <DialogDescription>
              Ajukan pengembalian barang rusak/tidak sesuai ke supplier berdasarkan PO yang telah diterima.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col flex-1 min-h-0"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!activeRetPo) return;
              const items = activeRetPo.items
                .map((it) => ({
                  productId: it.productId,
                  qty: Number(retQtys[it.productId] || 0),
                }))
                .filter((i) => i.qty > 0);
              const ok = await erp.saveGoodsReturn({
                returnType: 'PURCHASE_RETURN',
                referenceOrderId: activeRetPo.id,
                returnDate: retDate,
                reason: retReason,
                items,
              });
              if (ok) setReturnOpen(false);
            }}
          >
            <DialogBody>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="ret-po">Pilih Purchase Order</Label>
                  <NativeSelect
                    id="ret-po"
                    value={retPoId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setRetPoId(nextId);
                      const nextPo = state.purchaseOrders.find((p) => p.id === nextId);
                      const map: Record<string, string> = {};
                      nextPo?.items.forEach((it) => {
                        map[it.productId] = '0';
                      });
                      setRetQtys(map);
                    }}
                  >
                    {(returnablePos.length > 0 ? returnablePos : state.purchaseOrders).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.poNumber} — {p.supplierName}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ret-po-date">Tanggal Retur</Label>
                  <Input
                    id="ret-po-date"
                    type="date"
                    required
                    value={retDate}
                    onChange={(e) => setRetDate(e.target.value)}
                  />
                </div>
              </div>

              {activeRetPo && (
                <div className="border-t border-slate-100 pt-5 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Jumlah Item Diretur
                  </div>
                  <div className="rounded-xl border border-slate-200 overflow-hidden bg-white divide-y divide-slate-100">
                    {activeRetPo.items.map((it) => (
                      <div
                        key={it.productId}
                        className="p-3.5 grid grid-cols-12 gap-3 items-center text-xs"
                      >
                        <div className="col-span-8">
                          <div className="font-semibold text-[#0B1B3A]">{it.productName}</div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {it.sku} · Diterima: {it.fulfilledQty} / Order: {it.qty} {it.uomCode}
                          </div>
                        </div>
                        <div className="col-span-4">
                          <Input
                            type="text"
                            inputMode="numeric"
                            value={retQtys[it.productId] ?? '0'}
                            onChange={(e) =>
                              setRetQtys((prev) => ({
                                ...prev,
                                [it.productId]: sanitizeDigits(e.target.value),
                              }))
                            }
                            className="text-right font-mono tabular-nums"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t border-slate-100 pt-5 space-y-1.5">
                <Label htmlFor="ret-po-reason">Alasan Retur</Label>
                <Textarea
                  id="ret-po-reason"
                  required
                  rows={3}
                  placeholder="Kemasan penyok / spesifikasi tidak sesuai PO..."
                  value={retReason}
                  onChange={(e) => setRetReason(e.target.value)}
                />
              </div>
            </DialogBody>

            <DialogFooter className="sm:justify-end">
              <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 w-full sm:w-auto sm:ml-auto">
                <Button type="button" variant="outline" onClick={() => setReturnOpen(false)}>
                  Batal
                </Button>
                <Button type="submit" variant="accent">
                  Simpan Pengajuan Retur
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* PO DETAIL + WORKFLOW + GOODS RECEIPT MODAL */}
      <Dialog open={!!selectedPo} onOpenChange={(open) => !open && setSelectedPoId(null)}>
        <DialogContent size="xl" structured>
          {selectedPo && (
            <>
              <DialogHeader structured>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <DialogTitle className="font-mono">{selectedPo.poNumber}</DialogTitle>
                    <DialogDescription>
                      {selectedPo.supplierName} → {selectedPo.warehouseName}
                    </DialogDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusLabel
                      status={selectedPoNeedsDirector ? 'Tier Direktur' : 'Tier Manager'}
                      tone={selectedPoNeedsDirector ? 'warning' : 'info'}
                    />
                    <StatusLabel
                      status={selectedPo.status}
                      tone={getPoStatusTone(selectedPo.status)}
                    />
                  </div>
                </div>
              </DialogHeader>

              <DialogBody>
                {/* 3-Way Matching Summary */}
                {selectedPoMatch && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 text-xs space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[#0B1B3A] inline-flex items-center gap-1.5">
                        <ShieldCheck className="h-4 w-4 text-[#1B5E99]" />
                        Verifikasi 3-Way Match (PO ↔ Goods Receipt ↔ Tagihan AP)
                      </span>
                      <StatusLabel
                        status={selectedPoMatch.status}
                        tone={getMatchTone(selectedPoMatch.status)}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-1 font-mono tabular-nums text-[11px]">
                      <div>
                        <span className="text-slate-500 block font-sans">Nilai PO</span>
                        <strong>{formatCurrency(selectedPoMatch.orderedValueIdr, 'IDR')}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500 block font-sans">Nilai Goods Receipt</span>
                        <strong>{formatCurrency(selectedPoMatch.receivedValueIdr, 'IDR')}</strong>
                      </div>
                      <div className="text-right">
                        <span className="text-slate-500 block font-sans">Nilai Invoice AP</span>
                        <strong>{formatCurrency(selectedPoMatch.invoicedValueIdr, 'IDR')}</strong>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-600">{selectedPoMatch.reason}</p>
                  </div>
                )}

                {/* Mobile Line Items Cards */}
                <div className="space-y-2.5 md:hidden">
                  {selectedPo.items.map((it) => {
                    const remaining = Math.max(0, it.qty - it.fulfilledQty);
                    const isSvc = isServiceOrderItem(it, state.products);
                    return (
                      <div
                        key={`m_po_it_${it.productId}`}
                        className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 text-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold text-[#0B1B3A]">
                              {it.productName}
                              {isSvc && (
                                <span className="ml-1.5 text-[11px] font-medium text-[#154C7E]">
                                  · Service / Non-Stok
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500">{it.sku}</div>
                          </div>
                          <span className="font-mono font-semibold text-[#0B1B3A] shrink-0">
                            {formatCurrency(it.lineTotal, selectedPo.currency)}
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-2 rounded bg-slate-50 p-2 text-[11px]">
                          <div>
                            <span className="text-slate-500 block">Order</span>
                            <span className="font-mono font-semibold">
                              {it.qty} {it.uomCode}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block">Diterima</span>
                            <span className="font-mono font-semibold text-[#1B5E99]">
                              {it.fulfilledQty} {it.uomCode}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-slate-500 block">Harga</span>
                            <span className="font-mono">
                              {formatCurrency(it.unitPrice, selectedPo.currency)}
                            </span>
                          </div>
                        </div>

                        {receiveMode && (
                          <div className="space-y-1 pt-1">
                            <Label className="text-[11px] text-[#0B1B3A]">
                              Terima Sekarang (Sisa: {remaining} {it.uomCode})
                            </Label>
                            <Input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              aria-label={`Qty diterima mobile ${it.sku}`}
                              value={receiveQtys[it.productId] ?? '0'}
                              onChange={(e) =>
                                setReceiveQtys((prev) => ({
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
                <div className="hidden md:block border border-slate-200 rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="py-2.5 px-3.5 font-semibold">SKU &amp; Item</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Order</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Diterima</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Harga</th>
                        <th className="py-2.5 px-3.5 font-semibold text-right">Total</th>
                        {receiveMode && (
                          <th className="py-2.5 px-3.5 font-semibold text-right">Terima Sekarang</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedPo.items.map((it) => {
                        const remaining = Math.max(0, it.qty - it.fulfilledQty);
                        const isSvc = isServiceOrderItem(it, state.products);
                        return (
                          <tr key={it.productId}>
                            <td className="py-2.5 px-3.5">
                              <div className="font-medium text-slate-900">
                                {it.productName}
                                {isSvc && (
                                  <span className="ml-1.5 text-[11px] font-medium text-[#154C7E]">
                                    · Non-Stok
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
                              {formatCurrency(it.unitPrice, selectedPo.currency)}
                            </td>
                            <td className="py-2.5 px-3.5 text-right font-mono tabular-nums font-medium">
                              {formatCurrency(it.lineTotal, selectedPo.currency)}
                            </td>
                            {receiveMode && (
                              <td className="py-2.5 px-3.5 text-right">
                                <Input
                                  type="number"
                                  min={0}
                                  max={remaining}
                                  aria-label={`Qty diterima ${it.sku}`}
                                  value={receiveQtys[it.productId] ?? '0'}
                                  onChange={(e) =>
                                    setReceiveQtys((prev) => ({
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

                {selectedPo.status === 'Submitted' && selectedPoNeedsDirector && !canApproveDirector && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                    Nilai PO ({formatCurrency(selectedPoTotalIdr, 'IDR')}) melampaui batas approval Manager ({formatCurrency(managerLimitIdr, 'IDR')}). Menunggu persetujuan <strong>Direktur</strong>.
                  </div>
                )}

                {receiveMode && (
                  <div className="space-y-3 bg-[#EBF3FA]/60 border border-[#BFD9EF] rounded-xl p-4">
                    <div className="text-xs font-semibold text-[#0B1B3A]">
                      Konversi ke Goods Receipt (Penerimaan Parsial / Penuh)
                    </div>
                    <Input
                      placeholder="Catatan penerimaan barang / nomor surat jalan supplier"
                      value={receiveNotes}
                      onChange={(e) => setReceiveNotes(e.target.value)}
                      className="bg-white"
                    />
                    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setReceiveMode(false)}>
                        Batal GR
                      </Button>
                      <Button
                        type="button"
                        variant="accent"
                        size="sm"
                        onClick={async () => {
                          const map: Record<string, number> = {};
                          Object.entries(receiveQtys).forEach(([k, v]) => {
                            map[k] = Number(v) || 0;
                          });
                          await erp.receiveGoodsFromPo(selectedPo.id, map, receiveNotes);
                          setReceiveMode(false);
                          setSelectedPoId(null);
                        }}
                      >
                        <PackageCheck className="h-4 w-4" />
                        Konfirmasi Goods Receipt &amp; Buat AP
                      </Button>
                    </div>
                  </div>
                )}

                {/* Activity History Log */}
                <div className="space-y-2 pt-3 border-t border-slate-100">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Riwayat Aktivitas PO
                  </div>
                  <div className="space-y-1.5">
                    {(selectedPo.logs || []).map((lg) => (
                      <div
                        key={lg.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs text-slate-600 bg-slate-50 px-3 py-2 rounded-lg"
                      >
                        <span>
                          <strong className="text-slate-800">{lg.action}</strong> — {lg.actorName}
                          {lg.note ? ` (${lg.note})` : ''}
                        </span>
                        <span className="font-mono text-[11px] text-slate-400 shrink-0">
                          {(lg.timestamp || '').slice(0, 16).replace('T', ' ') || '-'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </DialogBody>

              {!receiveMode && (
                <DialogFooter className="sm:items-center">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const sup = state.suppliers.find((s) => s.id === selectedPo.supplierId);
                        openPrintPreview(
                          buildPurchaseOrderPrintDoc(selectedPo, state.settings, sup),
                          () => exportPurchaseOrderPdf(selectedPo, state.settings, sup)
                        );
                      }}
                    >
                      <Printer className="h-3.5 w-3.5 text-[#0B1B3A]" />
                      Cetak Preview
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => exportPurchaseOrderCsv(selectedPo)}
                    >
                      <Download className="h-3.5 w-3.5 text-slate-700" />
                      CSV PO
                    </Button>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 shrink-0">
                    {canCreate && selectedPo.status === 'Draft' && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void erp.transitionPurchaseOrder(selectedPo.id, 'Submitted')}
                      >
                        Ajukan Approval
                      </Button>
                    )}
                    {canApprove && selectedPo.status === 'Submitted' && (
                      <Button
                        type="button"
                        variant={selectedPoNeedsDirector ? 'gold' : 'accent'}
                        size="sm"
                        disabled={selectedPoNeedsDirector && !canApproveDirector}
                        onClick={() =>
                          void erp.transitionPurchaseOrder(selectedPo.id, 'Approved by Manager')
                        }
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {selectedPoNeedsDirector ? 'Setujui Direktur' : 'Setujui Manager'}
                      </Button>
                    )}
                    {canCreate && selectedPo.status === 'Approved by Manager' && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void erp.transitionPurchaseOrder(selectedPo.id, 'Ordered')}
                      >
                        Tandai Ordered ke Supplier
                      </Button>
                    )}
                    {canReceive &&
                      ['Approved by Manager', 'Ordered', 'Partially Received'].includes(
                        selectedPo.status
                      ) && (
                        <Button
                          type="button"
                          variant="accent"
                          size="sm"
                          onClick={() => setReceiveMode(true)}
                        >
                          <PackageCheck className="h-4 w-4" />
                          Proses Goods Receipt
                        </Button>
                      )}
                    {canClose && selectedPo.status === 'Fully Received' && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void erp.transitionPurchaseOrder(selectedPo.id, 'Closed')}
                      >
                        Tutup PO (Closed)
                      </Button>
                    )}
                    {(canCreate || canApprove) &&
                      !['Closed', 'Cancelled', 'Fully Received'].includes(selectedPo.status) && (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() =>
                            void erp.transitionPurchaseOrder(selectedPo.id, 'Cancelled')
                          }
                        >
                          Batalkan PO
                        </Button>
                      )}
                    {canDelete && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmDeletePo(selectedPo)}
                        className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Hapus PO
                      </Button>
                    )}
                  </div>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* CONFIRM DELETE SINGLE PO MODAL */}
      <Dialog open={!!confirmDeletePo} onOpenChange={(open) => !open && setConfirmDeletePo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus Purchase Order?</DialogTitle>
            <DialogDescription>
              Dokumen PO beserta riwayat aktivitasnya akan dihapus permanen dari sistem.
            </DialogDescription>
          </DialogHeader>
          {confirmDeletePo && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
              <div className="font-mono font-semibold text-slate-900">{confirmDeletePo.poNumber}</div>
              <div>Supplier: {confirmDeletePo.supplierName}</div>
              <div>
                Status: {confirmDeletePo.status} · Total:{' '}
                <span className="font-mono font-semibold">
                  {formatCurrency(confirmDeletePo.totalAmount, confirmDeletePo.currency)}
                </span>
              </div>
            </div>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={isDeleting}
              onClick={() => setConfirmDeletePo(null)}
            >
              Batal
            </Button>
            <Button
              type="button"
              disabled={isDeleting}
              onClick={async () => {
                if (!confirmDeletePo) return;
                setIsDeleting(true);
                try {
                  const targetId = confirmDeletePo.id;
                  await erp.deletePurchaseOrder(targetId);
                  if (selectedPoId === targetId) setSelectedPoId(null);
                  setConfirmDeletePo(null);
                } finally {
                  setIsDeleting(false);
                }
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {isDeleting ? 'Menghapus...' : 'Ya, Hapus PO'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* CONFIRM CLEAR DUMMY PO MODAL */}
      <Dialog open={confirmDummyOpen} onOpenChange={setConfirmDummyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus Semua PO Dummy?</DialogTitle>
            <DialogDescription>
              Tindakan ini hanya menghapus {dummyTargets.poIds.length} Purchase Order bawaan/dummy sistem. PO yang Anda buat sendiri tetap aman dan tidak terhapus.
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
                  await erp.clearDummyPurchaseOrders();
                  setSelectedPoId(null);
                  setConfirmDummyOpen(false);
                } finally {
                  setIsDeleting(false);
                }
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {isDeleting ? 'Menghapus...' : 'Ya, Hapus PO Dummy'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* CONFIRM DELETE RFQ / PURCHASE RETURN MODAL */}
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

function qPrice(
  unitPrices: Record<string, number>,
  productId: string,
  fallback: number
): number {
  return unitPrices[productId] !== undefined ? Number(unitPrices[productId]) : fallback;
}

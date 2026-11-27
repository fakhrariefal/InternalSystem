import {
  AlertTriangle,
  ArrowLeftRight,
  ClipboardCheck,
  FileDown,
  PackageMinus,
  PackagePlus,
  Pencil,
  Plus,
  Printer,
  ShieldAlert,
  Trash2,
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
  computeBatchAlerts,
  getTotalProductStock,
  isLowStockProduct,
  isServiceOrderItem,
} from '../models/erpLogic';
import { buildSuratJalanPrintDoc } from '../models/printDocumentModel';
import { hasPermission } from '../models/rbac';
import type { InventoryBatch, InventoryBatchStatus } from '../models/types';
import { exportSuratJalanPdf } from '../services/exportService';

function sanitizeDigits(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  return digits.replace(/^0+(?=\d)/, '');
}

export function InventoryView({ erp }: { erp: ErpController }) {
  const { state, currentUser } = erp;
  const { tr } = useI18n();
  const { openPrintPreview } = usePrintDocument();
  const canInventory = hasPermission(currentUser?.role, 'inventory:write');
  const canReceive = hasPermission(currentUser?.role, 'po:receive');
  const canDeleteBatch = hasPermission(currentUser?.role, 'master:users');

  // Physical stock products only (exclude Service / Non-Stok)
  const stockProducts = useMemo(
    () => state.products.filter((p) => !p.isService),
    [state.products]
  );

  // Filter warehouse
  const [selectedWh, setSelectedWh] = useState<string>('ALL');
  const [confirmDelete, setConfirmDelete] = useState<{
    title: string;
    description: string;
    detail: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Batch / Serial modal state
  const [batchModal, setBatchModal] = useState<{
    open: boolean;
    isNew: boolean;
    id?: string;
    productId: string;
    warehouseId: string;
    batchNumber: string;
    serialNumber: string;
    qty: string;
    warrantyUntil: string;
    expiryDate: string;
    status: InventoryBatchStatus;
    notes: string;
  }>({
    open: false,
    isNew: true,
    productId: stockProducts[0]?.id || '',
    warehouseId: state.warehouses[0]?.id || '',
    batchNumber: '',
    serialNumber: '',
    qty: '1',
    warrantyUntil: '',
    expiryDate: '',
    status: 'Active',
    notes: '',
  });
  const batchAlerts = computeBatchAlerts(state.inventoryBatches);

  const openBatchModal = (existing?: InventoryBatch) => {
    if (existing) {
      setBatchModal({
        open: true,
        isNew: false,
        id: existing.id,
        productId: existing.productId,
        warehouseId: existing.warehouseId,
        batchNumber: existing.batchNumber,
        serialNumber: existing.serialNumber || '',
        qty: String(existing.qty),
        warrantyUntil: existing.warrantyUntil || '',
        expiryDate: existing.expiryDate || '',
        status: existing.status,
        notes: existing.notes || '',
      });
    } else {
      setBatchModal({
        open: true,
        isNew: true,
        productId: stockProducts[0]?.id || '',
        warehouseId: state.warehouses[0]?.id || '',
        batchNumber: '',
        serialNumber: '',
        qty: '10',
        warrantyUntil: '',
        expiryDate: '',
        status: 'Active',
        notes: '',
      });
    }
  };

  // Goods Receipt from PO state
  const receivablePos = state.purchaseOrders.filter((p) =>
    ['Approved by Manager', 'Ordered', 'Partially Received'].includes(p.status)
  );
  const [grPoId, setGrPoId] = useState<string>(receivablePos[0]?.id || '');
  const [grQtys, setGrQtys] = useState<Record<string, string>>({});
  const [grNotes, setGrNotes] = useState('');

  // Goods Issue state
  const [giProdId, setGiProdId] = useState(stockProducts[0]?.id || '');
  const [giWhId, setGiWhId] = useState(state.warehouses[0]?.id || '');
  const [giQty, setGiQty] = useState('1');
  const [giNotes, setGiNotes] = useState('');

  // Transfer state
  const [trProdId, setTrProdId] = useState(stockProducts[0]?.id || '');
  const [trFromWh, setTrFromWh] = useState(state.warehouses[0]?.id || '');
  const [trToWh, setTrToWh] = useState(state.warehouses[1]?.id || '');
  const [trQty, setTrQty] = useState('1');
  const [trNotes, setTrNotes] = useState('');

  // Stock Opname state
  const [opProdId, setOpProdId] = useState(stockProducts[0]?.id || '');
  const [opWhId, setOpWhId] = useState(state.warehouses[0]?.id || '');
  const [opCounted, setOpCounted] = useState('0');
  const [opNotes, setOpNotes] = useState('');

  const activeGrPo = state.purchaseOrders.find((p) => p.id === (grPoId || receivablePos[0]?.id));
  const opProduct = stockProducts.find((p) => p.id === opProdId);
  const opSystemQty = opProduct?.warehouseStocks[opWhId] ?? 0;

  const visibleWarehouses = state.warehouses.filter(
    (w) => selectedWh === 'ALL' || w.id === selectedWh
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-[#0B1B3A]">
          {tr('Inventory & Gudang', 'Inventory & Warehouse')}
        </h2>
        <p className="text-xs sm:text-sm text-slate-600">
          {tr(
            'Pemantauan stok multi-gudang real-time, penerimaan PO, pengeluaran, mutasi antar gudang, dan stock opname.',
            'Real-time multi-warehouse stock monitoring, PO receiving, goods issue, inter-warehouse transfer, and stock opname.'
          )}
        </p>
      </div>

      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">{tr('Stok Real-Time', 'Real-Time Stock')}</TabsTrigger>
          <TabsTrigger value="gr">Goods Receipt (PO)</TabsTrigger>
          <TabsTrigger value="gi">Goods Issue</TabsTrigger>
          <TabsTrigger value="transfer">{tr('Transfer Gudang', 'Warehouse Transfer')}</TabsTrigger>
          <TabsTrigger value="opname">Stock Opname</TabsTrigger>
          <TabsTrigger value="batches">
            {tr('Serial, Batch & Expired', 'Serial, Batch & Expiry')} ({state.inventoryBatches.length})
          </TabsTrigger>
          <TabsTrigger value="movements">{tr('Riwayat', 'Movements')} ({state.stockMovements.length})</TabsTrigger>
        </TabsList>

        {/* REAL-TIME STOCK */}
        <TabsContent value="stock" className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-white border border-slate-200 rounded-xl p-3.5">
            <span className="text-sm font-semibold text-[#0B1B3A]">
              Posisi Stok Multi-Gudang ({stockProducts.length} SKU Fisik)
            </span>
            <NativeSelect
              aria-label="Filter gudang"
              value={selectedWh}
              onChange={(e) => setSelectedWh(e.target.value)}
              className="w-full sm:w-64"
            >
              <option value="ALL">Semua Gudang ({state.warehouses.length})</option>
              {state.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          {/* Mobile Stock Cards */}
          <div className="space-y-3 md:hidden">
            {stockProducts.map((p) => {
              const total = getTotalProductStock(p);
              const low = isLowStockProduct(p);
              return (
                <Card key={`m_stk_${p.id}`}>
                  <CardContent className="p-4 space-y-3 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-[#0B1B3A]">{p.name}</div>
                        <div className="text-[11px] font-mono text-slate-500">
                          {p.sku} · {p.uomCode}
                        </div>
                      </div>
                      <StatusLabel
                        status={low ? 'Low Stock' : 'Normal'}
                        tone={low ? 'danger' : 'success'}
                      />
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-lg bg-[#F4F7FB] p-2.5">
                      {visibleWarehouses.map((w) => (
                        <div key={w.id}>
                          <span className="text-[10px] text-slate-500 block">{w.code}</span>
                          <span className="font-mono font-semibold text-[#0B1B3A] tabular-nums">
                            {p.warehouseStocks[w.id] ?? 0}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-100">
                      <span className="text-slate-500">
                        Min / Maks: <span className="font-mono">{p.minStock} / {p.maxStock}</span>
                      </span>
                      <span className="font-semibold text-[#0B1B3A]">
                        Total: <span className="font-mono text-sm tabular-nums">{total} {p.uomCode}</span>
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Desktop Stock Table */}
          <Card className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-semibold">SKU &amp; Produk</th>
                    {visibleWarehouses.map((w) => (
                      <th key={w.id} className="py-3 px-3 font-semibold text-right">
                        {w.code}
                      </th>
                    ))}
                    <th className="py-3 px-3 font-semibold text-right">Total</th>
                    <th className="py-3 px-3 font-semibold text-right">Min / Maks</th>
                    <th className="py-3 px-4 font-semibold">Alert</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stockProducts.map((p) => {
                    const total = getTotalProductStock(p);
                    const low = isLowStockProduct(p);
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-4">
                          <div className="font-medium text-slate-900">{p.name}</div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {p.sku} · {p.uomCode}
                          </div>
                        </td>
                        {visibleWarehouses.map((w) => (
                          <td key={w.id} className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {p.warehouseStocks[w.id] ?? 0}
                          </td>
                        ))}
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                          {total}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500">
                          {p.minStock} / {p.maxStock}
                        </td>
                        <td className="py-2.5 px-4">
                          <StatusLabel
                            status={low ? 'Low Stock' : 'Normal'}
                            tone={low ? 'danger' : 'success'}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* GOODS RECEIPT */}
        <TabsContent value="gr">
          <Card>
            <CardHeader>
              <CardTitle>Goods Receipt dari Purchase Order (Partial Receiving Didukung)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!canReceive ? (
                <p className="text-sm text-amber-700">
                  Hanya role Warehouse atau Direktur yang dapat memproses Goods Receipt.
                </p>
              ) : receivablePos.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Tidak ada Purchase Order berstatus Approved/Ordered/Partially Received saat ini.
                </p>
              ) : (
                <>
                  <div className="space-y-1 max-w-md">
                    <Label htmlFor="inv-gr-po">Pilih Purchase Order</Label>
                    <NativeSelect
                      id="inv-gr-po"
                      value={activeGrPo?.id || ''}
                      onChange={(e) => {
                        setGrPoId(e.target.value);
                        setGrQtys({});
                      }}
                    >
                      {receivablePos.map((po) => (
                        <option key={po.id} value={po.id}>
                          {po.poNumber} — {po.supplierName} ({po.status})
                        </option>
                      ))}
                    </NativeSelect>
                  </div>

                  {activeGrPo && (
                    <div className="space-y-4">
                      {/* Mobile GR Cards */}
                      <div className="space-y-2.5 md:hidden">
                        {activeGrPo.items.map((it) => {
                          const rem = Math.max(0, it.qty - it.fulfilledQty);
                          const isSvc = isServiceOrderItem(it, state.products);
                          return (
                            <div
                              key={`m_gr_${it.productId}`}
                              className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 text-xs"
                            >
                              <div className="font-semibold text-[#0B1B3A] flex flex-wrap items-center gap-1.5">
                                <span>{it.sku} — {it.productName}</span>
                                {isSvc && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#EBF3FA] text-[#154C7E]">
                                    Service / Non-Stok
                                  </span>
                                )}
                              </div>
                              <div className="grid grid-cols-3 gap-2 rounded bg-[#F4F7FB] p-2 text-[11px]">
                                <div>
                                  <span className="text-slate-500 block">Dipesan</span>
                                  <span className="font-mono font-semibold">{it.qty}</span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block">Diterima</span>
                                  <span className="font-mono font-semibold text-[#1B5E99]">
                                    {it.fulfilledQty}
                                  </span>
                                </div>
                                <div className="text-right">
                                  <span className="text-slate-500 block">Sisa</span>
                                  <span className="font-mono font-semibold">{rem}</span>
                                </div>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[11px] text-slate-600">Qty Terima</Label>
                                <Input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={grQtys[it.productId] ?? String(rem)}
                                  onChange={(e) =>
                                    setGrQtys((prev) => ({
                                      ...prev,
                                      [it.productId]: sanitizeDigits(e.target.value),
                                    }))
                                  }
                                  className="text-right font-mono tabular-nums"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Desktop GR Table */}
                      <div className="hidden md:block border border-slate-200 rounded-lg overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              <th className="py-2.5 px-3">Item</th>
                              <th className="py-2.5 px-3 text-right">Dipesan</th>
                              <th className="py-2.5 px-3 text-right">Sudah Diterima</th>
                              <th className="py-2.5 px-3 text-right">Sisa</th>
                              <th className="py-2.5 px-3 text-right">Qty Terima</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {activeGrPo.items.map((it) => {
                              const rem = Math.max(0, it.qty - it.fulfilledQty);
                              const isSvc = isServiceOrderItem(it, state.products);
                              return (
                                <tr key={it.productId}>
                                  <td className="py-2.5 px-3 font-medium">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span>{it.sku} — {it.productName}</span>
                                      {isSvc && (
                                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#EBF3FA] text-[#154C7E]">
                                          Non-Stok
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">{it.qty}</td>
                                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">{it.fulfilledQty}</td>
                                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">{rem}</td>
                                  <td className="py-2.5 px-3 text-right">
                                    <Input
                                      type="number"
                                      min={0}
                                      max={rem}
                                      value={grQtys[it.productId] ?? String(rem)}
                                      onChange={(e) =>
                                        setGrQtys((prev) => ({
                                          ...prev,
                                          [it.productId]: e.target.value,
                                        }))
                                      }
                                      className="h-9 w-24 ml-auto text-right font-mono"
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                        <div className="flex-1 space-y-1 w-full">
                          <Label htmlFor="gr-notes">Catatan Surat Jalan / Penerimaan</Label>
                          <Input
                            id="gr-notes"
                            placeholder="No. SJ / kondisi barang..."
                            value={grNotes}
                            onChange={(e) => setGrNotes(e.target.value)}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="accent"
                          className="w-full sm:w-auto"
                          onClick={async () => {
                            const map: Record<string, number> = {};
                            activeGrPo.items.forEach((it) => {
                              const rem = Math.max(0, it.qty - it.fulfilledQty);
                              map[it.productId] = Number(grQtys[it.productId] ?? rem);
                            });
                            await erp.receiveGoodsFromPo(activeGrPo.id, map, grNotes);
                            setGrNotes('');
                          }}
                        >
                          <PackagePlus className="h-4 w-4" />
                          Catat Goods Receipt &amp; Buat AP
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* GOODS ISSUE */}
        <TabsContent value="gi">
          <Card>
            <CardHeader>
              <CardTitle>Goods Issue (Pengeluaran Barang Manual)</CardTitle>
            </CardHeader>
            <CardContent>
              {!canInventory ? (
                <p className="text-sm text-amber-700">
                  Hanya role Warehouse atau Direktur yang dapat melakukan Goods Issue.
                </p>
              ) : (
                <form
                  className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await erp.issueGoods({
                      productId: giProdId,
                      warehouseId: giWhId,
                      qty: Number(giQty),
                      notes: giNotes,
                    });
                    setGiNotes('');
                  }}
                >
                  <div className="space-y-1">
                    <Label htmlFor="gi-prod">Produk</Label>
                    <NativeSelect id="gi-prod" value={giProdId} onChange={(e) => setGiProdId(e.target.value)}>
                      {stockProducts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} — {p.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="gi-wh">Gudang Sumber</Label>
                    <NativeSelect id="gi-wh" value={giWhId} onChange={(e) => setGiWhId(e.target.value)}>
                      {state.warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.code} — {w.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="gi-qty">Kuantitas Keluar</Label>
                    <Input
                      id="gi-qty"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={giQty}
                      onChange={(e) => setGiQty(sanitizeDigits(e.target.value))}
                      className="font-mono tabular-nums"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="gi-notes">Alasan / Referensi</Label>
                    <Input
                      id="gi-notes"
                      placeholder="Pemakaian proyek / sample..."
                      value={giNotes}
                      onChange={(e) => setGiNotes(e.target.value)}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Button type="submit" variant="default" className="w-full sm:w-auto">
                      <PackageMinus className="h-4 w-4" />
                      Proses Goods Issue
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TRANSFER ANTAR GUDANG */}
        <TabsContent value="transfer">
          <Card>
            <CardHeader>
              <CardTitle>Mutasi / Transfer Antar Gudang</CardTitle>
            </CardHeader>
            <CardContent>
              {!canInventory ? (
                <p className="text-sm text-amber-700">
                  Hanya role Warehouse atau Direktur yang dapat melakukan mutasi gudang.
                </p>
              ) : (
                <form
                  className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await erp.transferStock({
                      productId: trProdId,
                      fromWarehouseId: trFromWh,
                      toWarehouseId: trToWh,
                      qty: Number(trQty),
                      notes: trNotes,
                    });
                    setTrNotes('');
                  }}
                >
                  <div className="md:col-span-2 space-y-1">
                    <Label htmlFor="tr-prod">Produk</Label>
                    <NativeSelect id="tr-prod" value={trProdId} onChange={(e) => setTrProdId(e.target.value)}>
                      {stockProducts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} — {p.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tr-from">Dari Gudang</Label>
                    <NativeSelect id="tr-from" value={trFromWh} onChange={(e) => setTrFromWh(e.target.value)}>
                      {state.warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.code} — {w.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tr-to">Ke Gudang Tujuan</Label>
                    <NativeSelect id="tr-to" value={trToWh} onChange={(e) => setTrToWh(e.target.value)}>
                      {state.warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.code} — {w.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tr-qty">Kuantitas Transfer</Label>
                    <Input
                      id="tr-qty"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={trQty}
                      onChange={(e) => setTrQty(sanitizeDigits(e.target.value))}
                      className="font-mono tabular-nums"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tr-notes">Catatan Mutasi</Label>
                    <Input
                      id="tr-notes"
                      placeholder="Permintaan cabang..."
                      value={trNotes}
                      onChange={(e) => setTrNotes(e.target.value)}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Button type="submit" variant="accent" className="w-full sm:w-auto">
                      <ArrowLeftRight className="h-4 w-4" />
                      Proses Transfer Stok
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* STOCK OPNAME */}
        <TabsContent value="opname">
          <Card>
            <CardHeader>
              <CardTitle>Stock Opname &amp; Penyesuaian (Adjustment)</CardTitle>
            </CardHeader>
            <CardContent>
              {!canInventory ? (
                <p className="text-sm text-amber-700">
                  Hanya role Warehouse atau Direktur yang dapat mencatat Stock Opname.
                </p>
              ) : (
                <form
                  className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await erp.recordStockOpname({
                      productId: opProdId,
                      warehouseId: opWhId,
                      countedQty: Number(opCounted),
                      notes: opNotes,
                    });
                    setOpNotes('');
                  }}
                >
                  <div className="space-y-1">
                    <Label htmlFor="op-prod">Produk</Label>
                    <NativeSelect id="op-prod" value={opProdId} onChange={(e) => setOpProdId(e.target.value)}>
                      {stockProducts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} — {p.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="op-wh">Gudang</Label>
                    <NativeSelect id="op-wh" value={opWhId} onChange={(e) => setOpWhId(e.target.value)}>
                      {state.warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.code} — {w.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1">
                    <Label>Stok Tercatat di Sistem</Label>
                    <div className="min-h-[44px] md:min-h-[40px] px-3 flex items-center rounded-lg border border-slate-200 bg-slate-50 font-mono text-sm tabular-nums">
                      {opSystemQty} {opProduct?.uomCode}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="op-counted">Hasil Hitung Fisik (Actual Qty)</Label>
                    <Input
                      id="op-counted"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={opCounted}
                      onChange={(e) => setOpCounted(sanitizeDigits(e.target.value))}
                      className="font-mono tabular-nums"
                    />
                  </div>
                  <div className="md:col-span-2 space-y-1">
                    <Label htmlFor="op-notes">Keterangan Selisih Opname</Label>
                    <Input
                      id="op-notes"
                      placeholder="Barang rusak / hasil audit berkala..."
                      value={opNotes}
                      onChange={(e) => setOpNotes(e.target.value)}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Button type="submit" variant="default" className="w-full sm:w-auto">
                      <ClipboardCheck className="h-4 w-4" />
                      Simpan Adjustment Opname
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* STOCK MOVEMENTS HISTORY */}
        <TabsContent value="movements">
          {/* Mobile Movements Cards */}
          <div className="space-y-3 md:hidden">
            {state.stockMovements.map((m) => {
              const linkedSo =
                m.type === 'GOODS_ISSUE'
                  ? state.salesOrders.find(
                      (s) => s.id === m.referenceId || s.soNumber === m.referenceNumber
                    )
                  : undefined;
              return (
                <Card key={`m_mov_${m.id}`}>
                  <CardContent className="p-4 space-y-2.5 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-mono font-bold text-[#0B1B3A]">{m.movementNumber}</div>
                      <StatusLabel
                        status={m.type}
                        tone={
                          m.type === 'GOODS_RECEIPT'
                            ? 'success'
                            : m.type === 'GOODS_ISSUE'
                            ? 'warning'
                            : 'info'
                        }
                      />
                    </div>
                    <div>
                      <div className="font-semibold text-[#0B1B3A]">{m.productName}</div>
                      <div className="text-[11px] font-mono text-slate-500">{m.productSku}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-[#F4F7FB] p-2.5">
                      <div className="col-span-1">
                        <span className="text-[10px] text-slate-500 block">Perubahan</span>
                        <span
                          className={`font-mono font-bold tabular-nums ${
                            m.quantityDelta >= 0 ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {m.quantityDelta >= 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">Stok Akhir</span>
                        <span className="font-mono font-semibold tabular-nums text-[#0B1B3A]">
                          {m.afterQty}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-500 block">Gudang</span>
                        <span className="font-medium text-slate-700 truncate block">
                          {m.warehouseName}
                        </span>
                      </div>
                    </div>
                    {m.notes && <p className="text-[11px] text-slate-500">{m.notes}</p>}
                    {(linkedSo || canDeleteBatch) && (
                      <div className="flex flex-wrap items-center gap-2">
                        {linkedSo && (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                const cust = state.customers.find((c) => c.id === linkedSo.customerId);
                                const wh = state.warehouses.find((w) => w.id === m.warehouseId);
                                openPrintPreview(
                                  buildSuratJalanPrintDoc(linkedSo, state.settings, cust, wh, m),
                                  () => exportSuratJalanPdf(linkedSo, state.settings, cust, wh, m)
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
                                void exportSuratJalanPdf(
                                  linkedSo,
                                  state.settings,
                                  state.customers.find((c) => c.id === linkedSo.customerId),
                                  state.warehouses.find((w) => w.id === m.warehouseId),
                                  m
                                )
                              }
                            >
                              <FileDown className="h-3.5 w-3.5 text-[#1B5E99]" />
                              SJ PDF
                            </Button>
                          </>
                        )}
                        {canDeleteBatch && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Hapus riwayat stok ${m.movementNumber}`}
                            onClick={() =>
                              setConfirmDelete({
                                title: 'Hapus Riwayat Pergerakan Stok?',
                                description: 'Catatan riwayat mutasi stok akan dihapus permanen.',
                                detail: `${m.movementNumber} · ${m.productName} (${m.quantityDelta >= 0 ? `+${m.quantityDelta}` : m.quantityDelta})`,
                                onConfirm: async () => {
                                  await erp.deleteStockMovement(m.id);
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
              );
            })}
          </div>

          {/* Desktop Movements Table */}
          <Card className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-semibold">No. Pergerakan</th>
                    <th className="py-3 px-3 font-semibold">Tipe</th>
                    <th className="py-3 px-3 font-semibold">Produk</th>
                    <th className="py-3 px-3 font-semibold">Gudang</th>
                    <th className="py-3 px-3 font-semibold text-right">Perubahan</th>
                    <th className="py-3 px-3 font-semibold text-right">Stok Akhir</th>
                    <th className="py-3 px-3 font-semibold">Catatan</th>
                    <th className="py-3 px-4 font-semibold text-right">Aksi &amp; Dokumen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {state.stockMovements.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500">
                        Belum ada riwayat pergerakan stok gudang.
                      </td>
                    </tr>
                  )}
                  {state.stockMovements.map((m) => {
                    const linkedSo =
                      m.type === 'GOODS_ISSUE'
                        ? state.salesOrders.find(
                            (s) => s.id === m.referenceId || s.soNumber === m.referenceNumber
                          )
                        : undefined;
                    return (
                      <tr key={m.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">
                          {m.movementNumber}
                        </td>
                        <td className="py-2.5 px-3">
                          <StatusLabel
                            status={m.type}
                            tone={
                              m.type === 'GOODS_RECEIPT'
                                ? 'success'
                                : m.type === 'GOODS_ISSUE'
                                ? 'warning'
                                : 'info'
                            }
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-slate-900">{m.productName}</div>
                          <div className="text-[11px] font-mono text-slate-500">{m.productSku}</div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">
                          {m.warehouseName}
                          {m.targetWarehouseName ? ` → ${m.targetWarehouseName}` : ''}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono tabular-nums font-semibold ${
                            m.quantityDelta >= 0 ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {m.quantityDelta >= 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">{m.afterQty}</td>
                        <td className="py-2.5 px-3 text-slate-500">{m.notes || '-'}</td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap space-x-1">
                          {linkedSo && (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const cust = state.customers.find((c) => c.id === linkedSo.customerId);
                                  const wh = state.warehouses.find((w) => w.id === m.warehouseId);
                                  openPrintPreview(
                                    buildSuratJalanPrintDoc(linkedSo, state.settings, cust, wh, m),
                                    () => exportSuratJalanPdf(linkedSo, state.settings, cust, wh, m)
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
                                  void exportSuratJalanPdf(
                                    linkedSo,
                                    state.settings,
                                    state.customers.find((c) => c.id === linkedSo.customerId),
                                    state.warehouses.find((w) => w.id === m.warehouseId),
                                    m
                                  )
                                }
                              >
                                <FileDown className="h-3.5 w-3.5 text-[#1B5E99]" />
                                Surat Jalan
                              </Button>
                            </>
                          )}
                          {canDeleteBatch && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Hapus riwayat stok ${m.movementNumber}`}
                              onClick={() =>
                                setConfirmDelete({
                                  title: 'Hapus Riwayat Pergerakan Stok?',
                                  description: 'Catatan riwayat mutasi stok akan dihapus permanen.',
                                  detail: `${m.movementNumber} · ${m.productName} (${m.quantityDelta >= 0 ? `+${m.quantityDelta}` : m.quantityDelta})`,
                                  onConfirm: async () => {
                                    await erp.deleteStockMovement(m.id);
                                  },
                                })
                              }
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {!linkedSo && !canDeleteBatch && <span className="text-slate-300">-</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* SERIAL, BATCH & EXPIRY TRACKING */}
        <TabsContent value="batches" className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="border-red-200 bg-red-50/40">
              <CardContent className="p-4 flex items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-semibold text-red-700">Batch Kedaluwarsa</div>
                  <div className="text-xl font-bold font-mono tabular-nums text-red-800">
                    {batchAlerts.expired.length}
                  </div>
                </div>
                <ShieldAlert className="h-5 w-5 text-red-600 shrink-0" />
              </CardContent>
            </Card>
            <Card className="border-amber-200 bg-amber-50/40">
              <CardContent className="p-4 flex items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-semibold text-amber-800">Expired ≤ 60 Hari</div>
                  <div className="text-xl font-bold font-mono tabular-nums text-amber-900">
                    {batchAlerts.expiringSoon.length}
                  </div>
                </div>
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
              </CardContent>
            </Card>
            <Card className="border-[#BFD9EF] bg-[#EBF3FA]/50">
              <CardContent className="p-4 flex items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-semibold text-[#154C7E]">Garansi Berakhir ≤ 60 Hari</div>
                  <div className="text-xl font-bold font-mono tabular-nums text-[#0B1B3A]">
                    {batchAlerts.warrantyExpiringSoon.length}
                  </div>
                </div>
                <ClipboardCheck className="h-5 w-5 text-[#1B5E99] shrink-0" />
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl p-3.5">
            <div>
              <div className="text-sm font-semibold text-[#0B1B3A]">
                Pelacakan Batch, Nomor Seri &amp; Masa Garansi / Kedaluwarsa (FEFO)
              </div>
              <div className="text-xs text-slate-500">
                Pantau masa garansi produk IT dan tanggal kedaluwarsa material Packaging / Safety / MRO.
              </div>
            </div>
            {canInventory && (
              <Button
                type="button"
                variant="accent"
                size="sm"
                onClick={() => openBatchModal()}
                className="w-full sm:w-auto shrink-0"
              >
                <Plus className="h-4 w-4" />
                Catat Batch / Serial
              </Button>
            )}
          </div>

          {/* Mobile Batch Cards */}
          <div className="space-y-3 md:hidden">
            {state.inventoryBatches.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-xs text-slate-500">
                  Belum ada catatan batch atau nomor seri.
                </CardContent>
              </Card>
            ) : (
              state.inventoryBatches.map((bat) => {
                const isExpired = batchAlerts.expired.some((x) => x.id === bat.id);
                const isSoon = batchAlerts.expiringSoon.some((x) => x.id === bat.id);
                return (
                  <Card key={`m_bat_${bat.id}`}>
                    <CardContent className="p-4 space-y-2.5 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-mono font-bold text-[#0B1B3A]">
                            Batch: {bat.batchNumber}
                          </div>
                          {bat.serialNumber && (
                            <div className="font-mono text-[11px] text-[#1B5E99]">
                              SN: {bat.serialNumber}
                            </div>
                          )}
                        </div>
                        <StatusLabel
                          status={isExpired ? 'Expired' : isSoon ? 'Segera Expired' : bat.status}
                          tone={
                            isExpired || bat.status === 'Expired' || bat.status === 'Quarantine'
                              ? 'danger'
                              : isSoon
                              ? 'warning'
                              : bat.status === 'Active'
                              ? 'success'
                              : 'neutral'
                          }
                        />
                      </div>
                      <div>
                        <div className="font-semibold text-[#0B1B3A]">{bat.productName || bat.productId}</div>
                        <div className="text-[11px] font-mono text-slate-500">
                          {bat.productSku || '-'} · {bat.warehouseName || bat.warehouseId}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 rounded-lg bg-[#F4F7FB] p-2.5 text-[11px]">
                        <div>
                          <span className="text-slate-500 block">Qty</span>
                          <span className="font-mono font-bold text-[#0B1B3A]">{bat.qty}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Expired</span>
                          <span className="font-mono">{bat.expiryDate || '-'}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-slate-500 block">Garansi</span>
                          <span className="font-mono">{bat.warrantyUntil || '-'}</span>
                        </div>
                      </div>
                      {(canInventory || canDeleteBatch) && (
                        <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
                          {canInventory && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openBatchModal(bat)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </Button>
                          )}
                          {canDeleteBatch && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setConfirmDelete({
                                  title: 'Hapus Catatan Batch / Serial?',
                                  description: 'Catatan batch & serial produk akan dihapus permanen.',
                                  detail: `${bat.batchNumber} · ${bat.productName || bat.productId}`,
                                  onConfirm: async () => {
                                    await erp.deleteInventoryBatch(bat.id);
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

          {/* Desktop Batch Table */}
          <Card className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Batch &amp; Serial</th>
                    <th className="py-3 px-3 font-semibold">SKU &amp; Produk</th>
                    <th className="py-3 px-3 font-semibold">Gudang</th>
                    <th className="py-3 px-3 font-semibold text-right">Qty</th>
                    <th className="py-3 px-3 font-semibold">Tgl Expired</th>
                    <th className="py-3 px-3 font-semibold">Garansi s/d</th>
                    <th className="py-3 px-3 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {state.inventoryBatches.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500">
                        Belum ada data batch atau nomor seri.
                      </td>
                    </tr>
                  ) : (
                    state.inventoryBatches.map((bat) => {
                      const isExpired = batchAlerts.expired.some((x) => x.id === bat.id);
                      const isSoon = batchAlerts.expiringSoon.some((x) => x.id === bat.id);
                      return (
                        <tr key={bat.id} className="hover:bg-slate-50/70">
                          <td className="py-2.5 px-4">
                            <div className="font-mono font-semibold text-[#0B1B3A]">{bat.batchNumber}</div>
                            {bat.serialNumber && (
                              <div className="font-mono text-[11px] text-[#1B5E99]">SN: {bat.serialNumber}</div>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-slate-900">{bat.productName || bat.productId}</div>
                            <div className="font-mono text-[11px] text-slate-500">{bat.productSku || '-'}</div>
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">{bat.warehouseName || bat.warehouseId}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                            {bat.qty}
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-slate-600">
                            {bat.expiryDate || '-'}
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-slate-600">
                            {bat.warrantyUntil || '-'}
                          </td>
                          <td className="py-2.5 px-3">
                            <StatusLabel
                              status={isExpired ? 'Expired' : isSoon ? 'Segera Expired' : bat.status}
                              tone={
                                isExpired || bat.status === 'Expired' || bat.status === 'Quarantine'
                                  ? 'danger'
                                  : isSoon
                                  ? 'warning'
                                  : bat.status === 'Active'
                                  ? 'success'
                                  : 'neutral'
                              }
                            />
                          </td>
                          <td className="py-2.5 px-4 text-right whitespace-nowrap space-x-1">
                            {canInventory && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => openBatchModal(bat)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                Edit
                              </Button>
                            )}
                            {canDeleteBatch && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                aria-label={`Hapus batch ${bat.batchNumber}`}
                                onClick={() =>
                                  setConfirmDelete({
                                    title: 'Hapus Catatan Batch / Serial?',
                                    description: 'Catatan batch & serial produk akan dihapus permanen.',
                                    detail: `${bat.batchNumber} · ${bat.productName || bat.productId}`,
                                    onConfirm: async () => {
                                      await erp.deleteInventoryBatch(bat.id);
                                    },
                                  })
                                }
                                className="text-red-600 hover:bg-red-50"
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
      </Tabs>

      {/* BATCH / SERIAL MODAL */}
      <Dialog
        open={batchModal.open}
        onOpenChange={(open) => !open && setBatchModal((p) => ({ ...p, open: false }))}
      >
        <DialogContent size="lg" structured>
          <DialogHeader structured>
            <DialogTitle>
              {batchModal.isNew ? 'Catat Batch / Nomor Seri Baru' : `Edit Batch ${batchModal.batchNumber}`}
            </DialogTitle>
            <DialogDescription>
              Kelola nomor batch, serial number perangkat, tanggal expired, dan masa garansi produk.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col flex-1 min-h-0"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await erp.saveInventoryBatch({
                id: batchModal.id,
                isNew: batchModal.isNew,
                productId: batchModal.productId,
                warehouseId: batchModal.warehouseId,
                batchNumber: batchModal.batchNumber,
                serialNumber: batchModal.serialNumber || undefined,
                qty: Number(batchModal.qty) || 0,
                warrantyUntil: batchModal.warrantyUntil || undefined,
                expiryDate: batchModal.expiryDate || undefined,
                status: batchModal.status,
                notes: batchModal.notes || undefined,
              });
              if (ok) setBatchModal((p) => ({ ...p, open: false }));
            }}
          >
            <DialogBody>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="bat-prod">Produk</Label>
                  <NativeSelect
                    id="bat-prod"
                    value={batchModal.productId}
                    onChange={(e) => setBatchModal((p) => ({ ...p, productId: e.target.value }))}
                  >
                    {stockProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bat-wh">Gudang</Label>
                  <NativeSelect
                    id="bat-wh"
                    value={batchModal.warehouseId}
                    onChange={(e) => setBatchModal((p) => ({ ...p, warehouseId: e.target.value }))}
                  >
                    {state.warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} — {w.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bat-no">Nomor Batch *</Label>
                  <Input
                    id="bat-no"
                    required
                    placeholder="Contoh: BATCH-2026-11A"
                    value={batchModal.batchNumber}
                    onChange={(e) => setBatchModal((p) => ({ ...p, batchNumber: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bat-sn">Nomor Seri (Opsional)</Label>
                  <Input
                    id="bat-sn"
                    placeholder="SN-IT-..."
                    value={batchModal.serialNumber}
                    onChange={(e) => setBatchModal((p) => ({ ...p, serialNumber: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bat-qty">Kuantitas Batch</Label>
                  <Input
                    id="bat-qty"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={batchModal.qty}
                    onChange={(e) => setBatchModal((p) => ({ ...p, qty: sanitizeDigits(e.target.value) }))}
                    className="font-mono tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bat-status">Status Batch</Label>
                  <NativeSelect
                    id="bat-status"
                    value={batchModal.status}
                    onChange={(e) =>
                      setBatchModal((p) => ({ ...p, status: e.target.value as InventoryBatchStatus }))
                    }
                  >
                    <option value="Active">Active</option>
                    <option value="Quarantine">Quarantine</option>
                    <option value="Expired">Expired</option>
                    <option value="Depleted">Depleted</option>
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bat-exp">Tanggal Expired (Opsional)</Label>
                  <Input
                    id="bat-exp"
                    type="date"
                    value={batchModal.expiryDate}
                    onChange={(e) => setBatchModal((p) => ({ ...p, expiryDate: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bat-war">Garansi Berlaku s/d (Opsional)</Label>
                  <Input
                    id="bat-war"
                    type="date"
                    value={batchModal.warrantyUntil}
                    onChange={(e) => setBatchModal((p) => ({ ...p, warrantyUntil: e.target.value }))}
                  />
                </div>
              </div>
              <div className="border-t border-slate-100 pt-4 space-y-1.5">
                <Label htmlFor="bat-notes">Catatan Kondisi / Lokasi Rak</Label>
                <Textarea
                  id="bat-notes"
                  rows={3}
                  value={batchModal.notes}
                  onChange={(e) => setBatchModal((p) => ({ ...p, notes: e.target.value }))}
                />
              </div>
            </DialogBody>
            <DialogFooter className="sm:justify-end">
              <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 w-full sm:w-auto sm:ml-auto">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setBatchModal((p) => ({ ...p, open: false }))}
                >
                  Batal
                </Button>
                <Button type="submit" variant="accent">
                  Simpan Batch
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {/* CONFIRM DELETE INVENTORY RECORD DIALOG */}
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
              disabled={isDeleting}
              onClick={() => setConfirmDelete(null)}
            >
              Batal
            </Button>
            <Button
              type="button"
              disabled={isDeleting}
              onClick={async () => {
                if (!confirmDelete) return;
                setIsDeleting(true);
                try {
                  await confirmDelete.onConfirm();
                  setConfirmDelete(null);
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

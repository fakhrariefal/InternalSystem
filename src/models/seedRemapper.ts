import type {
  AccountingInvoice,
  AccountingPeriodLock,
  AppNotification,
  AuditLog,
  Category,
  ChartAccount,
  Customer,
  ErpState,
  GoodsReturn,
  InventoryBatch,
  JournalEntry,
  MonthlyBudget,
  Product,
  PurchaseOrder,
  SalesOrder,
  SalesQuotation,
  StockMovement,
  Supplier,
  Uom,
  VendorRfq,
  Warehouse,
} from './types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fnv1a32(input: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function deterministicUuid(companyId: string, namespace: string, rawId: string): string {
  const key = `${companyId}::${namespace}::${rawId}`;
  const p1 = fnv1a32(key, 0x811c9dc5);
  const p2 = fnv1a32(`${key}#2`, 0x9e3779b1);
  const p3 = fnv1a32(`${key}#3`, 0x85ebca6b);
  const p4 = fnv1a32(`${key}#4`, 0xc2b2ae35);

  const hex =
    p1.toString(16).padStart(8, '0') +
    p2.toString(16).padStart(8, '0') +
    p3.toString(16).padStart(8, '0') +
    p4.toString(16).padStart(8, '0');

  // Set RFC-4122 version (4) and variant (8)
  const chars = hex.split('');
  chars[12] = '4';
  chars[16] = ['8', '9', 'a', 'b'][parseInt(chars[16], 16) % 4];
  const normalized = chars.join('');

  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20, 32)}`;
}

export function remapSeedStateForCompany(
  seed: ErpState,
  companyId: string,
  actorProfileId: string
): ErpState {
  const safeActorId = UUID_REGEX.test(actorProfileId)
    ? actorProfileId
    : deterministicUuid(companyId, 'profile', actorProfileId || 'actor');

  const idMap = new Map<string, string>();
  const registerId = (namespace: string, oldId: string): string => {
    if (!oldId) return '';
    if (UUID_REGEX.test(oldId)) {
      idMap.set(oldId, oldId);
      return oldId;
    }
    const existing = idMap.get(oldId);
    if (existing) return existing;
    const mapped = deterministicUuid(companyId, namespace, oldId);
    idMap.set(oldId, mapped);
    return mapped;
  };

  const resolveOptionalId = (oldId?: string): string | undefined => {
    if (!oldId) return undefined;
    if (UUID_REGEX.test(oldId)) return oldId;
    return idMap.get(oldId);
  };

  // 1. Register primary entity IDs first so all FKs resolve cleanly regardless of order
  for (const w of seed.warehouses) registerId('warehouse', w.id);
  for (const c of seed.categories) registerId('category', c.id);
  for (const u of seed.uoms) registerId('uom', u.id);
  for (const s of seed.suppliers) registerId('supplier', s.id);
  for (const cu of seed.customers) registerId('customer', cu.id);
  for (const p of seed.products) registerId('product', p.id);
  for (const a of seed.chartOfAccounts) registerId('coa', a.id);
  for (const q of seed.salesQuotations) registerId('quotation', q.id);
  for (const po of seed.purchaseOrders) {
    registerId('po', po.id);
    for (const log of po.logs || []) registerId('po_log', log.id);
  }
  for (const so of seed.salesOrders) registerId('so', so.id);
  for (const rfq of seed.vendorRfqs) registerId('rfq', rfq.id);
  for (const gr of seed.goodsReturns) registerId('return', gr.id);
  for (const b of seed.inventoryBatches) registerId('batch', b.id);
  for (const m of seed.stockMovements) registerId('movement', m.id);
  for (const inv of seed.invoices) {
    registerId('invoice', inv.id);
    for (const pay of inv.payments || []) registerId('invoice_payment', pay.id);
  }
  for (const j of seed.journalEntries) registerId('journal', j.id);
  for (const pc of seed.periodClosings) registerId('period', pc.id);
  for (const b of seed.budgets) registerId('budget', b.id);
  for (const aud of seed.auditLogs) registerId('audit', aud.id);
  for (const n of seed.notifications) registerId('notif', n.id);

  // 2. Remap each collection with full FK preservation
  const warehouses: Warehouse[] = seed.warehouses.map((w) => ({
    ...w,
    id: idMap.get(w.id)!,
  }));

  const categories: Category[] = seed.categories.map((c) => ({
    ...c,
    id: idMap.get(c.id)!,
  }));

  const uoms: Uom[] = seed.uoms.map((u) => ({
    ...u,
    id: idMap.get(u.id)!,
  }));

  const suppliers: Supplier[] = seed.suppliers.map((s) => ({
    ...s,
    id: idMap.get(s.id)!,
    createdBy: safeActorId,
    ...(s.verifiedBy ? { verifiedBy: safeActorId } : {}),
  }));

  const customers: Customer[] = seed.customers.map((cu) => ({
    ...cu,
    id: idMap.get(cu.id)!,
    createdBy: safeActorId,
    ...(cu.verifiedBy ? { verifiedBy: safeActorId } : {}),
    contractPrices: (cu.contractPrices || []).map((tier) => ({
      ...tier,
      productId: idMap.get(tier.productId) || tier.productId,
    })),
  }));

  const products: Product[] = seed.products.map((p) => {
    const remappedStocks: Record<string, number> = {};
    for (const [whId, qty] of Object.entries(p.warehouseStocks || {})) {
      remappedStocks[idMap.get(whId) || whId] = qty;
    }
    return {
      ...p,
      id: idMap.get(p.id)!,
      categoryId: idMap.get(p.categoryId) || p.categoryId,
      warehouseStocks: remappedStocks,
      createdBy: safeActorId,
    };
  });

  const chartOfAccounts: ChartAccount[] = seed.chartOfAccounts.map((a) => ({
    ...a,
    id: idMap.get(a.id)!,
    createdBy: safeActorId,
  }));

  const salesQuotations: SalesQuotation[] = seed.salesQuotations.map((q) => ({
    ...q,
    id: idMap.get(q.id)!,
    customerId: idMap.get(q.customerId) || q.customerId,
    warehouseId: idMap.get(q.warehouseId) || q.warehouseId,
    items: q.items.map((it) => ({
      ...it,
      productId: idMap.get(it.productId) || it.productId,
    })),
    ...(q.convertedSoId ? { convertedSoId: resolveOptionalId(q.convertedSoId) } : {}),
    createdBy: safeActorId,
  }));

  const purchaseOrders: PurchaseOrder[] = seed.purchaseOrders.map((po) => ({
    ...po,
    id: idMap.get(po.id)!,
    supplierId: idMap.get(po.supplierId) || po.supplierId,
    warehouseId: idMap.get(po.warehouseId) || po.warehouseId,
    items: po.items.map((it) => ({
      ...it,
      productId: idMap.get(it.productId) || it.productId,
    })),
    createdBy: safeActorId,
    ...(po.approvedBy ? { approvedBy: safeActorId } : {}),
    ...(po.directorApprovedBy ? { directorApprovedBy: safeActorId } : {}),
    logs: (po.logs || []).map((log) => ({
      ...log,
      id: idMap.get(log.id)!,
      actorId: safeActorId,
    })),
  }));

  const salesOrders: SalesOrder[] = seed.salesOrders.map((so) => ({
    ...so,
    id: idMap.get(so.id)!,
    customerId: idMap.get(so.customerId) || so.customerId,
    warehouseId: idMap.get(so.warehouseId) || so.warehouseId,
    ...(so.quotationId ? { quotationId: resolveOptionalId(so.quotationId) } : {}),
    items: so.items.map((it) => ({
      ...it,
      productId: idMap.get(it.productId) || it.productId,
    })),
    createdBy: safeActorId,
  }));

  const vendorRfqs: VendorRfq[] = seed.vendorRfqs.map((rfq) => ({
    ...rfq,
    id: idMap.get(rfq.id)!,
    warehouseId: idMap.get(rfq.warehouseId) || rfq.warehouseId,
    items: rfq.items.map((it) => ({
      ...it,
      productId: idMap.get(it.productId) || it.productId,
    })),
    invitedSupplierIds: (rfq.invitedSupplierIds || []).map((sid) => idMap.get(sid) || sid),
    quotes: (rfq.quotes || []).map((q) => {
      const remappedPrices: Record<string, number> = {};
      for (const [prodKey, price] of Object.entries(q.unitPrices || {})) {
        remappedPrices[idMap.get(prodKey) || prodKey] = price;
      }
      return {
        ...q,
        supplierId: idMap.get(q.supplierId) || q.supplierId,
        unitPrices: remappedPrices,
      };
    }),
    ...(rfq.awardedSupplierId ? { awardedSupplierId: resolveOptionalId(rfq.awardedSupplierId) } : {}),
    ...(rfq.awardedPoId ? { awardedPoId: resolveOptionalId(rfq.awardedPoId) } : {}),
    createdBy: safeActorId,
  }));

  const goodsReturns: GoodsReturn[] = seed.goodsReturns.map((gr) => ({
    ...gr,
    id: idMap.get(gr.id)!,
    referenceOrderId: idMap.get(gr.referenceOrderId) || gr.referenceOrderId,
    counterpartyId: idMap.get(gr.counterpartyId) || gr.counterpartyId,
    warehouseId: idMap.get(gr.warehouseId) || gr.warehouseId,
    items: gr.items.map((it) => ({
      ...it,
      productId: idMap.get(it.productId) || it.productId,
    })),
    createdBy: safeActorId,
    ...(gr.completedBy ? { completedBy: safeActorId } : {}),
  }));

  const inventoryBatches: InventoryBatch[] = seed.inventoryBatches.map((b) => ({
    ...b,
    id: idMap.get(b.id)!,
    productId: idMap.get(b.productId) || b.productId,
    warehouseId: idMap.get(b.warehouseId) || b.warehouseId,
    createdBy: safeActorId,
  }));

  const stockMovements: StockMovement[] = seed.stockMovements.map((m) => ({
    ...m,
    id: idMap.get(m.id)!,
    ...(m.referenceId ? { referenceId: resolveOptionalId(m.referenceId) } : {}),
    productId: idMap.get(m.productId) || m.productId,
    warehouseId: idMap.get(m.warehouseId) || m.warehouseId,
    ...(m.targetWarehouseId ? { targetWarehouseId: resolveOptionalId(m.targetWarehouseId) } : {}),
    createdBy: safeActorId,
  }));

  const invoices: AccountingInvoice[] = seed.invoices.map((inv) => ({
    ...inv,
    id: idMap.get(inv.id)!,
    counterpartyId: idMap.get(inv.counterpartyId) || inv.counterpartyId,
    ...(inv.referenceOrderId ? { referenceOrderId: resolveOptionalId(inv.referenceOrderId) } : {}),
    createdBy: safeActorId,
    payments: (inv.payments || []).map((pay) => ({
      ...pay,
      id: idMap.get(pay.id)!,
      recordedBy: safeActorId,
    })),
  }));

  const journalEntries: JournalEntry[] = seed.journalEntries.map((j) => ({
    ...j,
    id: idMap.get(j.id)!,
    ...(j.referenceId ? { referenceId: resolveOptionalId(j.referenceId) } : {}),
    lines: j.lines.map((line) => ({
      ...line,
      accountId: idMap.get(line.accountId) || line.accountId,
    })),
    createdBy: safeActorId,
  }));

  const periodClosings: AccountingPeriodLock[] = seed.periodClosings.map((pc) => ({
    ...pc,
    id: idMap.get(pc.id)!,
    lockedBy: safeActorId,
  }));

  const budgets: MonthlyBudget[] = seed.budgets.map((b) => ({
    ...b,
    id: idMap.get(b.id)!,
    updatedBy: safeActorId,
  }));

  const auditLogs: AuditLog[] = seed.auditLogs.map((aud) => ({
    ...aud,
    id: idMap.get(aud.id)!,
    ...(aud.targetId ? { targetId: idMap.get(aud.targetId) || aud.targetId } : {}),
    actorId: safeActorId,
  }));

  const notifications: AppNotification[] = seed.notifications.map((n) => ({
    ...n,
    id: idMap.get(n.id)!,
    readBy: [],
  }));

  return {
    ...seed,
    warehouses,
    categories,
    uoms,
    suppliers,
    customers,
    products,
    chartOfAccounts,
    salesQuotations,
    purchaseOrders,
    salesOrders,
    vendorRfqs,
    goodsReturns,
    inventoryBatches,
    stockMovements,
    invoices,
    journalEntries,
    periodClosings,
    budgets,
    auditLogs,
    notifications,
    settings: {
      ...seed.settings,
      id: companyId,
      updatedBy: safeActorId,
    },
  };
}

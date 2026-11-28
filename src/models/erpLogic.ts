import {
  BLUEPRINT_CONSTRAINTS,
  type AccountCategory,
  type AccountingInvoice,
  type AccountingPeriodLock,
  type AppModule,
  type BuyerPaymentScheme,
  type ChartAccount,
  type CompanySettings,
  type CurrencyCode,
  type Customer,
  type GoodsReturn,
  type InventoryBatch,
  type InvoiceStatus,
  type JournalEntry,
  type JournalLine,
  type MonthlyBudget,
  type OrderItem,
  type PartnerVerificationStatus,
  type PoStatus,
  type Product,
  type PurchaseOrder,
  type SalesOrder,
  type SoStatus,
  type Supplier,
  type SupplierPaymentScheme,
} from './types';

export function convertToIdr(
  amount: number,
  currency: CurrencyCode,
  usdToIdrRate: number
): number {
  if (!Number.isFinite(amount)) return 0;
  if (currency === 'USD') {
    const rate = usdToIdrRate > 0 ? usdToIdrRate : 16000;
    return Math.round(amount * rate);
  }
  return Math.round(amount);
}

export function formatCurrency(amount: number, currency: CurrencyCode = 'IDR'): string {
  if (currency === 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

export function formatCompactIdr(amount: number, lang: 'id' | 'en' = 'id'): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) {
    return `Rp ${(amount / 1_000_000_000).toFixed(2)} ${lang === 'en' ? 'B' : 'M'}`;
  }
  if (abs >= 1_000_000) {
    return `Rp ${(amount / 1_000_000).toFixed(1)} ${lang === 'en' ? 'M' : 'Jt'}`;
  }
  return formatCurrency(amount, 'IDR');
}

export function calculateOrderTotals(
  items: Pick<OrderItem, 'qty' | 'unitPrice'>[],
  taxRatePercent: number = 11
): { subtotal: number; taxAmount: number; totalAmount: number } {
  const subtotal = items.reduce((sum, item) => {
    const q = Math.max(0, Number(item.qty) || 0);
    const p = Math.max(0, Number(item.unitPrice) || 0);
    return sum + q * p;
  }, 0);
  const clampedTax = Math.max(0, Math.min(100, taxRatePercent));
  const taxAmount = Math.round((subtotal * clampedTax) / 100 * 100) / 100;
  const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100;
  return { subtotal, taxAmount, totalAmount };
}

export function getTotalProductStock(product: Product): number {
  return Object.values(product.warehouseStocks || {}).reduce(
    (sum, qty) => sum + (Number(qty) || 0),
    0
  );
}

export function isLowStockProduct(product: Product): boolean {
  if (product.isService) return false;
  return product.active && getTotalProductStock(product) <= product.minStock;
}

export function calculateTotalStockValueIdr(
  products: Product[],
  usdToIdrRate: number
): number {
  return products.reduce((total, product) => {
    if (product.isService) return total;
    const qty = getTotalProductStock(product);
    const unitCostIdr = convertToIdr(product.buyPrice, product.currency, usdToIdrRate);
    return total + qty * unitCostIdr;
  }, 0);
}

export function canTransitionPoStatus(from: PoStatus, to: PoStatus): boolean {
  const transitions: Record<PoStatus, PoStatus[]> = {
    Draft: ['Submitted', 'Cancelled'],
    Submitted: ['Approved by Manager', 'Cancelled'],
    'Approved by Manager': ['Ordered', 'Partially Received', 'Fully Received', 'Cancelled'],
    Ordered: ['Partially Received', 'Fully Received', 'Cancelled'],
    'Partially Received': ['Partially Received', 'Fully Received', 'Cancelled'],
    'Fully Received': ['Closed'],
    Closed: [],
    Cancelled: [],
  };
  return transitions[from]?.includes(to) ?? false;
}

export function canTransitionSoStatus(from: SoStatus, to: SoStatus): boolean {
  const transitions: Record<SoStatus, SoStatus[]> = {
    Draft: ['Confirmed'],
    Confirmed: ['Partially Delivered', 'Fully Delivered'],
    'Partially Delivered': ['Partially Delivered', 'Fully Delivered'],
    'Fully Delivered': ['Invoiced'],
    Invoiced: ['Closed'],
    Closed: [],
  };
  return transitions[from]?.includes(to) ?? false;
}

export function computeInvoiceStatus(
  totalAmount: number,
  paidAmount: number,
  dueDateIso: string,
  nowDate: Date = new Date()
): { balanceDue: number; status: InvoiceStatus } {
  const safeTotal = Math.max(0, totalAmount);
  const safePaid = Math.max(0, Math.min(safeTotal, paidAmount));
  const balanceDue = Math.max(0, Math.round((safeTotal - safePaid) * 100) / 100);

  if (balanceDue <= 0.001) {
    return { balanceDue: 0, status: 'PAID' };
  }

  const dueTime = new Date(dueDateIso).getTime();
  const isOverdue = Number.isFinite(dueTime) && dueTime < nowDate.getTime();

  if (safePaid > 0) {
    return { balanceDue, status: isOverdue ? 'OVERDUE' : 'PARTIAL' };
  }
  return { balanceDue, status: isOverdue ? 'OVERDUE' : 'UNPAID' };
}

export type AgingBucket = 'Belum Jatuh Tempo' | '1-30 Hari' | '31-60 Hari' | '61-90 Hari' | '> 90 Hari';

export function getAgingBucket(dueDateIso: string, nowDate: Date = new Date()): AgingBucket {
  const due = new Date(dueDateIso);
  if (Number.isNaN(due.getTime())) return 'Belum Jatuh Tempo';
  const diffMs = nowDate.getTime() - due.getTime();
  const daysPastDue = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (daysPastDue <= 0) return 'Belum Jatuh Tempo';
  if (daysPastDue <= 30) return '1-30 Hari';
  if (daysPastDue <= 60) return '31-60 Hari';
  if (daysPastDue <= 90) return '61-90 Hari';
  return '> 90 Hari';
}

export function summarizeAgingReport(
  invoices: AccountingInvoice[],
  ledgerType: 'AP' | 'AR',
  usdToIdrRate: number,
  nowDate: Date = new Date()
): Record<AgingBucket, number> {
  const summary: Record<AgingBucket, number> = {
    'Belum Jatuh Tempo': 0,
    '1-30 Hari': 0,
    '31-60 Hari': 0,
    '61-90 Hari': 0,
    '> 90 Hari': 0,
  };

  for (const inv of invoices) {
    if (inv.ledgerType !== ledgerType || inv.balanceDue <= 0) continue;
    const bucket = getAgingBucket(inv.dueDate, nowDate);
    const rate = inv.exchangeRate || usdToIdrRate;
    summary[bucket] += convertToIdr(inv.balanceDue, inv.currency, rate);
  }
  return summary;
}

export function isPoOverdue(po: PurchaseOrder, nowDate: Date = new Date()): boolean {
  if (!po.expectedDate) return false;
  if (['Fully Received', 'Closed', 'Cancelled'].includes(po.status)) return false;
  const expected = new Date(po.expectedDate);
  return !Number.isNaN(expected.getTime()) && expected.getTime() < nowDate.getTime();
}

export function checkSoStockAvailability(
  soItems: Pick<OrderItem, 'productId' | 'qty' | 'fulfilledQty' | 'isService'>[],
  warehouseId: string,
  products: Product[]
): { sufficient: boolean; shortages: { productId: string; needed: number; available: number }[] } {
  const shortages: { productId: string; needed: number; available: number }[] = [];
  for (const item of soItems) {
    const prod = products.find((p) => p.id === item.productId);
    if (item.isService || prod?.isService) continue;
    const needed = Math.max(0, item.qty - item.fulfilledQty);
    if (needed <= 0) continue;
    const available = prod?.warehouseStocks?.[warehouseId] ?? 0;
    if (available < needed) {
      shortages.push({ productId: item.productId, needed, available });
    }
  }
  return { sufficient: shortages.length === 0, shortages };
}

export function buildSixMonthChartSeries(
  purchaseOrders: PurchaseOrder[],
  salesOrders: SalesOrder[],
  usdToIdrRate: number,
  referenceDate: Date = new Date(),
  lang: 'id' | 'en' = 'id'
): { monthLabel: string; pembelianIdr: number; penjualanIdr: number }[] {
  const monthNames =
    lang === 'en'
      ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      : ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const buckets: { key: string; label: string; pembelianIdr: number; penjualanIdr: number }[] = [];

  for (let offset = 5; offset >= 0; offset--) {
    const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - offset, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    buckets.push({
      key,
      label: `${monthNames[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`,
      pembelianIdr: 0,
      penjualanIdr: 0,
    });
  }

  for (const po of purchaseOrders) {
    if (po.status === 'Cancelled' || po.status === 'Draft') continue;
    const key = (po.createdAt || '').slice(0, 7);
    const bucket = buckets.find((b) => b.key === key);
    if (bucket) {
      bucket.pembelianIdr += convertToIdr(po.totalAmount, po.currency, po.exchangeRate || usdToIdrRate);
    }
  }

  for (const so of salesOrders) {
    if (so.status === 'Draft') continue;
    const key = (so.createdAt || '').slice(0, 7);
    const bucket = buckets.find((b) => b.key === key);
    if (bucket) {
      bucket.penjualanIdr += convertToIdr(so.totalAmount, so.currency, usdToIdrRate);
    }
  }

  return buckets.map(({ label, pembelianIdr, penjualanIdr }) => ({
    monthLabel: label,
    pembelianIdr,
    penjualanIdr,
  }));
}

export function validateBlueprintId(id: string): boolean {
  return (
    typeof id === 'string' &&
    id.length >= 1 &&
    id.length <= BLUEPRINT_CONSTRAINTS.ID_MAX_LENGTH &&
    BLUEPRINT_CONSTRAINTS.ID_PATTERN.test(id)
  );
}

export function sanitizeString(val: string | undefined, maxLen: number): string {
  return (val ?? '').trim().slice(0, maxLen);
}

export function normalizeUserEmail(email: string): string {
  return (email ?? '').trim().toLowerCase().slice(0, 254);
}

export function isValidEmailFormat(email: string): boolean {
  const normalized = normalizeUserEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export function isEmailRegistered(
  users: Array<{ uid: string; email: string }>,
  email: string,
  excludeUid?: string
): boolean {
  const target = normalizeUserEmail(email);
  if (!target) return false;
  return users.some(
    (u) => u.uid !== excludeUid && normalizeUserEmail(u.email) === target
  );
}

export interface DummyMasterTargets {
  productIds: string[];
  supplierIds: string[];
  customerIds: string[];
  warehouseIds: string[];
  categoryIds: string[];
  uomIds: string[];
  totalCount: number;
}

export function findSeededDummyMasterTargets(
  current: {
    products: Array<{ id: string }>;
    suppliers: Array<{ id: string }>;
    customers: Array<{ id: string }>;
    warehouses: Array<{ id: string }>;
    categories: Array<{ id: string }>;
    uoms: Array<{ id: string }>;
  },
  seed: {
    products: Array<{ id: string }>;
    suppliers: Array<{ id: string }>;
    customers: Array<{ id: string }>;
    warehouses: Array<{ id: string }>;
    categories: Array<{ id: string }>;
    uoms: Array<{ id: string }>;
  }
): DummyMasterTargets {
  const seedProdIds = new Set(seed.products.map((x) => x.id));
  const seedSupIds = new Set(seed.suppliers.map((x) => x.id));
  const seedCusIds = new Set(seed.customers.map((x) => x.id));
  const seedWhIds = new Set(seed.warehouses.map((x) => x.id));
  const seedCatIds = new Set(seed.categories.map((x) => x.id));
  const seedUomIds = new Set(seed.uoms.map((x) => x.id));

  const productIds = current.products.filter((x) => seedProdIds.has(x.id)).map((x) => x.id);
  const supplierIds = current.suppliers.filter((x) => seedSupIds.has(x.id)).map((x) => x.id);
  const customerIds = current.customers.filter((x) => seedCusIds.has(x.id)).map((x) => x.id);
  const warehouseIds = current.warehouses.filter((x) => seedWhIds.has(x.id)).map((x) => x.id);
  const categoryIds = current.categories.filter((x) => seedCatIds.has(x.id)).map((x) => x.id);
  const uomIds = current.uoms.filter((x) => seedUomIds.has(x.id)).map((x) => x.id);

  return {
    productIds,
    supplierIds,
    customerIds,
    warehouseIds,
    categoryIds,
    uomIds,
    totalCount:
      productIds.length +
      supplierIds.length +
      customerIds.length +
      warehouseIds.length +
      categoryIds.length +
      uomIds.length,
  };
}

export interface DummyOrderTargets {
  poIds: string[];
  soIds: string[];
  totalCount: number;
}

export function findSeededDummyOrderTargets(
  current: {
    purchaseOrders: Array<{ id: string }>;
    salesOrders: Array<{ id: string }>;
  },
  seed: {
    purchaseOrders: Array<{ id: string }>;
    salesOrders: Array<{ id: string }>;
  }
): DummyOrderTargets {
  const seedPoIds = new Set(seed.purchaseOrders.map((x) => x.id));
  const seedSoIds = new Set(seed.salesOrders.map((x) => x.id));

  const poIds = current.purchaseOrders.filter((x) => seedPoIds.has(x.id)).map((x) => x.id);
  const soIds = current.salesOrders.filter((x) => seedSoIds.has(x.id)).map((x) => x.id);

  return {
    poIds,
    soIds,
    totalCount: poIds.length + soIds.length,
  };
}

// =========================================================================
// General Ledger (Buku Besar) & Financial Statements Engine
// =========================================================================

export function validateBalancedJournalLines(
  lines: Array<Pick<JournalLine, 'accountId' | 'debitIdr' | 'creditIdr'>>
): {
  valid: boolean;
  totalDebitIdr: number;
  totalCreditIdr: number;
  differenceIdr: number;
  error?: string;
} {
  if (!Array.isArray(lines) || lines.length < 2) {
    return {
      valid: false,
      totalDebitIdr: 0,
      totalCreditIdr: 0,
      differenceIdr: 0,
      error: 'Jurnal wajib memiliki minimal 2 baris akun (Debit & Kredit).',
    };
  }
  if (lines.length > 30) {
    return {
      valid: false,
      totalDebitIdr: 0,
      totalCreditIdr: 0,
      differenceIdr: 0,
      error: 'Maksimal 30 baris akun per dokumen jurnal.',
    };
  }

  let totalDebit = 0;
  let totalCredit = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.accountId) {
      return {
        valid: false,
        totalDebitIdr: totalDebit,
        totalCreditIdr: totalCredit,
        differenceIdr: Math.abs(totalDebit - totalCredit),
        error: `Baris ${i + 1}: Akun belum dipilih.`,
      };
    }
    const d = Math.round(Number(line.debitIdr) || 0);
    const c = Math.round(Number(line.creditIdr) || 0);
    if (d < 0 || c < 0) {
      return {
        valid: false,
        totalDebitIdr: totalDebit,
        totalCreditIdr: totalCredit,
        differenceIdr: Math.abs(totalDebit - totalCredit),
        error: `Baris ${i + 1}: Nominal Debit/Kredit tidak boleh negatif.`,
      };
    }
    if ((d === 0 && c === 0) || (d > 0 && c > 0)) {
      return {
        valid: false,
        totalDebitIdr: totalDebit,
        totalCreditIdr: totalCredit,
        differenceIdr: Math.abs(totalDebit - totalCredit),
        error: `Baris ${i + 1}: Isi salah satu nominal Debit atau Kredit (> 0).`,
      };
    }
    totalDebit += d;
    totalCredit += c;
  }

  const diff = Math.abs(totalDebit - totalCredit);
  if (totalDebit <= 0) {
    return {
      valid: false,
      totalDebitIdr: totalDebit,
      totalCreditIdr: totalCredit,
      differenceIdr: diff,
      error: 'Total nominal jurnal harus lebih besar dari Rp 0.',
    };
  }
  if (diff !== 0) {
    return {
      valid: false,
      totalDebitIdr: totalDebit,
      totalCreditIdr: totalCredit,
      differenceIdr: diff,
      error: `Jurnal belum seimbang (selisih ${formatCurrency(diff, 'IDR')}).`,
    };
  }

  return {
    valid: true,
    totalDebitIdr: totalDebit,
    totalCreditIdr: totalCredit,
    differenceIdr: 0,
  };
}

export function isCashBankAccount(account: Pick<ChartAccount, 'id' | 'code' | 'name' | 'category'>): boolean {
  if (account.category !== 'Aset') return false;
  const code = (account.code || '').trim().toLowerCase();
  const name = (account.name || '').trim().toLowerCase();

  // Exclude non-cash standard current asset keywords unless explicitly prefixed as cash/bank
  const isReceivableOrStockOrTax =
    name.includes('piutang') ||
    name.includes('persediaan') ||
    name.includes('ppn') ||
    name.includes('pajak') ||
    name.includes('inventori') ||
    name.includes('inventory');
  if (isReceivableOrStockOrTax) return false;

  if (
    account.id === 'coa_1101' ||
    account.id === 'coa_1102' ||
    account.id === 'coa_1103' ||
    code.startsWith('11') ||
    code.startsWith('1-11') ||
    code.startsWith('1.11')
  ) {
    return true;
  }

  return (
    name.includes('kas') ||
    name.includes('cash') ||
    name.includes('bank') ||
    name.includes('giro') ||
    name.includes('petty') ||
    name.includes('rekening') ||
    name.includes('dompet') ||
    name.includes('ewallet') ||
    name.includes('e-wallet') ||
    name.includes('treasury')
  );
}

export function getCashBankAccounts(accounts: ChartAccount[]): ChartAccount[] {
  const active = accounts
    .filter((a) => a.active)
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code));
  const cashBank = active.filter(isCashBankAccount);
  if (cashBank.length > 0) return cashBank;
  // Graceful fallback if user uses custom numbering outside 11xx without cash/bank keywords
  return active.filter((a) => a.category === 'Aset');
}

export function pickCashBankAccountId(paymentMethod: string, accounts?: ChartAccount[]): string {
  const lower = (paymentMethod || '').toLowerCase();
  if (accounts && accounts.length > 0) {
    const candidates = getCashBankAccounts(accounts);
    const byCode = candidates.find((a) => a.code && lower.includes(a.code.toLowerCase()));
    if (byCode) return byCode.id;
    const byName = candidates.find((a) => a.name && lower.includes(a.name.toLowerCase()));
    if (byName) return byName.id;
  }
  if (lower.includes('kas') || lower.includes('tunai')) {
    const fallbackKas = accounts?.find((a) => a.id === 'coa_1101' || a.code === '1101');
    return fallbackKas?.id || 'coa_1101';
  }
  if (lower.includes('bca')) {
    const fallbackBca = accounts?.find((a) => a.id === 'coa_1103' || a.code === '1103');
    return fallbackBca?.id || 'coa_1103';
  }
  const fallbackBank = accounts?.find((a) => a.id === 'coa_1102' || a.code === '1102');
  return fallbackBank?.id || 'coa_1102';
}

export interface LedgerTransactionRow {
  entryId: string;
  entryNumber: string;
  entryDate: string;
  journalType: JournalEntry['journalType'];
  referenceNumber?: string;
  description: string;
  memo?: string;
  debitIdr: number;
  creditIdr: number;
  runningBalanceIdr: number;
}

export interface AccountLedgerStatement {
  account: ChartAccount;
  openingBalanceIdr: number;
  totalDebitIdr: number;
  totalCreditIdr: number;
  closingBalanceIdr: number;
  rows: LedgerTransactionRow[];
}

export function computeLedgerStatement(
  account: ChartAccount,
  entries: JournalEntry[],
  startDate?: string,
  endDate?: string
): AccountLedgerStatement {
  const posted = entries
    .filter((e) => e.status === 'Posted')
    .slice()
    .sort((a, b) => {
      if (a.entryDate !== b.entryDate) return a.entryDate.localeCompare(b.entryDate);
      return a.createdAt.localeCompare(b.createdAt);
    });

  let opening = Math.round(Number(account.openingBalanceIdr) || 0);
  const rows: LedgerTransactionRow[] = [];
  let periodDebit = 0;
  let periodCredit = 0;

  const applyDelta = (bal: number, d: number, c: number) =>
    account.normalBalance === 'Debit' ? bal + d - c : bal + c - d;

  for (const entry of posted) {
    if (endDate && entry.entryDate > endDate) continue;
    for (const line of entry.lines) {
      if (line.accountId !== account.id) continue;
      const d = Math.round(Number(line.debitIdr) || 0);
      const c = Math.round(Number(line.creditIdr) || 0);
      if (startDate && entry.entryDate < startDate) {
        opening = applyDelta(opening, d, c);
      } else {
        periodDebit += d;
        periodCredit += c;
        const prevBalance =
          rows.length > 0 ? rows[rows.length - 1].runningBalanceIdr : opening;
        const runningBalanceIdr = applyDelta(prevBalance, d, c);
        rows.push({
          entryId: entry.id,
          entryNumber: entry.entryNumber,
          entryDate: entry.entryDate,
          journalType: entry.journalType,
          referenceNumber: entry.referenceNumber,
          description: entry.description,
          memo: line.memo,
          debitIdr: d,
          creditIdr: c,
          runningBalanceIdr,
        });
      }
    }
  }

  const closingBalanceIdr =
    rows.length > 0 ? rows[rows.length - 1].runningBalanceIdr : opening;

  return {
    account,
    openingBalanceIdr: opening,
    totalDebitIdr: periodDebit,
    totalCreditIdr: periodCredit,
    closingBalanceIdr,
    rows,
  };
}

export interface TrialBalanceRow {
  account: ChartAccount;
  openingBalanceIdr: number;
  periodDebitIdr: number;
  periodCreditIdr: number;
  closingBalanceIdr: number;
  endingDebitIdr: number;
  endingCreditIdr: number;
}

export interface TrialBalanceSummary {
  rows: TrialBalanceRow[];
  totalPeriodDebitIdr: number;
  totalPeriodCreditIdr: number;
  totalEndingDebitIdr: number;
  totalEndingCreditIdr: number;
  isBalanced: boolean;
}

export function computeTrialBalance(
  accounts: ChartAccount[],
  entries: JournalEntry[],
  startDate?: string,
  endDate?: string
): TrialBalanceSummary {
  const sortedAccounts = accounts
    .filter((a) => a.active)
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code));

  let totalPeriodDebitIdr = 0;
  let totalPeriodCreditIdr = 0;
  let totalEndingDebitIdr = 0;
  let totalEndingCreditIdr = 0;

  const rows: TrialBalanceRow[] = sortedAccounts.map((acc) => {
    const stmt = computeLedgerStatement(acc, entries, startDate, endDate);
    totalPeriodDebitIdr += stmt.totalDebitIdr;
    totalPeriodCreditIdr += stmt.totalCreditIdr;

    let endingDebitIdr = 0;
    let endingCreditIdr = 0;
    if (acc.normalBalance === 'Debit') {
      if (stmt.closingBalanceIdr >= 0) {
        endingDebitIdr = stmt.closingBalanceIdr;
      } else {
        endingCreditIdr = Math.abs(stmt.closingBalanceIdr);
      }
    } else {
      if (stmt.closingBalanceIdr >= 0) {
        endingCreditIdr = stmt.closingBalanceIdr;
      } else {
        endingDebitIdr = Math.abs(stmt.closingBalanceIdr);
      }
    }

    totalEndingDebitIdr += endingDebitIdr;
    totalEndingCreditIdr += endingCreditIdr;

    return {
      account: acc,
      openingBalanceIdr: stmt.openingBalanceIdr,
      periodDebitIdr: stmt.totalDebitIdr,
      periodCreditIdr: stmt.totalCreditIdr,
      closingBalanceIdr: stmt.closingBalanceIdr,
      endingDebitIdr,
      endingCreditIdr,
    };
  });

  return {
    rows,
    totalPeriodDebitIdr,
    totalPeriodCreditIdr,
    totalEndingDebitIdr,
    totalEndingCreditIdr,
    isBalanced: Math.round(totalEndingDebitIdr) === Math.round(totalEndingCreditIdr),
  };
}

export interface FinancialLineSummary {
  accountId: string;
  code: string;
  name: string;
  category: AccountCategory;
  amountIdr: number;
}

export interface IncomeStatementSummary {
  revenues: FinancialLineSummary[];
  cogs: FinancialLineSummary[];
  expenses: FinancialLineSummary[];
  totalRevenueIdr: number;
  totalCogsIdr: number;
  grossProfitIdr: number;
  totalExpensesIdr: number;
  netIncomeIdr: number;
}

export function computeIncomeStatement(
  accounts: ChartAccount[],
  entries: JournalEntry[],
  startDate?: string,
  endDate?: string
): IncomeStatementSummary {
  const tb = computeTrialBalance(accounts, entries, startDate, endDate);
  const revenues: FinancialLineSummary[] = [];
  const cogs: FinancialLineSummary[] = [];
  const expenses: FinancialLineSummary[] = [];

  for (const r of tb.rows) {
    if (r.account.category === 'Pendapatan') {
      revenues.push({
        accountId: r.account.id,
        code: r.account.code,
        name: r.account.name,
        category: r.account.category,
        amountIdr: r.closingBalanceIdr,
      });
    } else if (r.account.category === 'Beban') {
      const target = r.account.code.startsWith('5') ? cogs : expenses;
      target.push({
        accountId: r.account.id,
        code: r.account.code,
        name: r.account.name,
        category: r.account.category,
        amountIdr: r.closingBalanceIdr,
      });
    }
  }

  const totalRevenueIdr = revenues.reduce((s, x) => s + x.amountIdr, 0);
  const totalCogsIdr = cogs.reduce((s, x) => s + x.amountIdr, 0);
  const grossProfitIdr = totalRevenueIdr - totalCogsIdr;
  const totalExpensesIdr = expenses.reduce((s, x) => s + x.amountIdr, 0);
  const netIncomeIdr = grossProfitIdr - totalExpensesIdr;

  return {
    revenues,
    cogs,
    expenses,
    totalRevenueIdr,
    totalCogsIdr,
    grossProfitIdr,
    totalExpensesIdr,
    netIncomeIdr,
  };
}

export interface BalanceSheetSummary {
  assets: FinancialLineSummary[];
  liabilities: FinancialLineSummary[];
  equities: FinancialLineSummary[];
  currentPeriodEarningsIdr: number;
  totalAssetsIdr: number;
  totalLiabilitiesIdr: number;
  totalEquityIdr: number;
  isBalanced: boolean;
}

export function computeBalanceSheet(
  accounts: ChartAccount[],
  entries: JournalEntry[],
  asOfDate?: string
): BalanceSheetSummary {
  const tb = computeTrialBalance(accounts, entries, undefined, asOfDate);
  const pnl = computeIncomeStatement(accounts, entries, undefined, asOfDate);

  const assets: FinancialLineSummary[] = [];
  const liabilities: FinancialLineSummary[] = [];
  const equities: FinancialLineSummary[] = [];

  for (const r of tb.rows) {
    const item: FinancialLineSummary = {
      accountId: r.account.id,
      code: r.account.code,
      name: r.account.name,
      category: r.account.category,
      amountIdr: r.closingBalanceIdr,
    };
    if (r.account.category === 'Aset') assets.push(item);
    else if (r.account.category === 'Kewajiban') liabilities.push(item);
    else if (r.account.category === 'Ekuitas') equities.push(item);
  }

  const totalAssetsIdr = assets.reduce((s, x) => s + x.amountIdr, 0);
  const totalLiabilitiesIdr = liabilities.reduce((s, x) => s + x.amountIdr, 0);
  const baseEquity = equities.reduce((s, x) => s + x.amountIdr, 0);
  const totalEquityIdr = baseEquity + pnl.netIncomeIdr;

  return {
    assets,
    liabilities,
    equities,
    currentPeriodEarningsIdr: pnl.netIncomeIdr,
    totalAssetsIdr,
    totalLiabilitiesIdr,
    totalEquityIdr,
    isBalanced: Math.round(totalAssetsIdr) === Math.round(totalLiabilitiesIdr + totalEquityIdr),
  };
}

export function findSeededDummyAccountingTargets(
  current: { journalEntries: Array<{ id: string }> },
  seed: { journalEntries: Array<{ id: string }> }
): string[] {
  const seedIds = new Set(seed.journalEntries.map((j) => j.id));
  return current.journalEntries.filter((j) => seedIds.has(j.id)).map((j) => j.id);
}

const MONTH_NAMES_ID = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

const MONTH_NAMES_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function formatMonthKeyLabel(monthKey: string, lang: 'id' | 'en' = 'id'): string {
  const [yr, mo] = monthKey.split('-');
  const mIdx = Number(mo) - 1;
  if (!yr || Number.isNaN(mIdx) || mIdx < 0 || mIdx > 11) return monthKey;
  const names = lang === 'en' ? MONTH_NAMES_EN : MONTH_NAMES_ID;
  return `${names[mIdx]} ${yr}`;
}

export interface MonthlyPerformanceRow {
  monthKey: string;
  monthLabel: string;
  revenueIdr: number;
  cogsIdr: number;
  grossProfitIdr: number;
  grossMarginPercent: number;
  operatingExpensesIdr: number;
  netIncomeIdr: number;
  netMarginPercent: number;
  poCount: number;
  poTotalIdr: number;
  soCount: number;
  soTotalIdr: number;
}

export interface MonthlyPerformanceSummary {
  months: MonthlyPerformanceRow[];
  totalRevenueIdr: number;
  totalCogsIdr: number;
  totalGrossProfitIdr: number;
  totalOperatingExpensesIdr: number;
  totalNetIncomeIdr: number;
  totalPoIdr: number;
  totalSoIdr: number;
}

export function computeMonthlyPerformance(
  accounts: ChartAccount[],
  entries: JournalEntry[],
  purchaseOrders: Array<{
    status: string;
    totalAmount: number;
    currency: CurrencyCode;
    exchangeRate?: number;
    createdAt: string;
  }>,
  salesOrders: Array<{
    totalAmount: number;
    currency: CurrencyCode;
    createdAt: string;
  }>,
  defaultExchangeRateUsdIdr: number
): MonthlyPerformanceSummary {
  const accMap = new Map(accounts.map((a) => [a.id, a]));
  const monthSet = new Set<string>();

  const postedEntries = entries.filter((e) => e.status === 'Posted');
  for (const e of postedEntries) {
    if (e.entryDate && e.entryDate.length >= 7) {
      monthSet.add(e.entryDate.slice(0, 7));
    }
  }
  for (const po of purchaseOrders) {
    if (po.status !== 'Cancelled' && po.createdAt && po.createdAt.length >= 7) {
      monthSet.add(po.createdAt.slice(0, 7));
    }
  }
  for (const so of salesOrders) {
    if (so.createdAt && so.createdAt.length >= 7) {
      monthSet.add(so.createdAt.slice(0, 7));
    }
  }

  const sortedMonths = Array.from(monthSet).sort();

  const months: MonthlyPerformanceRow[] = sortedMonths.map((monthKey) => {
    let revenueIdr = 0;
    let cogsIdr = 0;
    let operatingExpensesIdr = 0;

    for (const entry of postedEntries) {
      if ((entry.entryDate || '').slice(0, 7) !== monthKey) continue;
      for (const line of entry.lines) {
        const acc = accMap.get(line.accountId);
        if (!acc || !acc.active) continue;
        const debit = Math.round(Number(line.debitIdr) || 0);
        const credit = Math.round(Number(line.creditIdr) || 0);
        if (acc.category === 'Pendapatan') {
          revenueIdr += acc.normalBalance === 'Kredit' ? credit - debit : debit - credit;
        } else if (acc.category === 'Beban') {
          const delta = acc.normalBalance === 'Debit' ? debit - credit : credit - debit;
          if (acc.code.startsWith('5')) {
            cogsIdr += delta;
          } else {
            operatingExpensesIdr += delta;
          }
        }
      }
    }

    const grossProfitIdr = revenueIdr - cogsIdr;
    const netIncomeIdr = grossProfitIdr - operatingExpensesIdr;
    const grossMarginPercent =
      revenueIdr > 0 ? Math.round((grossProfitIdr / revenueIdr) * 1000) / 10 : 0;
    const netMarginPercent =
      revenueIdr > 0 ? Math.round((netIncomeIdr / revenueIdr) * 1000) / 10 : 0;

    const monthPos = purchaseOrders.filter(
      (p) => p.status !== 'Cancelled' && (p.createdAt || '').slice(0, 7) === monthKey
    );
    const poTotalIdr = monthPos.reduce(
      (s, p) => s + convertToIdr(p.totalAmount, p.currency, p.exchangeRate || defaultExchangeRateUsdIdr),
      0
    );

    const monthSos = salesOrders.filter((s) => (s.createdAt || '').slice(0, 7) === monthKey);
    const soTotalIdr = monthSos.reduce(
      (s, so) => s + convertToIdr(so.totalAmount, so.currency, defaultExchangeRateUsdIdr),
      0
    );

    return {
      monthKey,
      monthLabel: formatMonthKeyLabel(monthKey),
      revenueIdr,
      cogsIdr,
      grossProfitIdr,
      grossMarginPercent,
      operatingExpensesIdr,
      netIncomeIdr,
      netMarginPercent,
      poCount: monthPos.length,
      poTotalIdr,
      soCount: monthSos.length,
      soTotalIdr,
    };
  });

  return {
    months,
    totalRevenueIdr: months.reduce((s, m) => s + m.revenueIdr, 0),
    totalCogsIdr: months.reduce((s, m) => s + m.cogsIdr, 0),
    totalGrossProfitIdr: months.reduce((s, m) => s + m.grossProfitIdr, 0),
    totalOperatingExpensesIdr: months.reduce((s, m) => s + m.operatingExpensesIdr, 0),
    totalNetIncomeIdr: months.reduce((s, m) => s + m.netIncomeIdr, 0),
    totalPoIdr: months.reduce((s, m) => s + m.poTotalIdr, 0),
    totalSoIdr: months.reduce((s, m) => s + m.soTotalIdr, 0),
  };
}

export type ExecutivePeriodFilter = 'month' | 'quarter' | '6m' | 'all';

export function resolvePeriodDateRange(
  period: ExecutivePeriodFilter,
  referenceDate: Date = new Date()
): { startDate?: string; endDate?: string } {
  if (period === 'all') return {};
  const endStr = referenceDate.toISOString().slice(0, 10);
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  let start: Date;
  if (period === 'month') {
    start = new Date(year, month, 1);
  } else if (period === 'quarter') {
    start = new Date(year, month - 2, 1);
  } else {
    start = new Date(year, month - 5, 1);
  }
  const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`;
  return { startDate: startStr, endDate: endStr };
}

export interface ExecutiveRankItem {
  id: string;
  name: string;
  count: number;
  amountIdr: number;
  sharePercent: number;
}

export function buildExecutiveContributions(params: {
  purchaseOrders: PurchaseOrder[];
  salesOrders: SalesOrder[];
  products: Product[];
  usdToIdrRate: number;
  startDate?: string;
  endDate?: string;
}): {
  topCustomers: ExecutiveRankItem[];
  topSuppliers: ExecutiveRankItem[];
  stockByCategory: ExecutiveRankItem[];
} {
  const { purchaseOrders, salesOrders, products, usdToIdrRate, startDate, endDate } = params;

  const inRange = (isoDate: string) => {
    const d = (isoDate || '').slice(0, 10);
    if (!d) return true;
    if (startDate && d < startDate) return false;
    if (endDate && d > endDate) return false;
    return true;
  };

  const customerMap = new Map<string, { name: string; count: number; amountIdr: number }>();
  let totalSoIdr = 0;
  for (const so of salesOrders) {
    if (so.status === 'Draft' || !inRange(so.createdAt)) continue;
    const val = convertToIdr(so.totalAmount, so.currency, usdToIdrRate);
    totalSoIdr += val;
    const prev = customerMap.get(so.customerId) || {
      name: so.customerName || so.customerId,
      count: 0,
      amountIdr: 0,
    };
    prev.count += 1;
    prev.amountIdr += val;
    customerMap.set(so.customerId, prev);
  }

  const supplierMap = new Map<string, { name: string; count: number; amountIdr: number }>();
  let totalPoIdr = 0;
  for (const po of purchaseOrders) {
    if (po.status === 'Cancelled' || po.status === 'Draft' || !inRange(po.createdAt)) continue;
    const val = convertToIdr(po.totalAmount, po.currency, po.exchangeRate || usdToIdrRate);
    totalPoIdr += val;
    const prev = supplierMap.get(po.supplierId) || {
      name: po.supplierName || po.supplierId,
      count: 0,
      amountIdr: 0,
    };
    prev.count += 1;
    prev.amountIdr += val;
    supplierMap.set(po.supplierId, prev);
  }

  const catMap = new Map<string, { name: string; count: number; amountIdr: number }>();
  let totalStockVal = 0;
  for (const p of products) {
    if (p.isService) continue;
    const qty = getTotalProductStock(p);
    const val = qty * convertToIdr(p.buyPrice, p.currency, usdToIdrRate);
    totalStockVal += val;
    const key = p.categoryId || 'other';
    const prev = catMap.get(key) || {
      name: p.categoryName || p.categoryId || 'Lainnya',
      count: 0,
      amountIdr: 0,
    };
    prev.count += 1;
    prev.amountIdr += val;
    catMap.set(key, prev);
  }

  const toRanked = (
    map: Map<string, { name: string; count: number; amountIdr: number }>,
    total: number
  ): ExecutiveRankItem[] =>
    Array.from(map.entries())
      .map(([id, item]) => ({
        id,
        name: item.name,
        count: item.count,
        amountIdr: item.amountIdr,
        sharePercent: total > 0 ? Math.round((item.amountIdr / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.amountIdr - a.amountIdr)
      .slice(0, 5);

  return {
    topCustomers: toRanked(customerMap, totalSoIdr),
    topSuppliers: toRanked(supplierMap, totalPoIdr),
    stockByCategory: toRanked(catMap, totalStockVal),
  };
}

export const UNVERIFIED_PARTNER_MAX_TX_IDR = 10_000_000;

export function getPartnerVerificationStatus(partner?: {
  verificationStatus?: PartnerVerificationStatus;
}): PartnerVerificationStatus {
  if (!partner || !partner.verificationStatus) return 'Verified';
  return partner.verificationStatus;
}

export function resolveSupplierTermDays(
  scheme: SupplierPaymentScheme | undefined,
  requestedDays: number
): number {
  if (scheme === 'CBD' || scheme === 'COD') return 0;
  return Math.max(1, Math.min(365, Math.round(requestedDays || 30)));
}

export function resolveBuyerTermDays(scheme: BuyerPaymentScheme | undefined): number {
  if (scheme === 'TOP 14 Hari') return 14;
  if (scheme === 'TOP 30 Hari') return 30;
  return 0;
}

export function isBuyerTopScheme(customer: Pick<Customer, 'paymentScheme' | 'paymentTermDays'>): boolean {
  return (
    customer.paymentScheme === 'TOP 14 Hari' ||
    customer.paymentScheme === 'TOP 30 Hari' ||
    (Number(customer.paymentTermDays) || 0) > 0
  );
}

export function isSupplierTopScheme(supplier: Pick<Supplier, 'paymentScheme' | 'paymentTermDays'>): boolean {
  return (
    supplier.paymentScheme === 'TOP' ||
    (!supplier.paymentScheme && (Number(supplier.paymentTermDays) || 0) > 0)
  );
}

export function validateSupplierForPurchaseOrder(params: {
  supplier: Supplier;
  totalAmountIdr: number;
}): { allowed: boolean; reason?: string } {
  const { supplier, totalAmountIdr } = params;
  const status = getPartnerVerificationStatus(supplier);
  if (status === 'Blacklisted') {
    return {
      allowed: false,
      reason: `Supplier ${supplier.name} berstatus Blacklisted dan diblokir untuk transaksi Purchase Order.`,
    };
  }
  if (status === 'Pending') {
    if (isSupplierTopScheme(supplier)) {
      return {
        allowed: false,
        reason: `Supplier ${supplier.name} masih berstatus Pending. Transaksi tempo (TOP) membutuhkan persetujuan (Approve / Verified) dari Admin terlebih dahulu.`,
      };
    }
    if (totalAmountIdr > UNVERIFIED_PARTNER_MAX_TX_IDR) {
      return {
        allowed: false,
        reason: `Supplier ${supplier.name} masih berstatus Pending. Transaksi nilai besar (> Rp 10.000.000) memerlukan persetujuan (Approve / Verified) dari Admin terlebih dahulu.`,
      };
    }
  }
  return { allowed: true };
}

export function validateSupplierForPayment(params: {
  supplier?: Supplier;
  payAmountIdr: number;
}): { allowed: boolean; reason?: string } {
  const { supplier, payAmountIdr } = params;
  if (!supplier) return { allowed: true };
  const status = getPartnerVerificationStatus(supplier);
  if (status === 'Blacklisted') {
    return {
      allowed: false,
      reason: `Pembayaran ditolak: Supplier ${supplier.name} berstatus Blacklisted.`,
    };
  }
  if (status === 'Pending' && payAmountIdr > UNVERIFIED_PARTNER_MAX_TX_IDR) {
    return {
      allowed: false,
      reason: `Pembayaran besar (> Rp 10.000.000) ke Supplier ${supplier.name} ditahan sebelum Admin klik Approve (Verified).`,
    };
  }
  return { allowed: true };
}

export function computeOpenArForCustomerIdr(
  invoices: AccountingInvoice[],
  customerId: string,
  defaultUsdToIdrRate: number
): number {
  return invoices
    .filter((i) => i.ledgerType === 'AR' && i.counterpartyId === customerId && i.balanceDue > 0)
    .reduce(
      (sum, i) => sum + convertToIdr(i.balanceDue, i.currency, i.exchangeRate || defaultUsdToIdrRate),
      0
    );
}

export function validateBuyerForSalesOrder(params: {
  customer: Customer;
  newOrderAmountIdr: number;
  openArIdr: number;
}): { allowed: boolean; reason?: string } {
  const { customer, newOrderAmountIdr, openArIdr } = params;
  const status = getPartnerVerificationStatus(customer);
  if (status === 'Blacklisted') {
    return {
      allowed: false,
      reason: `Buyer ${customer.name} berstatus Blacklisted dan diblokir untuk transaksi Sales Order.`,
    };
  }

  const isTop = isBuyerTopScheme(customer);
  if (isTop) {
    if (status === 'Pending') {
      return {
        allowed: false,
        reason: `Buyer ${customer.name} mengajukan skema tempo (TOP) dan masih berstatus Pending. Wajib Approve & isi Credit Limit oleh Admin sebelum transaksi tempo.`,
      };
    }
    const limit = Number(customer.creditLimit) || 0;
    if (limit <= 0) {
      return {
        allowed: false,
        reason: `Buyer ${customer.name} belum memiliki Credit Limit aktif dari Admin untuk transaksi tempo (TOP).`,
      };
    }
    if (openArIdr + newOrderAmountIdr > limit) {
      return {
        allowed: false,
        reason: `Total piutang + order (${formatCurrency(openArIdr + newOrderAmountIdr, 'IDR')}) melebihi Credit Limit Admin (${formatCurrency(limit, 'IDR')}) untuk ${customer.name}.`,
      };
    }
  } else if (status === 'Pending' && newOrderAmountIdr > UNVERIFIED_PARTNER_MAX_TX_IDR) {
    return {
      allowed: false,
      reason: `Buyer ${customer.name} masih berstatus Pending. Transaksi nilai besar (> Rp 10.000.000) memerlukan persetujuan (Approve) dari Admin terlebih dahulu.`,
    };
  }

  return { allowed: true };
}

export function isSafeDocumentUrl(url?: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://') || trimmed.startsWith('blob:')) {
    return true;
  }
  return (
    trimmed.startsWith('data:application/pdf;base64,') ||
    trimmed.startsWith('data:image/jpeg;base64,') ||
    trimmed.startsWith('data:image/png;base64,') ||
    trimmed.startsWith('data:image/webp;base64,')
  );
}

// =========================================================================
// Enterprise Level-Up Pure Logic Helpers
// =========================================================================

export function resolveEffectiveUnitPrice(
  customer: Customer | undefined,
  product: Product,
  qty: number,
  targetCurrency: CurrencyCode,
  usdToIdrRate: number,
  referenceDateIso: string = new Date().toISOString().slice(0, 10)
): { unitPrice: number; isContractPrice: boolean } {
  const rate = usdToIdrRate > 0 ? usdToIdrRate : 16200;
  const convertBetween = (amount: number, fromCurr: CurrencyCode, toCurr: CurrencyCode): number => {
    if (fromCurr === toCurr) return amount;
    if (fromCurr === 'USD' && toCurr === 'IDR') return Math.round(amount * rate);
    if (fromCurr === 'IDR' && toCurr === 'USD') return Math.round((amount / rate) * 100) / 100;
    return amount;
  };

  const tiers = (customer?.contractPrices || []).filter((t) => {
    if (t.productId !== product.id) return false;
    if (t.minQty && qty < t.minQty) return false;
    if (t.validUntil && t.validUntil.slice(0, 10) < referenceDateIso.slice(0, 10)) return false;
    return true;
  });

  if (tiers.length > 0) {
    const bestTier = [...tiers].sort((a, b) => (b.minQty || 0) - (a.minQty || 0))[0];
    const tierCurrency = bestTier.currency || product.currency;
    return {
      unitPrice: convertBetween(bestTier.unitPrice, tierCurrency, targetCurrency),
      isContractPrice: true,
    };
  }

  return {
    unitPrice: convertBetween(product.sellPrice, product.currency, targetCurrency),
    isContractPrice: false,
  };
}

export const DEFAULT_MANAGER_APPROVAL_LIMIT_IDR = 25_000_000;

export function requiresDirectorApproval(
  totalIdr: number,
  managerLimitIdr: number = DEFAULT_MANAGER_APPROVAL_LIMIT_IDR
): boolean {
  const limit = Number.isFinite(managerLimitIdr) && managerLimitIdr > 0
    ? managerLimitIdr
    : DEFAULT_MANAGER_APPROVAL_LIMIT_IDR;
  return totalIdr > limit;
}

export type ThreeWayMatchStatus = 'MATCHED' | 'PARTIAL_GR' | 'VARIANCE' | 'NO_INVOICE';

export interface ThreeWayMatchResult {
  status: ThreeWayMatchStatus;
  orderedQty: number;
  receivedQty: number;
  orderedValueIdr: number;
  receivedValueIdr: number;
  invoicedValueIdr: number;
  varianceIdr: number;
  reason: string;
}

export function computeThreeWayMatchStatus(
  po: PurchaseOrder,
  invoices: AccountingInvoice[],
  defaultUsdToIdrRate: number
): ThreeWayMatchResult {
  const rate = po.exchangeRate > 0 ? po.exchangeRate : defaultUsdToIdrRate || 16200;
  const orderedQty = po.items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const receivedQty = po.items.reduce((s, it) => s + (Number(it.fulfilledQty) || 0), 0);
  const orderedValueIdr = convertToIdr(po.totalAmount, po.currency, rate);

  const taxPct =
    po.subtotal && po.subtotal > 0 && po.taxAmount !== undefined
      ? po.taxAmount / po.subtotal
      : 0.11;
  const receivedSubtotal = po.items.reduce(
    (s, it) => s + (Number(it.fulfilledQty) || 0) * (Number(it.unitPrice) || 0),
    0
  );
  const receivedTotalOrigin = receivedSubtotal * (1 + taxPct);
  const receivedValueIdr = convertToIdr(receivedTotalOrigin, po.currency, rate);

  const linkedInvoices = invoices.filter(
    (inv) =>
      inv.ledgerType === 'AP' &&
      (inv.referenceOrderId === po.id || inv.referenceOrderNumber === po.poNumber)
  );

  if (linkedInvoices.length === 0) {
    return {
      status: 'NO_INVOICE',
      orderedQty,
      receivedQty,
      orderedValueIdr,
      receivedValueIdr,
      invoicedValueIdr: 0,
      varianceIdr: receivedValueIdr,
      reason:
        receivedQty === 0
          ? 'Belum ada Goods Receipt maupun Tagihan AP vendor.'
          : 'Barang sudah diterima sebagian/penuh, tetapi invoice AP vendor belum tercatat.',
    };
  }

  const invoicedValueIdr = linkedInvoices.reduce(
    (s, inv) => s + convertToIdr(inv.totalAmount, inv.currency, inv.exchangeRate || rate),
    0
  );
  const varianceIdr = invoicedValueIdr - receivedValueIdr;
  const toleranceIdr = 1000;

  if (Math.abs(varianceIdr) > toleranceIdr) {
    return {
      status: 'VARIANCE',
      orderedQty,
      receivedQty,
      orderedValueIdr,
      receivedValueIdr,
      invoicedValueIdr,
      varianceIdr,
      reason: `Selisih nilai Tagihan AP vs Nilai Goods Receipt sebesar ${formatCurrency(
        Math.abs(varianceIdr),
        'IDR'
      )}.`,
    };
  }

  if (receivedQty < orderedQty) {
    return {
      status: 'PARTIAL_GR',
      orderedQty,
      receivedQty,
      orderedValueIdr,
      receivedValueIdr,
      invoicedValueIdr,
      varianceIdr: 0,
      reason: `Tagihan AP cocok dengan penerimaan parsial (${receivedQty}/${orderedQty} unit diterima).`,
    };
  }

  return {
    status: 'MATCHED',
    orderedQty,
    receivedQty,
    orderedValueIdr,
    receivedValueIdr,
    invoicedValueIdr,
    varianceIdr: 0,
    reason: '3-Way Match Valid: Qty & Nilai PO = Goods Receipt = Tagihan AP.',
  };
}

export interface VatLineDetail {
  id: string;
  docNumber: string;
  taxInvoiceNumber?: string;
  date: string;
  counterpartyName: string;
  type: 'PPN_KELUARAN' | 'PPN_MASUKAN' | 'RETUR_PENJUALAN' | 'RETUR_PEMBELIAN';
  dppIdr: number;
  vatIdr: number;
}

export interface VatReconciliationSummary {
  periodMonthKey: string;
  ppnKeluaranGrossIdr: number;
  ppnMasukanGrossIdr: number;
  salesReturnVatIdr: number;
  purchaseReturnVatIdr: number;
  netPpnKeluaranIdr: number;
  netPpnMasukanIdr: number;
  netVatPayableIdr: number;
  statusLabel: 'Kurang Bayar' | 'Lebih Bayar' | 'Nihil';
  details: VatLineDetail[];
}

export function computeVatReconciliation(
  invoices: AccountingInvoice[],
  goodsReturns: GoodsReturn[],
  defaultUsdToIdrRate: number,
  periodMonthKey: string = 'ALL',
  options?: {
    isPkp?: boolean;
    taxRatePercent?: number;
    orders?: Array<{ id: string; number?: string; subtotal?: number; taxAmount?: number }>;
  }
): VatReconciliationSummary {
  const rateFallback = defaultUsdToIdrRate > 0 ? defaultUsdToIdrRate : 16200;
  const isPkp = options?.isPkp ?? true;
  const matchesPeriod = (iso?: string): boolean => {
    if (!periodMonthKey || periodMonthKey === 'ALL') return true;
    return (iso || '').slice(0, 7) === periodMonthKey;
  };

  let ppnKeluaranGrossIdr = 0;
  let ppnMasukanGrossIdr = 0;
  let salesReturnVatIdr = 0;
  let purchaseReturnVatIdr = 0;
  const details: VatLineDetail[] = [];

  invoices.forEach((inv) => {
    const docDate = (inv.issueDate || inv.createdAt || '').slice(0, 10);
    if (!matchesPeriod(docDate)) return;
    const totalIdr = convertToIdr(inv.totalAmount, inv.currency, inv.exchangeRate || rateFallback);
    
    let vatIdr = 0;
    let dppIdr = totalIdr;
    if (isPkp) {
      const linkedOrder = options?.orders?.find(
        (o) => o.id === inv.referenceOrderId || o.number === inv.referenceOrderNumber
      );
      if (linkedOrder?.subtotal !== undefined && linkedOrder?.taxAmount !== undefined) {
        const ordSubIdr = convertToIdr(linkedOrder.subtotal, inv.currency, inv.exchangeRate || rateFallback);
        const ordTaxIdr = convertToIdr(linkedOrder.taxAmount, inv.currency, inv.exchangeRate || rateFallback);
        dppIdr = ordSubIdr;
        vatIdr = ordTaxIdr;
      } else {
        const rate = options?.taxRatePercent ?? 11;
        const factor = 1 + rate / 100;
        dppIdr = Math.round(totalIdr / factor);
        vatIdr = totalIdr - dppIdr;
      }
    }

    if (inv.ledgerType === 'AR') {
      ppnKeluaranGrossIdr += vatIdr;
      details.push({
        id: inv.id,
        docNumber: inv.invoiceNumber,
        taxInvoiceNumber: inv.taxInvoiceNumber,
        date: docDate,
        counterpartyName: inv.counterpartyName || '-',
        type: 'PPN_KELUARAN',
        dppIdr,
        vatIdr,
      });
    } else {
      ppnMasukanGrossIdr += vatIdr;
      details.push({
        id: inv.id,
        docNumber: inv.invoiceNumber,
        taxInvoiceNumber: inv.taxInvoiceNumber,
        date: docDate,
        counterpartyName: inv.counterpartyName || '-',
        type: 'PPN_MASUKAN',
        dppIdr,
        vatIdr,
      });
    }
  });

  goodsReturns
    .filter((r) => r.status === 'Completed' && matchesPeriod(r.returnDate))
    .forEach((ret) => {
      const dppIdr = convertToIdr(ret.subtotal, ret.currency, rateFallback);
      const vatIdr = convertToIdr(ret.taxAmount, ret.currency, rateFallback);
      if (ret.returnType === 'SALES_RETURN') {
        salesReturnVatIdr += vatIdr;
        details.push({
          id: ret.id,
          docNumber: ret.returnNumber,
          date: ret.returnDate,
          counterpartyName: ret.counterpartyName,
          type: 'RETUR_PENJUALAN',
          dppIdr: -dppIdr,
          vatIdr: -vatIdr,
        });
      } else {
        purchaseReturnVatIdr += vatIdr;
        details.push({
          id: ret.id,
          docNumber: ret.returnNumber,
          date: ret.returnDate,
          counterpartyName: ret.counterpartyName,
          type: 'RETUR_PEMBELIAN',
          dppIdr: -dppIdr,
          vatIdr: -vatIdr,
        });
      }
    });

  const netPpnKeluaranIdr = Math.max(0, ppnKeluaranGrossIdr - salesReturnVatIdr);
  const netPpnMasukanIdr = Math.max(0, ppnMasukanGrossIdr - purchaseReturnVatIdr);
  const netVatPayableIdr = netPpnKeluaranIdr - netPpnMasukanIdr;

  const statusLabel: VatReconciliationSummary['statusLabel'] =
    netVatPayableIdr > 0 ? 'Kurang Bayar' : netVatPayableIdr < 0 ? 'Lebih Bayar' : 'Nihil';

  details.sort((a, b) => b.date.localeCompare(a.date));

  return {
    periodMonthKey,
    ppnKeluaranGrossIdr,
    ppnMasukanGrossIdr,
    salesReturnVatIdr,
    purchaseReturnVatIdr,
    netPpnKeluaranIdr,
    netPpnMasukanIdr,
    netVatPayableIdr,
    statusLabel,
    details,
  };
}

export function isDateInClosedPeriod(
  isoDate: string,
  periodClosings: AccountingPeriodLock[]
): { locked: boolean; periodKey: string; lockRecord?: AccountingPeriodLock } {
  const periodKey = (isoDate || '').slice(0, 7);
  if (!periodKey || periodKey.length !== 7) {
    return { locked: false, periodKey: '' };
  }
  const found = periodClosings.find((p) => p.periodKey === periodKey && p.locked);
  return {
    locked: Boolean(found),
    periodKey,
    lockRecord: found,
  };
}

export interface BudgetVsActualRow {
  periodKey: string;
  monthLabel: string;
  targetRevenueIdr: number;
  actualRevenueIdr: number;
  revenueAttainmentPercent: number;
  maxCogsIdr: number;
  actualCogsIdr: number;
  cogsVarianceIdr: number;
  maxOpexIdr: number;
  actualOpexIdr: number;
  opexVarianceIdr: number;
  targetNetIncomeIdr: number;
  actualNetIncomeIdr: number;
  netIncomeVarianceIdr: number;
  notes?: string;
}

export function computeBudgetVsActual(
  budgets: MonthlyBudget[],
  monthlySummary: MonthlyPerformanceSummary,
  lang: 'id' | 'en' = 'id'
): BudgetVsActualRow[] {
  const actualMap = new Map(monthlySummary.months.map((m) => [m.monthKey, m]));
  return [...budgets]
    .sort((a, b) => a.periodKey.localeCompare(b.periodKey))
    .map((b) => {
      const actual = actualMap.get(b.periodKey);
      const actualRevenueIdr = actual?.revenueIdr ?? 0;
      const actualCogsIdr = actual?.cogsIdr ?? 0;
      const actualOpexIdr = actual?.operatingExpensesIdr ?? 0;
      const actualNetIncomeIdr = actual?.netIncomeIdr ?? 0;
      const targetNetIncomeIdr = b.targetRevenueIdr - b.maxCogsIdr - b.maxOpexIdr;
      const revenueAttainmentPercent =
        b.targetRevenueIdr > 0 ? (actualRevenueIdr / b.targetRevenueIdr) * 100 : 0;

      return {
        periodKey: b.periodKey,
        monthLabel: formatMonthKeyLabel(b.periodKey, lang),
        targetRevenueIdr: b.targetRevenueIdr,
        actualRevenueIdr,
        revenueAttainmentPercent,
        maxCogsIdr: b.maxCogsIdr,
        actualCogsIdr,
        cogsVarianceIdr: b.maxCogsIdr - actualCogsIdr,
        maxOpexIdr: b.maxOpexIdr,
        actualOpexIdr,
        opexVarianceIdr: b.maxOpexIdr - actualOpexIdr,
        targetNetIncomeIdr,
        actualNetIncomeIdr,
        netIncomeVarianceIdr: actualNetIncomeIdr - targetNetIncomeIdr,
        notes: b.notes,
      };
    });
}

export interface BatchAlertsSummary {
  expired: InventoryBatch[];
  expiringSoon: InventoryBatch[];
  warrantyExpiringSoon: InventoryBatch[];
}

export function computeBatchAlerts(
  batches: InventoryBatch[],
  referenceDate: Date = new Date(),
  windowDays: number = 60
): BatchAlertsSummary {
  const refDay = referenceDate.toISOString().slice(0, 10);
  const windowLimit = new Date(referenceDate.getTime() + windowDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const activeBatches = batches.filter((b) => b.qty > 0 && b.status !== 'Depleted');
  const expired: InventoryBatch[] = [];
  const expiringSoon: InventoryBatch[] = [];
  const warrantyExpiringSoon: InventoryBatch[] = [];

  activeBatches.forEach((b) => {
    if (b.status === 'Expired' || (b.expiryDate && b.expiryDate <= refDay)) {
      expired.push(b);
    } else if (b.expiryDate && b.expiryDate > refDay && b.expiryDate <= windowLimit) {
      expiringSoon.push(b);
    }

    if (b.warrantyUntil && b.warrantyUntil >= refDay && b.warrantyUntil <= windowLimit) {
      warrantyExpiringSoon.push(b);
    }
  });

  return { expired, expiringSoon, warrantyExpiringSoon };
}

export interface SmartReminderDraft {
  id: string;
  category: 'AR_OVERDUE' | 'PO_APPROVAL' | 'LOW_STOCK' | 'BATCH_EXPIRY';
  severity: 'critical' | 'warning' | 'info';
  recipientName: string;
  phone?: string;
  email?: string;
  subject: string;
  message: string;
  whatsappUrl?: string;
  mailtoUrl?: string;
  targetModule: AppModule;
}

function sanitizePhoneForWhatsApp(phone?: string): string | undefined {
  if (!phone) return undefined;
  let digits = phone.replace(/[^\d]/g, '');
  if (!digits) return undefined;
  if (digits.startsWith('0')) {
    digits = `62${digits.slice(1)}`;
  }
  return digits.length >= 8 ? digits : undefined;
}

export function buildReminderDrafts(params: {
  invoices: AccountingInvoice[];
  purchaseOrders: PurchaseOrder[];
  products: Product[];
  batches: InventoryBatch[];
  customers: Customer[];
  suppliers?: Supplier[];
  lang?: 'id' | 'en';
  companyName?: string;
  referenceDate?: Date;
}): SmartReminderDraft[] {
  const {
    invoices,
    purchaseOrders,
    products,
    batches,
    customers,
    suppliers = [],
    lang = 'id',
    companyName = 'PT Domestiq Hub Indonesia',
    referenceDate = new Date(),
  } = params;
  const drafts: SmartReminderDraft[] = [];
  const refTime = referenceDate.getTime();
  const threeDaysAheadMs = refTime + 3 * 86_400_000;

  invoices
    .filter((i) => i.ledgerType === 'AR' && i.balanceDue > 0)
    .forEach((inv) => {
      const dueMs = new Date(inv.dueDate).getTime();
      if (!Number.isFinite(dueMs) || dueMs > threeDaysAheadMs) return;
      const isOverdue = dueMs < refTime;
      const cus = customers.find((c) => c.id === inv.counterpartyId);
      const phone = cus?.picFinancePhone || cus?.phone;
      const email = cus?.email;
      const recipientName = cus?.picFinanceName || cus?.name || inv.counterpartyName || 'Finance PIC';
      const dueFormatted = formatCurrency(inv.balanceDue, inv.currency);
      const subject =
        lang === 'en'
          ? `[Payment Reminder] Invoice ${inv.invoiceNumber} — ${companyName}`
          : `[Pengingat Tagihan] Invoice ${inv.invoiceNumber} — ${companyName}`;
      const message =
        lang === 'en'
          ? `Dear ${recipientName} (${inv.counterpartyName || ''}),\nThis is a polite reminder regarding Invoice ${inv.invoiceNumber} (Ref ${inv.referenceOrderNumber || '-'}) with outstanding balance ${dueFormatted}, due date ${inv.dueDate}. Please let us know once transfer is scheduled.\nThank you, Finance Team - ${companyName}.`
          : `Yth. Bapak/Ibu ${recipientName} (${inv.counterpartyName || ''}),\nKami mengingatkan tagihan ${inv.invoiceNumber} (Ref ${inv.referenceOrderNumber || '-'}) dengan sisa saldo ${dueFormatted} (jatuh tempo ${inv.dueDate}). Mohon konfirmasi apabila pembayaran telah dijadwalkan.\nTerima kasih, Tim Finance - ${companyName}.`;

      const waNum = sanitizePhoneForWhatsApp(phone);
      drafts.push({
        id: `rem_ar_${inv.id}`,
        category: 'AR_OVERDUE',
        severity: isOverdue ? 'critical' : 'warning',
        recipientName,
        phone,
        email,
        subject,
        message,
        whatsappUrl: waNum ? `https://wa.me/${waNum}?text=${encodeURIComponent(message)}` : undefined,
        mailtoUrl: email
          ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`
          : undefined,
        targetModule: 'accounting',
      });
    });

  purchaseOrders
    .filter((po) => po.status === 'Submitted')
    .forEach((po) => {
      const totalFormatted = formatCurrency(po.totalAmount, po.currency);
      const tierLabel = po.approvalTierRequired === 'Direktur' ? 'Direktur' : 'Manager / Direktur';
      const subject =
        lang === 'en'
          ? `PO Approval Needed: ${po.poNumber} (${totalFormatted})`
          : `Persetujuan PO Dibutuhkan: ${po.poNumber} (${totalFormatted})`;
      const message =
        lang === 'en'
          ? `Approval Request (${tierLabel}): ${po.poNumber} for supplier ${po.supplierName || '-'} worth ${totalFormatted} is waiting for review in ${companyName} ERP.`
          : `Permintaan Approval (${tierLabel}): ${po.poNumber} untuk supplier ${po.supplierName || '-'} senilai ${totalFormatted} menunggu persetujuan Anda di sistem ERP ${companyName}.`;

      drafts.push({
        id: `rem_po_${po.id}`,
        category: 'PO_APPROVAL',
        severity: po.approvalTierRequired === 'Direktur' ? 'critical' : 'warning',
        recipientName: tierLabel,
        subject,
        message,
        targetModule: 'purchasing',
      });
    });

  products.filter(isLowStockProduct).forEach((prd) => {
    const total = getTotalProductStock(prd);
    const subject =
      lang === 'en'
        ? `Low Stock Reorder Alert: ${prd.sku} (${prd.name})`
        : `Peringatan Stok Minimum: ${prd.sku} (${prd.name})`;
    const message =
      lang === 'en'
        ? `Stock alert: ${prd.name} (${prd.sku}) has ${total} ${prd.uomCode} remaining across warehouses (min threshold: ${prd.minStock} ${prd.uomCode}). Please initiate PO / RFQ.`
        : `Peringatan Stok Minimum: ${prd.name} (${prd.sku}) tersisa ${total} ${prd.uomCode} (batas min: ${prd.minStock} ${prd.uomCode}). Mohon segera buat RFQ / PO restock.`;
    const defaultSup = suppliers[0];
    drafts.push({
      id: `rem_stk_${prd.id}`,
      category: 'LOW_STOCK',
      severity: 'critical',
      recipientName: 'Tim Purchasing & Gudang',
      email: defaultSup?.email,
      subject,
      message,
      targetModule: 'inventory',
    });
  });

  const batchAlerts = computeBatchAlerts(batches, referenceDate, 60);
  [...batchAlerts.expired, ...batchAlerts.expiringSoon].forEach((b) => {
    const isExpired = batchAlerts.expired.some((x) => x.id === b.id);
    const subject =
      lang === 'en'
        ? `${isExpired ? 'EXPIRED' : 'Expiring Soon'} Batch ${b.batchNumber} (${b.productSku || b.productId})`
        : `${isExpired ? 'KEDALUWARSA' : 'Mendekati Expired'} Batch ${b.batchNumber} (${b.productSku || b.productId})`;
    const message =
      lang === 'en'
        ? `Batch ${b.batchNumber} of ${b.productName || b.productId} (${b.qty} unit at ${b.warehouseName || b.warehouseId}) ${isExpired ? 'is EXPIRED' : 'expires on'} ${b.expiryDate || '-'}. Please quarantine or prioritize FEFO issue.`
        : `Batch ${b.batchNumber} untuk ${b.productName || b.productId} (${b.qty} unit di ${b.warehouseName || b.warehouseId}) ${isExpired ? 'telah KEDALUWARSA pada' : 'akan expired pada'} ${b.expiryDate || '-'}. Segera lakukan karantina atau FEFO.`;

    drafts.push({
      id: `rem_bat_${b.id}`,
      category: 'BATCH_EXPIRY',
      severity: isExpired ? 'critical' : 'warning',
      recipientName: `Gudang ${b.warehouseName || b.warehouseId}`,
      subject,
      message,
      targetModule: 'inventory',
    });
  });

  return drafts;
}

export function sanitizeAuthProfileFields(input: {
  email: string;
  displayName?: string | null;
  photoURL?: string | null;
}): {
  emailLower: string;
  displayName: string;
  photoURL: string;
} {
  const emailLower = (input.email || '').trim().toLowerCase();
  const fallbackName = emailLower.includes('@')
    ? emailLower.split('@')[0]
    : 'User Domestiq';
  const rawName = sanitizeString(input.displayName || '', 120);
  const displayName = rawName.length >= 1 ? rawName : fallbackName.slice(0, 120) || 'User Domestiq';
  const rawPhoto = (input.photoURL || '').trim();
  const photoURL = rawPhoto.length <= 512 ? rawPhoto : '';
  return { emailLower, displayName, photoURL };
}

export function formatSupabaseAuthErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  if (!raw) return 'Gagal memverifikasi sesi login.';
  const lower = raw.toLowerCase();
  if (lower.includes('invalid login credentials')) {
    return 'Email atau kata sandi salah. Periksa kembali kredensial Anda.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Email Anda belum dikonfirmasi. Silakan cek kotak masuk email atau hubungi Direktur.';
  }
  if (lower.includes('user already registered') || lower.includes('already been registered')) {
    return 'Email ini sudah terdaftar. Silakan masuk menggunakan tab Login.';
  }
  if (lower.includes('password should be at least')) {
    return 'Kata sandi minimal 6 karakter.';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'Terlalu banyak percobaan otentikasi. Tunggu beberapa saat lalu coba lagi.';
  }
  if (lower.includes('row-level security') || lower.includes('permission denied')) {
    return 'Akses data ditolak oleh Row Level Security (RLS) Supabase. Pastikan profil & role Anda aktif.';
  }
  if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('fetcherror')) {
    return 'Koneksi ke server Supabase terputus. Periksa koneksi internet Anda lalu coba lagi.';
  }
  return raw;
}

export const DEFAULT_SUPPLIER_CATEGORIES = ['IT', 'Safety/MRO', 'Packaging', 'ATK'] as const;

export function isCompanyPkp(settings?: Pick<CompanySettings, 'isPkp'>): boolean {
  return settings?.isPkp === true;
}

export function getEffectiveTaxRatePercent(
  settings?: Pick<CompanySettings, 'isPkp' | 'taxRatePercent'>
): number {
  if (!isCompanyPkp(settings)) return 0;
  const raw = Number(settings?.taxRatePercent ?? 11);
  return Number.isFinite(raw) && raw >= 0 ? Math.min(100, raw) : 11;
}

export function normalizeSupplierCategories(
  categories?: string[],
  extra?: string[]
): string[] {
  const merged = [
    ...(categories && categories.length > 0 ? categories : DEFAULT_SUPPLIER_CATEGORIES),
    ...(extra || []),
  ];
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const item of merged) {
    const trimmed = (item || '').trim();
    if (trimmed && !seen.has(trimmed.toLowerCase())) {
      seen.add(trimmed.toLowerCase());
      cleaned.push(trimmed);
    }
  }
  return cleaned.length > 0 ? cleaned : [...DEFAULT_SUPPLIER_CATEGORIES];
}

export function isServiceOrderItem(
  item: { isService?: boolean; productId?: string },
  products: Product[]
): boolean {
  if (item.isService) return true;
  if (!item.productId) return false;
  return Boolean(products.find((p) => p.id === item.productId)?.isService);
}

export function splitOrderSubtotalByService(
  items: Array<{ productId?: string; isService?: boolean; lineTotal?: number; qty?: number; unitPrice?: number }>,
  products: Product[]
): { stockSubtotal: number; serviceSubtotal: number } {
  let stockSubtotal = 0;
  let serviceSubtotal = 0;
  for (const item of items) {
    const lineVal =
      typeof item.lineTotal === 'number'
        ? item.lineTotal
        : Math.round(Math.max(0, Number(item.qty) || 0) * Math.max(0, Number(item.unitPrice) || 0) * 100) / 100;
    if (isServiceOrderItem(item, products)) {
      serviceSubtotal += lineVal;
    } else {
      stockSubtotal += lineVal;
    }
  }
  return {
    stockSubtotal: Math.round(stockSubtotal * 100) / 100,
    serviceSubtotal: Math.round(serviceSubtotal * 100) / 100,
  };
}








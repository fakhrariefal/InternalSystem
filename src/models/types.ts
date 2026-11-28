export type UserRole =
  | 'Direktur'
  | 'Manager'
  | 'Purchasing'
  | 'Warehouse'
  | 'Sales'
  | 'Finance'
  | 'Viewer'
  | 'Angel Investor';

export type CurrencyCode = 'IDR' | 'USD';

export type PoStatus =
  | 'Draft'
  | 'Submitted'
  | 'Approved by Manager'
  | 'Ordered'
  | 'Partially Received'
  | 'Fully Received'
  | 'Closed'
  | 'Cancelled';

export type SoStatus =
  | 'Draft'
  | 'Confirmed'
  | 'Partially Delivered'
  | 'Fully Delivered'
  | 'Invoiced'
  | 'Closed';

export type StockMovementType =
  | 'GOODS_RECEIPT'
  | 'GOODS_ISSUE'
  | 'TRANSFER'
  | 'STOCK_OPNAME';

export type LedgerType = 'AP' | 'AR';
export type InvoiceStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE';

export type AccountCategory = 'Aset' | 'Kewajiban' | 'Ekuitas' | 'Pendapatan' | 'Beban';
export type NormalBalance = 'Debit' | 'Kredit';
export type JournalEntryType =
  | 'Jurnal Umum'
  | 'Pembelian (AP)'
  | 'Penjualan (AR)'
  | 'Kas & Bank'
  | 'Penyesuaian';
export type JournalStatus = 'Posted' | 'Void';

export type AppModule =
  | 'dashboard'
  | 'master'
  | 'purchasing'
  | 'inventory'
  | 'sales'
  | 'accounting'
  | 'reports'
  | 'system';

export const BLUEPRINT_CONSTRAINTS = {
  ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  ID_MAX_LENGTH: 128,
  NAME_MAX_LENGTH: 160,
  PRODUCT_NAME_MAX_LENGTH: 180,
  SKU_MAX_LENGTH: 40,
  NOTES_MAX_LENGTH: 600,
  ADDRESS_MAX_LENGTH: 400,
  MAX_ORDER_ITEMS: 50,
  MAX_ATTACHMENTS: 5,
} as const;

export interface UserProfile {
  uid: string;
  authUserId?: string;
  companyId?: string;
  email: string;
  displayName: string;
  role: UserRole;
  department?: string;
  active: boolean;
  photoURL?: string;
  claimedFromUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export type SupplierCategory = string;
export type TaxPkpStatus = 'PKP' | 'Non-PKP';
export type SupplierPaymentScheme = 'CBD' | 'COD' | 'TOP';
export type BuyerPaymentScheme = 'CBD' | 'TOP 14 Hari' | 'TOP 30 Hari';
export type PaymentTermOption =
  | 'CBD'
  | 'COD'
  | 'TOP 14 Hari Kalender'
  | 'TOP 30 Hari Kalender'
  | 'TOP 45 Hari Kalender'
  | 'Custom';
export type IncotermOption =
  | 'DDP - Franco Lokasi Pembeli'
  | 'EXW - Loco Gudang Penjual'
  | 'DAP'
  | 'CIP';
export type PartnerVerificationStatus = 'Pending' | 'Verified' | 'Blacklisted';

export interface Supplier {
  id: string;
  code: string;
  name: string;
  vendorCategory?: SupplierCategory;
  nib?: string;
  npwp?: string;
  taxStatus?: TaxPkpStatus;
  address?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  bankName?: string;
  bankAccount?: string;
  paymentScheme?: SupplierPaymentScheme;
  paymentTermDays: number;
  defaultCurrency: CurrencyCode;
  nibDocUrl?: string;
  nibFileName?: string;
  npwpDocUrl?: string;
  npwpFileName?: string;
  ktpDirectorDocUrl?: string;
  ktpDirectorFileName?: string;
  verificationStatus?: PartnerVerificationStatus;
  verifiedBy?: string;
  verifiedAt?: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerPriceTier {
  productId: string;
  unitPrice: number;
  currency?: CurrencyCode;
  minQty?: number;
  validUntil?: string;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  nib?: string;
  npwp?: string;
  taxStatus?: TaxPkpStatus;
  address?: string;
  billingAddress?: string;
  shippingAddress?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  picPurchasingName?: string;
  picPurchasingPhone?: string;
  picWarehouseName?: string;
  picWarehousePhone?: string;
  picFinanceName?: string;
  picFinancePhone?: string;
  paymentScheme?: BuyerPaymentScheme;
  creditLimit: number;
  paymentTermDays: number;
  contractPrices?: CustomerPriceTier[];
  nibDocUrl?: string;
  nibFileName?: string;
  npwpDocUrl?: string;
  npwpFileName?: string;
  verificationStatus?: PartnerVerificationStatus;
  verifiedBy?: string;
  verifiedAt?: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  address?: string;
  picName?: string;
  phone?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  code: string;
  name: string;
  description?: string;
  createdAt: string;
}

export interface Uom {
  id: string;
  code: string;
  name: string;
  createdAt: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  categoryName?: string;
  uomCode: string;
  description?: string;
  imageUrl?: string;
  buyPrice: number;
  sellPrice: number;
  currency: CurrencyCode;
  minStock: number;
  maxStock: number;
  trackSerialOrExpiry?: boolean;
  isService?: boolean;
  warehouseStocks: Record<string, number>;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  productId: string;
  sku: string;
  productName: string;
  uomCode: string;
  qty: number;
  fulfilledQty: number;
  unitPrice: number;
  lineTotal: number;
  isService?: boolean;
}

export interface OrderLog {
  id: string;
  action: string;
  actorId: string;
  actorName: string;
  note?: string;
  timestamp: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName?: string;
  warehouseId: string;
  warehouseName?: string;
  currency: CurrencyCode;
  exchangeRate: number;
  status: PoStatus;
  items: OrderItem[];
  subtotal?: number;
  taxAmount?: number;
  totalAmount: number;
  expectedDate?: string;
  notes?: string;
  paymentTerm?: string;
  paymentTermCustom?: string;
  incoterm?: string;
  deliveryLocation?: string;
  termsAndConditions?: string;
  attachmentUrls?: string[];
  approvalTierRequired?: 'Manager' | 'Direktur';
  directorApprovedBy?: string;
  createdBy: string;
  createdByName?: string;
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
  logs?: OrderLog[];
}

export interface SalesOrder {
  id: string;
  soNumber: string;
  customerId: string;
  customerName?: string;
  warehouseId: string;
  warehouseName?: string;
  currency: CurrencyCode;
  status: SoStatus;
  items: OrderItem[];
  subtotal?: number;
  taxAmount?: number;
  totalAmount: number;
  dueDate?: string;
  invoiceNumber?: string;
  taxInvoiceNumber?: string;
  quotationId?: string;
  quotationNumber?: string;
  podImageUrl?: string;
  podFileName?: string;
  podReceiverName?: string;
  podTimestamp?: string;
  notes?: string;
  paymentTerm?: string;
  paymentTermCustom?: string;
  incoterm?: string;
  deliveryLocation?: string;
  termsAndConditions?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}

export type QuotationStatus =
  | 'Draft'
  | 'Sent'
  | 'Accepted'
  | 'Rejected'
  | 'Expired'
  | 'Converted';

export interface SalesQuotation {
  id: string;
  quotationNumber: string;
  customerId: string;
  customerName?: string;
  warehouseId: string;
  warehouseName?: string;
  currency: CurrencyCode;
  status: QuotationStatus;
  items: OrderItem[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  validUntil: string;
  validityPeriod?: string;
  leadTime?: string;
  paymentTerm?: string;
  paymentTermCustom?: string;
  incoterm?: string;
  deliveryLocation?: string;
  termsAndConditions?: string;
  openingText?: string;
  notes?: string;
  convertedSoId?: string;
  convertedSoNumber?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}

export type RfqStatus = 'Draft' | 'Open' | 'Awarded' | 'Cancelled';

export interface VendorRfqQuote {
  supplierId: string;
  supplierName: string;
  currency: CurrencyCode;
  unitPrices: Record<string, number>;
  leadTimeDays: number;
  notes?: string;
  submittedAt: string;
}

export interface VendorRfq {
  id: string;
  rfqNumber: string;
  title: string;
  warehouseId: string;
  warehouseName?: string;
  deadlineDate: string;
  status: RfqStatus;
  items: OrderItem[];
  invitedSupplierIds: string[];
  quotes: VendorRfqQuote[];
  awardedSupplierId?: string;
  awardedPoId?: string;
  awardedPoNumber?: string;
  openingText?: string;
  notes?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}

export type GoodsReturnType = 'PURCHASE_RETURN' | 'SALES_RETURN';
export type GoodsReturnStatus = 'Pending' | 'Completed' | 'Cancelled';

export interface GoodsReturnItem {
  productId: string;
  sku: string;
  productName: string;
  uomCode: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  reason?: string;
}

export interface GoodsReturn {
  id: string;
  returnNumber: string;
  returnType: GoodsReturnType;
  status: GoodsReturnStatus;
  referenceOrderId: string;
  referenceOrderNumber: string;
  counterpartyId: string;
  counterpartyName: string;
  warehouseId: string;
  warehouseName?: string;
  currency: CurrencyCode;
  returnDate: string;
  items: GoodsReturnItem[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  reason: string;
  createdBy: string;
  createdByName?: string;
  completedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export type InventoryBatchStatus = 'Active' | 'Quarantine' | 'Expired' | 'Depleted';

export interface InventoryBatch {
  id: string;
  productId: string;
  productSku?: string;
  productName?: string;
  warehouseId: string;
  warehouseName?: string;
  batchNumber: string;
  serialNumber?: string;
  qty: number;
  warrantyUntil?: string;
  expiryDate?: string;
  status: InventoryBatchStatus;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccountingPeriodLock {
  id: string;
  periodKey: string;
  locked: boolean;
  notes?: string;
  lockedBy: string;
  lockedByName?: string;
  lockedAt: string;
  updatedAt: string;
}

export interface MonthlyBudget {
  id: string;
  periodKey: string;
  targetRevenueIdr: number;
  maxCogsIdr: number;
  maxOpexIdr: number;
  notes?: string;
  updatedBy: string;
  updatedAt: string;
}

export interface StockMovement {
  id: string;
  movementNumber: string;
  type: StockMovementType;
  referenceType?: string;
  referenceId?: string;
  referenceNumber?: string;
  productId: string;
  productSku?: string;
  productName?: string;
  warehouseId: string;
  warehouseName?: string;
  targetWarehouseId?: string;
  targetWarehouseName?: string;
  quantityDelta: number;
  beforeQty: number;
  afterQty: number;
  unitCost?: number;
  notes?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
}

export interface InvoicePayment {
  id: string;
  amount: number;
  currency: CurrencyCode;
  exchangeRate?: number;
  paymentMethod: string;
  referenceNo?: string;
  notes?: string;
  recordedBy: string;
  recordedByName?: string;
  paidAt: string;
}

export interface AccountingInvoice {
  id: string;
  invoiceNumber: string;
  ledgerType: LedgerType;
  counterpartyId: string;
  counterpartyName?: string;
  referenceOrderId?: string;
  referenceOrderNumber?: string;
  taxInvoiceNumber?: string;
  currency: CurrencyCode;
  exchangeRate?: number;
  totalAmount: number;
  paidAmount: number;
  balanceDue: number;
  status: InvoiceStatus;
  issueDate?: string;
  dueDate: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  payments?: InvoicePayment[];
}

export interface ChartAccount {
  id: string;
  code: string;
  name: string;
  category: AccountCategory;
  normalBalance: NormalBalance;
  openingBalanceIdr: number;
  description?: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface JournalLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  debitIdr: number;
  creditIdr: number;
  memo?: string;
}

export interface JournalEntry {
  id: string;
  entryNumber: string;
  entryDate: string;
  journalType: JournalEntryType;
  referenceType?: string;
  referenceId?: string;
  referenceNumber?: string;
  description: string;
  lines: JournalLine[];
  totalDebitIdr: number;
  totalCreditIdr: number;
  status: JournalStatus;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  module: string;
  action: string;
  targetId?: string;
  targetLabel?: string;
  actorId: string;
  actorEmail?: string;
  actorRole: string;
  details?: string;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  targetRoles?: UserRole[];
  readBy?: string[];
  linkModule?: AppModule;
  createdAt: string;
}

export interface CompanySettings {
  id: string;
  companyName: string;
  tagline?: string;
  npwp?: string;
  address?: string;
  phone?: string;
  email?: string;
  logoUrl?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountHolder?: string;
  managerApprovalLimitIdr?: number;
  defaultExchangeRateUsdIdr: number;
  taxRatePercent: number;
  isPkp?: boolean;
  supplierCategories?: string[];
  initialSeedCompleted?: boolean;
  updatedBy: string;
  updatedAt: string;
}

export interface ErpState {
  users: UserProfile[];
  suppliers: Supplier[];
  customers: Customer[];
  warehouses: Warehouse[];
  categories: Category[];
  uoms: Uom[];
  products: Product[];
  purchaseOrders: PurchaseOrder[];
  salesOrders: SalesOrder[];
  salesQuotations: SalesQuotation[];
  vendorRfqs: VendorRfq[];
  goodsReturns: GoodsReturn[];
  inventoryBatches: InventoryBatch[];
  periodClosings: AccountingPeriodLock[];
  budgets: MonthlyBudget[];
  stockMovements: StockMovement[];
  invoices: AccountingInvoice[];
  chartOfAccounts: ChartAccount[];
  journalEntries: JournalEntry[];
  auditLogs: AuditLog[];
  notifications: AppNotification[];
  settings: CompanySettings;
}

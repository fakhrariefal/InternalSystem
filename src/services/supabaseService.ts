import type { User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { sanitizeAuthProfileFields } from '../models/erpLogic';
import { normalizeUserRole } from '../models/rbac';
import { createEmptyErpState, createInitialSeedState } from '../models/seedData';
import { remapSeedStateForCompany } from '../models/seedRemapper';
import type {
  AccountingInvoice,
  AccountingPeriodLock,
  AppNotification,
  AuditLog,
  Category,
  ChartAccount,
  CompanySettings,
  Customer,
  ErpState,
  GoodsReturn,
  InventoryBatch,
  InvoicePayment,
  JournalEntry,
  MonthlyBudget,
  OrderLog,
  Product,
  PurchaseOrder,
  SalesOrder,
  SalesQuotation,
  StockMovement,
  Supplier,
  Uom,
  UserProfile,
  VendorRfq,
  Warehouse,
} from '../models/types';

export type ErpTableName =
  | 'profiles'
  | 'companies'
  | 'warehouses'
  | 'categories'
  | 'uoms'
  | 'suppliers'
  | 'customers'
  | 'products'
  | 'purchase_orders'
  | 'purchase_order_logs'
  | 'sales_quotations'
  | 'sales_orders'
  | 'vendor_rfqs'
  | 'goods_returns'
  | 'inventory_batches'
  | 'stock_movements'
  | 'invoices'
  | 'invoice_payments'
  | 'chart_of_accounts'
  | 'journal_entries'
  | 'accounting_period_locks'
  | 'monthly_budgets'
  | 'audit_logs'
  | 'notifications';

export type LogicalCollectionKey =
  | 'users'
  | 'suppliers'
  | 'customers'
  | 'warehouses'
  | 'categories'
  | 'uoms'
  | 'products'
  | 'purchaseOrders'
  | 'salesOrders'
  | 'salesQuotations'
  | 'vendorRfqs'
  | 'goodsReturns'
  | 'inventoryBatches'
  | 'periodClosings'
  | 'budgets'
  | 'stockMovements'
  | 'invoices'
  | 'chartOfAccounts'
  | 'journalEntries'
  | 'auditLogs'
  | 'notifications'
  | 'settings';

const COLLECTION_TO_TABLE: Record<LogicalCollectionKey, ErpTableName> = {
  users: 'profiles',
  suppliers: 'suppliers',
  customers: 'customers',
  warehouses: 'warehouses',
  categories: 'categories',
  uoms: 'uoms',
  products: 'products',
  purchaseOrders: 'purchase_orders',
  salesOrders: 'sales_orders',
  salesQuotations: 'sales_quotations',
  vendorRfqs: 'vendor_rfqs',
  goodsReturns: 'goods_returns',
  inventoryBatches: 'inventory_batches',
  periodClosings: 'accounting_period_locks',
  budgets: 'monthly_budgets',
  stockMovements: 'stock_movements',
  invoices: 'invoices',
  chartOfAccounts: 'chart_of_accounts',
  journalEntries: 'journal_entries',
  auditLogs: 'audit_logs',
  notifications: 'notifications',
  settings: 'companies',
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function makeUuid(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function toNullableUuid(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return UUID_REGEX.test(trimmed) ? trimmed : null;
}

function num(val: unknown, fallback: number = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function str(val: unknown, fallback: string = ''): string {
  return typeof val === 'string' ? val : val == null ? fallback : String(val);
}

function iso(val: unknown): string {
  if (typeof val === 'string' && val.trim()) return val;
  return new Date().toISOString();
}

function throwIfError(error: { message: string; code?: string; details?: string } | null, context: string): void {
  if (!error) return;
  const msg = error.details ? `${error.message} (${error.details})` : error.message;
  throw new Error(`[${context}] ${msg}`);
}

// ============================================================================
// Upload Helpers (Supabase Storage bucket 'erp-documents' + Data URL fallback)
// ============================================================================

const ALLOWED_PARTNER_DOC_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca file dokumen.'));
    reader.readAsDataURL(file);
  });
}

async function compressImageToDataUrl(file: File): Promise<string> {
  const rawDataUrl = await readFileAsDataUrl(file);
  if (rawDataUrl.length <= 180000) return rawDataUrl;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1200;
      let width = img.width;
      let height = img.height;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(rawDataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
}

export async function uploadFileToStorage(
  folder: 'products' | 'po-documents' | 'company' | 'partner-docs' | 'pod-docs',
  file: File,
  companyId?: string
): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const prefix = companyId ? `${companyId}/${folder}` : folder;
  const path = `${prefix}/${Date.now()}_${safeName}`;
  const { error } = await supabase.storage.from('erp-documents').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) {
    throw new Error(error.message);
  }
  const { data } = supabase.storage.from('erp-documents').getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadPartnerDocument(
  file: File,
  mode: 'supabase' | 'preview',
  folder: 'partner-docs' | 'pod-docs' = 'partner-docs',
  companyId?: string
): Promise<{ url: string; fileName: string }> {
  const mime = (file.type || '').toLowerCase();
  const extAllowed = /\.(pdf|jpe?g|png|webp)$/i.test(file.name);
  if (!ALLOWED_PARTNER_DOC_MIMES.has(mime) && !extAllowed) {
    throw new Error('Format file harus PDF, JPG, atau PNG.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error(`Ukuran file "${file.name}" melebihi batas maksimum 5 MB.`);
  }

  if (mode === 'preview') {
    const url = mime.startsWith('image/')
      ? await compressImageToDataUrl(file)
      : URL.createObjectURL(file);
    return { url, fileName: file.name };
  }

  try {
    const storageUrl = await uploadFileToStorage(folder, file, companyId);
    return { url: storageUrl, fileName: file.name };
  } catch {
    if (mime.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(file.name)) {
      const compressed = await compressImageToDataUrl(file);
      if (compressed.length <= 280000) {
        return { url: compressed, fileName: file.name };
      }
      throw new Error(`Gambar "${file.name}" terlalu besar untuk disimpan. Perkecil resolusi gambar (< 200 KB).`);
    }
    if (file.size <= 200 * 1024) {
      const dataUrl = await readFileAsDataUrl(file);
      if (dataUrl.length <= 290000) {
        return { url: dataUrl, fileName: file.name };
      }
    }
    throw new Error(
      `Upload file "${file.name}" gagal (Storage bucket belum siap & ukuran PDF > 200 KB). Gunakan file PDF <= 200 KB atau format JPG/PNG.`
    );
  }
}

export async function uploadPodDocument(
  file: File,
  mode: 'supabase' | 'preview',
  companyId?: string
): Promise<{ url: string; fileName: string }> {
  return uploadPartnerDocument(file, mode, 'pod-docs', companyId);
}

// ============================================================================
// Row <-> Domain Model Mappers
// ============================================================================

function mapProfileRow(row: Record<string, unknown>): UserProfile {
  return {
    uid: str(row.id),
    authUserId: row.auth_user_id ? str(row.auth_user_id) : undefined,
    companyId: str(row.company_id),
    email: str(row.email),
    displayName: str(row.display_name),
    role: normalizeUserRole(str(row.role)),
    department: str(row.department, 'Umum'),
    active: row.active !== false,
    photoURL: str(row.photo_url),
    claimedFromUserId: row.claimed_from_user_id ? str(row.claimed_from_user_id) : undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapCompanyRow(row: Record<string, unknown>): CompanySettings {
  return {
    id: str(row.id),
    companyName: str(row.company_name, 'PT Domestiq Hub Indonesia'),
    tagline: str(row.tagline, 'General Supplier ERP'),
    npwp: str(row.npwp),
    address: str(row.address),
    phone: str(row.phone),
    email: str(row.email),
    logoUrl: str(row.logo_url),
    bankName: str(row.bank_name),
    bankAccountNumber: str(row.bank_account_number),
    bankAccountHolder: str(row.bank_account_holder),
    managerApprovalLimitIdr: num(row.manager_approval_limit_idr, 25_000_000),
    defaultExchangeRateUsdIdr: num(row.default_exchange_rate_usd_idr, 16250),
    taxRatePercent: num(row.tax_rate_percent, 11),
    isPkp: row.is_pkp === true,
    supplierCategories: Array.isArray(row.supplier_categories)
      ? (row.supplier_categories as string[])
      : ['IT', 'Safety/MRO', 'Packaging', 'ATK'],
    initialSeedCompleted: row.initial_seed_completed !== false,
    updatedBy: str(row.updated_by),
    updatedAt: iso(row.updated_at),
  };
}

function mapWarehouseRow(row: Record<string, unknown>): Warehouse {
  return {
    id: str(row.id),
    code: str(row.code),
    name: str(row.name),
    address: str(row.address),
    picName: str(row.pic_name),
    phone: str(row.phone),
    active: row.active !== false,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapCategoryRow(row: Record<string, unknown>): Category {
  return {
    id: str(row.id),
    code: str(row.code),
    name: str(row.name),
    description: str(row.description),
    createdAt: iso(row.created_at),
  };
}

function mapUomRow(row: Record<string, unknown>): Uom {
  return {
    id: str(row.id),
    code: str(row.code),
    name: str(row.name),
    createdAt: iso(row.created_at),
  };
}

function mapSupplierRow(row: Record<string, unknown>): Supplier {
  return {
    id: str(row.id),
    code: str(row.code),
    name: str(row.name),
    vendorCategory: str(row.vendor_category, 'Safety/MRO'),
    nib: str(row.nib),
    npwp: str(row.npwp),
    taxStatus: (row.tax_status as Supplier['taxStatus']) || 'PKP',
    address: str(row.address),
    contactPerson: str(row.contact_person),
    phone: str(row.phone),
    email: str(row.email),
    bankName: str(row.bank_name),
    bankAccount: str(row.bank_account),
    paymentScheme: (row.payment_scheme as Supplier['paymentScheme']) || 'TOP',
    paymentTermDays: num(row.payment_term_days, 30),
    defaultCurrency: (row.default_currency as Supplier['defaultCurrency']) || 'IDR',
    ...(row.nib_doc_url ? { nibDocUrl: str(row.nib_doc_url), nibFileName: str(row.nib_file_name) } : {}),
    ...(row.npwp_doc_url ? { npwpDocUrl: str(row.npwp_doc_url), npwpFileName: str(row.npwp_file_name) } : {}),
    ...(row.ktp_director_doc_url
      ? { ktpDirectorDocUrl: str(row.ktp_director_doc_url), ktpDirectorFileName: str(row.ktp_director_file_name) }
      : {}),
    verificationStatus: (row.verification_status as Supplier['verificationStatus']) || 'Pending',
    ...(row.verified_by ? { verifiedBy: str(row.verified_by) } : {}),
    ...(row.verified_at ? { verifiedAt: iso(row.verified_at) } : {}),
    active: row.active !== false,
    createdBy: str(row.created_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapCustomerRow(row: Record<string, unknown>): Customer {
  return {
    id: str(row.id),
    code: str(row.code),
    name: str(row.name),
    nib: str(row.nib),
    npwp: str(row.npwp),
    taxStatus: (row.tax_status as Customer['taxStatus']) || 'PKP',
    address: str(row.address),
    billingAddress: str(row.billing_address),
    shippingAddress: str(row.shipping_address),
    contactPerson: str(row.contact_person),
    phone: str(row.phone),
    email: str(row.email),
    picPurchasingName: str(row.pic_purchasing_name),
    picPurchasingPhone: str(row.pic_purchasing_phone),
    picWarehouseName: str(row.pic_warehouse_name),
    picWarehousePhone: str(row.pic_warehouse_phone),
    picFinanceName: str(row.pic_finance_name),
    picFinancePhone: str(row.pic_finance_phone),
    paymentScheme: (row.payment_scheme as Customer['paymentScheme']) || 'CBD',
    creditLimit: num(row.credit_limit, 0),
    paymentTermDays: num(row.payment_term_days, 0),
    contractPrices: Array.isArray(row.contract_prices) ? (row.contract_prices as Customer['contractPrices']) : [],
    ...(row.nib_doc_url ? { nibDocUrl: str(row.nib_doc_url), nibFileName: str(row.nib_file_name) } : {}),
    ...(row.npwp_doc_url ? { npwpDocUrl: str(row.npwp_doc_url), npwpFileName: str(row.npwp_file_name) } : {}),
    verificationStatus: (row.verification_status as Customer['verificationStatus']) || 'Pending',
    ...(row.verified_by ? { verifiedBy: str(row.verified_by) } : {}),
    ...(row.verified_at ? { verifiedAt: iso(row.verified_at) } : {}),
    active: row.active !== false,
    createdBy: str(row.created_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapProductRow(row: Record<string, unknown>): Product {
  return {
    id: str(row.id),
    sku: str(row.sku),
    name: str(row.name),
    categoryId: str(row.category_id),
    categoryName: str(row.category_name),
    uomCode: str(row.uom_code),
    description: str(row.description),
    imageUrl: str(row.image_url),
    buyPrice: num(row.buy_price, 0),
    sellPrice: num(row.sell_price, 0),
    currency: (row.currency as Product['currency']) || 'IDR',
    minStock: num(row.min_stock, 0),
    maxStock: num(row.max_stock, 0),
    trackSerialOrExpiry: row.track_serial_or_expiry === true,
    isService: row.is_service === true,
    warehouseStocks:
      row.warehouse_stocks && typeof row.warehouse_stocks === 'object' && !Array.isArray(row.warehouse_stocks)
        ? (row.warehouse_stocks as Record<string, number>)
        : {},
    active: row.active !== false,
    createdBy: str(row.created_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapPoLogRow(row: Record<string, unknown>): OrderLog {
  return {
    id: str(row.id),
    action: str(row.action),
    actorId: str(row.actor_id),
    actorName: str(row.actor_name),
    ...(row.note ? { note: str(row.note) } : {}),
    timestamp: iso(row.timestamp),
  };
}

function mapPoRow(row: Record<string, unknown>, logsByPo: Map<string, OrderLog[]>): PurchaseOrder {
  const id = str(row.id);
  return {
    id,
    poNumber: str(row.po_number),
    supplierId: str(row.supplier_id),
    supplierName: str(row.supplier_name),
    warehouseId: str(row.warehouse_id),
    warehouseName: str(row.warehouse_name),
    currency: (row.currency as PurchaseOrder['currency']) || 'IDR',
    exchangeRate: num(row.exchange_rate, 16250),
    status: row.status as PurchaseOrder['status'],
    items: Array.isArray(row.items) ? (row.items as PurchaseOrder['items']) : [],
    subtotal: num(row.subtotal, 0),
    taxAmount: num(row.tax_amount, 0),
    totalAmount: num(row.total_amount, 0),
    expectedDate: str(row.expected_date),
    notes: str(row.notes),
    paymentTerm: str(row.payment_term),
    ...(row.payment_term_custom ? { paymentTermCustom: str(row.payment_term_custom) } : {}),
    incoterm: str(row.incoterm),
    deliveryLocation: str(row.delivery_location),
    termsAndConditions: str(row.terms_and_conditions),
    attachmentUrls: Array.isArray(row.attachment_urls) ? (row.attachment_urls as string[]) : [],
    approvalTierRequired: (row.approval_tier_required as PurchaseOrder['approvalTierRequired']) || 'Manager',
    ...(row.director_approved_by ? { directorApprovedBy: str(row.director_approved_by) } : {}),
    createdBy: str(row.created_by),
    createdByName: str(row.created_by_name),
    ...(row.approved_by ? { approvedBy: str(row.approved_by) } : {}),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    logs: logsByPo.get(id) || [],
  };
}

function mapQuotationRow(row: Record<string, unknown>): SalesQuotation {
  return {
    id: str(row.id),
    quotationNumber: str(row.quotation_number),
    customerId: str(row.customer_id),
    customerName: str(row.customer_name),
    warehouseId: str(row.warehouse_id),
    warehouseName: str(row.warehouse_name),
    currency: (row.currency as SalesQuotation['currency']) || 'IDR',
    status: row.status as SalesQuotation['status'],
    items: Array.isArray(row.items) ? (row.items as SalesQuotation['items']) : [],
    subtotal: num(row.subtotal, 0),
    taxAmount: num(row.tax_amount, 0),
    totalAmount: num(row.total_amount, 0),
    validUntil: str(row.valid_until),
    validityPeriod: str(row.validity_period),
    leadTime: str(row.lead_time),
    paymentTerm: str(row.payment_term),
    ...(row.payment_term_custom ? { paymentTermCustom: str(row.payment_term_custom) } : {}),
    incoterm: str(row.incoterm),
    deliveryLocation: str(row.delivery_location),
    termsAndConditions: str(row.terms_and_conditions),
    ...(row.opening_text ? { openingText: str(row.opening_text) } : {}),
    notes: str(row.notes),
    ...(row.converted_so_id ? { convertedSoId: str(row.converted_so_id) } : {}),
    ...(row.converted_so_number ? { convertedSoNumber: str(row.converted_so_number) } : {}),
    createdBy: str(row.created_by),
    createdByName: str(row.created_by_name),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapSoRow(row: Record<string, unknown>): SalesOrder {
  return {
    id: str(row.id),
    soNumber: str(row.so_number),
    customerId: str(row.customer_id),
    customerName: str(row.customer_name),
    warehouseId: str(row.warehouse_id),
    warehouseName: str(row.warehouse_name),
    currency: (row.currency as SalesOrder['currency']) || 'IDR',
    status: row.status as SalesOrder['status'],
    items: Array.isArray(row.items) ? (row.items as SalesOrder['items']) : [],
    subtotal: num(row.subtotal, 0),
    taxAmount: num(row.tax_amount, 0),
    totalAmount: num(row.total_amount, 0),
    dueDate: str(row.due_date),
    ...(row.invoice_number ? { invoiceNumber: str(row.invoice_number) } : {}),
    ...(row.tax_invoice_number ? { taxInvoiceNumber: str(row.tax_invoice_number) } : {}),
    ...(row.quotation_id ? { quotationId: str(row.quotation_id) } : {}),
    ...(row.quotation_number ? { quotationNumber: str(row.quotation_number) } : {}),
    ...(row.pod_image_url ? { podImageUrl: str(row.pod_image_url), podFileName: str(row.pod_file_name) } : {}),
    ...(row.pod_receiver_name ? { podReceiverName: str(row.pod_receiver_name) } : {}),
    ...(row.pod_timestamp ? { podTimestamp: str(row.pod_timestamp) } : {}),
    notes: str(row.notes),
    paymentTerm: str(row.payment_term),
    ...(row.payment_term_custom ? { paymentTermCustom: str(row.payment_term_custom) } : {}),
    incoterm: str(row.incoterm),
    deliveryLocation: str(row.delivery_location),
    termsAndConditions: str(row.terms_and_conditions),
    createdBy: str(row.created_by),
    createdByName: str(row.created_by_name),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapRfqRow(row: Record<string, unknown>): VendorRfq {
  return {
    id: str(row.id),
    rfqNumber: str(row.rfq_number),
    title: str(row.title),
    warehouseId: str(row.warehouse_id),
    warehouseName: str(row.warehouse_name),
    deadlineDate: str(row.deadline_date),
    status: row.status as VendorRfq['status'],
    items: Array.isArray(row.items) ? (row.items as VendorRfq['items']) : [],
    invitedSupplierIds: Array.isArray(row.invited_supplier_ids)
      ? (row.invited_supplier_ids as string[])
      : [],
    quotes: Array.isArray(row.quotes) ? (row.quotes as VendorRfq['quotes']) : [],
    ...(row.awarded_supplier_id ? { awardedSupplierId: str(row.awarded_supplier_id) } : {}),
    ...(row.awarded_po_id ? { awardedPoId: str(row.awarded_po_id) } : {}),
    ...(row.awarded_po_number ? { awardedPoNumber: str(row.awarded_po_number) } : {}),
    ...(row.opening_text ? { openingText: str(row.opening_text) } : {}),
    notes: str(row.notes),
    createdBy: str(row.created_by),
    createdByName: str(row.created_by_name),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapGoodsReturnRow(row: Record<string, unknown>): GoodsReturn {
  return {
    id: str(row.id),
    returnNumber: str(row.return_number),
    returnType: row.return_type as GoodsReturn['returnType'],
    status: row.status as GoodsReturn['status'],
    referenceOrderId: str(row.reference_order_id),
    referenceOrderNumber: str(row.reference_order_number),
    counterpartyId: str(row.counterparty_id),
    counterpartyName: str(row.counterparty_name),
    warehouseId: str(row.warehouse_id),
    warehouseName: str(row.warehouse_name),
    currency: (row.currency as GoodsReturn['currency']) || 'IDR',
    returnDate: str(row.return_date),
    items: Array.isArray(row.items) ? (row.items as GoodsReturn['items']) : [],
    subtotal: num(row.subtotal, 0),
    taxAmount: num(row.tax_amount, 0),
    totalAmount: num(row.total_amount, 0),
    reason: str(row.reason),
    createdBy: str(row.created_by),
    createdByName: str(row.created_by_name),
    ...(row.completed_by ? { completedBy: str(row.completed_by) } : {}),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapBatchRow(row: Record<string, unknown>): InventoryBatch {
  return {
    id: str(row.id),
    productId: str(row.product_id),
    productSku: str(row.product_sku),
    productName: str(row.product_name),
    warehouseId: str(row.warehouse_id),
    warehouseName: str(row.warehouse_name),
    batchNumber: str(row.batch_number),
    ...(row.serial_number ? { serialNumber: str(row.serial_number) } : {}),
    qty: num(row.qty, 0),
    ...(row.warranty_until ? { warrantyUntil: str(row.warranty_until) } : {}),
    ...(row.expiry_date ? { expiryDate: str(row.expiry_date) } : {}),
    status: row.status as InventoryBatch['status'],
    ...(row.notes ? { notes: str(row.notes) } : {}),
    createdBy: str(row.created_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapStockMovementRow(row: Record<string, unknown>): StockMovement {
  return {
    id: str(row.id),
    movementNumber: str(row.movement_number),
    type: row.type as StockMovement['type'],
    ...(row.reference_type ? { referenceType: str(row.reference_type) } : {}),
    ...(row.reference_id ? { referenceId: str(row.reference_id) } : {}),
    ...(row.reference_number ? { referenceNumber: str(row.reference_number) } : {}),
    productId: str(row.product_id),
    productSku: str(row.product_sku),
    productName: str(row.product_name),
    warehouseId: str(row.warehouse_id),
    warehouseName: str(row.warehouse_name),
    ...(row.target_warehouse_id ? { targetWarehouseId: str(row.target_warehouse_id) } : {}),
    ...(row.target_warehouse_name ? { targetWarehouseName: str(row.target_warehouse_name) } : {}),
    quantityDelta: num(row.quantity_delta, 0),
    beforeQty: num(row.before_qty, 0),
    afterQty: num(row.after_qty, 0),
    unitCost: num(row.unit_cost, 0),
    notes: str(row.notes),
    createdBy: str(row.created_by),
    createdByName: str(row.created_by_name),
    createdAt: iso(row.created_at),
  };
}

function mapInvoicePaymentRow(row: Record<string, unknown>): InvoicePayment {
  return {
    id: str(row.id),
    amount: num(row.amount, 0),
    currency: (row.currency as InvoicePayment['currency']) || 'IDR',
    exchangeRate: num(row.exchange_rate, 16250),
    paymentMethod: str(row.payment_method),
    referenceNo: str(row.reference_no),
    notes: str(row.notes),
    recordedBy: str(row.recorded_by),
    recordedByName: str(row.recorded_by_name),
    paidAt: iso(row.paid_at),
  };
}

function mapInvoiceRow(
  row: Record<string, unknown>,
  paymentsByInvoice: Map<string, InvoicePayment[]>
): AccountingInvoice {
  const id = str(row.id);
  return {
    id,
    invoiceNumber: str(row.invoice_number),
    ledgerType: row.ledger_type as AccountingInvoice['ledgerType'],
    counterpartyId: str(row.counterparty_id),
    counterpartyName: str(row.counterparty_name),
    ...(row.reference_order_id ? { referenceOrderId: str(row.reference_order_id) } : {}),
    ...(row.reference_order_number ? { referenceOrderNumber: str(row.reference_order_number) } : {}),
    ...(row.tax_invoice_number ? { taxInvoiceNumber: str(row.tax_invoice_number) } : {}),
    currency: (row.currency as AccountingInvoice['currency']) || 'IDR',
    exchangeRate: num(row.exchange_rate, 16250),
    totalAmount: num(row.total_amount, 0),
    paidAmount: num(row.paid_amount, 0),
    balanceDue: num(row.balance_due, 0),
    status: row.status as AccountingInvoice['status'],
    issueDate: str(row.issue_date),
    dueDate: str(row.due_date),
    createdBy: str(row.created_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    payments: paymentsByInvoice.get(id) || [],
  };
}

function mapCoaRow(row: Record<string, unknown>): ChartAccount {
  return {
    id: str(row.id),
    code: str(row.code),
    name: str(row.name),
    category: row.category as ChartAccount['category'],
    normalBalance: row.normal_balance as ChartAccount['normalBalance'],
    openingBalanceIdr: num(row.opening_balance_idr, 0),
    description: str(row.description),
    active: row.active !== false,
    createdBy: str(row.created_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapJournalRow(row: Record<string, unknown>): JournalEntry {
  return {
    id: str(row.id),
    entryNumber: str(row.entry_number),
    entryDate: str(row.entry_date),
    journalType: row.journal_type as JournalEntry['journalType'],
    ...(row.reference_type ? { referenceType: str(row.reference_type) } : {}),
    ...(row.reference_id ? { referenceId: str(row.reference_id) } : {}),
    ...(row.reference_number ? { referenceNumber: str(row.reference_number) } : {}),
    description: str(row.description),
    lines: Array.isArray(row.lines) ? (row.lines as JournalEntry['lines']) : [],
    totalDebitIdr: num(row.total_debit_idr, 0),
    totalCreditIdr: num(row.total_credit_idr, 0),
    status: row.status as JournalEntry['status'],
    createdBy: str(row.created_by),
    createdByName: str(row.created_by_name),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapPeriodClosingRow(row: Record<string, unknown>): AccountingPeriodLock {
  return {
    id: str(row.id),
    periodKey: str(row.period_key),
    locked: row.locked === true,
    ...(row.notes ? { notes: str(row.notes) } : {}),
    lockedBy: str(row.locked_by),
    lockedByName: str(row.locked_by_name),
    lockedAt: iso(row.locked_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapBudgetRow(row: Record<string, unknown>): MonthlyBudget {
  return {
    id: str(row.id),
    periodKey: str(row.period_key),
    targetRevenueIdr: num(row.target_revenue_idr, 0),
    maxCogsIdr: num(row.max_cogs_idr, 0),
    maxOpexIdr: num(row.max_opex_idr, 0),
    ...(row.notes ? { notes: str(row.notes) } : {}),
    updatedBy: str(row.updated_by),
    updatedAt: iso(row.updated_at),
  };
}

function mapAuditRow(row: Record<string, unknown>): AuditLog {
  return {
    id: str(row.id),
    module: str(row.module),
    action: str(row.action),
    ...(row.target_id ? { targetId: str(row.target_id) } : {}),
    ...(row.target_label ? { targetLabel: str(row.target_label) } : {}),
    actorId: str(row.actor_id),
    actorEmail: str(row.actor_email),
    actorRole: str(row.actor_role),
    details: str(row.details),
    createdAt: iso(row.created_at),
  };
}

function mapNotificationRow(row: Record<string, unknown>): AppNotification {
  return {
    id: str(row.id),
    title: str(row.title),
    message: str(row.message),
    severity: (row.severity as AppNotification['severity']) || 'info',
    targetRoles: Array.isArray(row.target_roles)
      ? (row.target_roles as string[]).map((r) => normalizeUserRole(r))
      : [],
    readBy: Array.isArray(row.read_by) ? (row.read_by as string[]) : [],
    ...(row.link_module ? { linkModule: row.link_module as AppNotification['linkModule'] } : {}),
    createdAt: iso(row.created_at),
  };
}

// ============================================================================
// Domain Model -> PostgreSQL Snake-Case Row Serializers
// ============================================================================

const CAMEL_TO_SNAKE_FIELD: Record<string, string> = {
  companyId: 'company_id',
  authUserId: 'auth_user_id',
  companyName: 'company_name',
  logoUrl: 'logo_url',
  bankName: 'bank_name',
  bankAccountNumber: 'bank_account_number',
  bankAccountHolder: 'bank_account_holder',
  managerApprovalLimitIdr: 'manager_approval_limit_idr',
  defaultExchangeRateUsdIdr: 'default_exchange_rate_usd_idr',
  taxRatePercent: 'tax_rate_percent',
  isPkp: 'is_pkp',
  supplierCategories: 'supplier_categories',
  initialSeedCompleted: 'initial_seed_completed',
  updatedBy: 'updated_by',
  updatedAt: 'updated_at',
  createdAt: 'created_at',
  displayName: 'display_name',
  photoURL: 'photo_url',
  claimedFromUserId: 'claimed_from_user_id',
  picName: 'pic_name',
  vendorCategory: 'vendor_category',
  taxStatus: 'tax_status',
  contactPerson: 'contact_person',
  bankAccount: 'bank_account',
  paymentScheme: 'payment_scheme',
  paymentTermDays: 'payment_term_days',
  defaultCurrency: 'default_currency',
  nibDocUrl: 'nib_doc_url',
  nibFileName: 'nib_file_name',
  npwpDocUrl: 'npwp_doc_url',
  npwpFileName: 'npwp_file_name',
  ktpDirectorDocUrl: 'ktp_director_doc_url',
  ktpDirectorFileName: 'ktp_director_file_name',
  verificationStatus: 'verification_status',
  verifiedBy: 'verified_by',
  verifiedAt: 'verified_at',
  createdBy: 'created_by',
  createdByName: 'created_by_name',
  billingAddress: 'billing_address',
  shippingAddress: 'shipping_address',
  picPurchasingName: 'pic_purchasing_name',
  picPurchasingPhone: 'pic_purchasing_phone',
  picWarehouseName: 'pic_warehouse_name',
  picWarehousePhone: 'pic_warehouse_phone',
  picFinanceName: 'pic_finance_name',
  picFinancePhone: 'pic_finance_phone',
  creditLimit: 'credit_limit',
  contractPrices: 'contract_prices',
  categoryId: 'category_id',
  categoryName: 'category_name',
  uomCode: 'uom_code',
  imageUrl: 'image_url',
  buyPrice: 'buy_price',
  sellPrice: 'sell_price',
  minStock: 'min_stock',
  maxStock: 'max_stock',
  trackSerialOrExpiry: 'track_serial_or_expiry',
  isService: 'is_service',
  warehouseStocks: 'warehouse_stocks',
  poNumber: 'po_number',
  supplierId: 'supplier_id',
  supplierName: 'supplier_name',
  warehouseId: 'warehouse_id',
  warehouseName: 'warehouse_name',
  exchangeRate: 'exchange_rate',
  taxAmount: 'tax_amount',
  totalAmount: 'total_amount',
  expectedDate: 'expected_date',
  paymentTerm: 'payment_term',
  paymentTermCustom: 'payment_term_custom',
  deliveryLocation: 'delivery_location',
  termsAndConditions: 'terms_and_conditions',
  attachmentUrls: 'attachment_urls',
  approvalTierRequired: 'approval_tier_required',
  directorApprovedBy: 'director_approved_by',
  approvedBy: 'approved_by',
  quotationNumber: 'quotation_number',
  customerId: 'customer_id',
  customerName: 'customer_name',
  validUntil: 'valid_until',
  validityPeriod: 'validity_period',
  leadTime: 'lead_time',
  openingText: 'opening_text',
  convertedSoId: 'converted_so_id',
  convertedSoNumber: 'converted_so_number',
  soNumber: 'so_number',
  dueDate: 'due_date',
  invoiceNumber: 'invoice_number',
  taxInvoiceNumber: 'tax_invoice_number',
  quotationId: 'quotation_id',
  podImageUrl: 'pod_image_url',
  podFileName: 'pod_file_name',
  podReceiverName: 'pod_receiver_name',
  podTimestamp: 'pod_timestamp',
  rfqNumber: 'rfq_number',
  deadlineDate: 'deadline_date',
  invitedSupplierIds: 'invited_supplier_ids',
  awardedSupplierId: 'awarded_supplier_id',
  awardedPoId: 'awarded_po_id',
  awardedPoNumber: 'awarded_po_number',
  returnNumber: 'return_number',
  returnType: 'return_type',
  referenceOrderId: 'reference_order_id',
  referenceOrderNumber: 'reference_order_number',
  counterpartyId: 'counterparty_id',
  counterpartyName: 'counterparty_name',
  returnDate: 'return_date',
  completedBy: 'completed_by',
  productId: 'product_id',
  productSku: 'product_sku',
  productName: 'product_name',
  batchNumber: 'batch_number',
  serialNumber: 'serial_number',
  warrantyUntil: 'warranty_until',
  expiryDate: 'expiry_date',
  movementNumber: 'movement_number',
  referenceType: 'reference_type',
  referenceId: 'reference_id',
  referenceNumber: 'reference_number',
  targetWarehouseId: 'target_warehouse_id',
  targetWarehouseName: 'target_warehouse_name',
  quantityDelta: 'quantity_delta',
  beforeQty: 'before_qty',
  afterQty: 'after_qty',
  unitCost: 'unit_cost',
  ledgerType: 'ledger_type',
  paidAmount: 'paid_amount',
  balanceDue: 'balance_due',
  issueDate: 'issue_date',
  normalBalance: 'normal_balance',
  openingBalanceIdr: 'opening_balance_idr',
  entryNumber: 'entry_number',
  entryDate: 'entry_date',
  journalType: 'journal_type',
  totalDebitIdr: 'total_debit_idr',
  totalCreditIdr: 'total_credit_idr',
  periodKey: 'period_key',
  lockedBy: 'locked_by',
  lockedByName: 'locked_by_name',
  lockedAt: 'locked_at',
  targetRevenueIdr: 'target_revenue_idr',
  maxCogsIdr: 'max_cogs_idr',
  maxOpexIdr: 'max_opex_idr',
  targetId: 'target_id',
  targetLabel: 'target_label',
  actorId: 'actor_id',
  actorEmail: 'actor_email',
  actorRole: 'actor_role',
  targetRoles: 'target_roles',
  readBy: 'read_by',
  linkModule: 'link_module',
};

const NULLABLE_UUID_COLUMNS = new Set([
  'category_id',
  'supplier_id',
  'customer_id',
  'warehouse_id',
  'target_warehouse_id',
  'product_id',
  'verified_by',
  'created_by',
  'approved_by',
  'director_approved_by',
  'updated_by',
  'completed_by',
  'locked_by',
  'recorded_by',
  'actor_id',
  'quotation_id',
  'converted_so_id',
  'awarded_supplier_id',
  'awarded_po_id',
  'reference_order_id',
  'counterparty_id',
  'reference_id',
]);

function serializePayload(
  table: ErpTableName,
  payload: Record<string, unknown>,
  companyId?: string
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(payload)) {
    if (val === undefined) continue;
    if (table === 'profiles' && key === 'uid') {
      row.id = val;
      continue;
    }
    if (table === 'purchase_orders' && key === 'logs') continue;
    if (table === 'invoices' && key === 'payments') continue;

    const col = CAMEL_TO_SNAKE_FIELD[key] || key;
    if (NULLABLE_UUID_COLUMNS.has(col)) {
      row[col] = toNullableUuid(val);
    } else {
      row[col] = val;
    }
  }
  if (companyId && table !== 'companies') {
    row.company_id = companyId;
  }
  return row;
}

// ============================================================================
// Auth Profile Hydration & Seed Marker
// ============================================================================

export async function ensureAuthenticatedUserProfile(user: SupabaseUser): Promise<UserProfile> {
  const { emailLower, displayName, photoURL } = sanitizeAuthProfileFields({
    email: user.email || '',
    displayName:
      (user.user_metadata?.display_name as string | undefined) ||
      (user.user_metadata?.full_name as string | undefined) ||
      'User Domestiq',
    photoURL:
      (user.user_metadata?.avatar_url as string | undefined) ||
      (user.user_metadata?.picture as string | undefined) ||
      '',
  });

  const fetchProfileAndMember = async () => {
    const [profileRes, memberRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('auth_user_id', user.id).maybeSingle(),
      supabase.from('company_members').select('*').eq('user_id', user.id).maybeSingle(),
    ]);
    throwIfError(profileRes.error, 'profiles.select');
    throwIfError(memberRes.error, 'company_members.select');
    return { profileRow: profileRes.data, memberRow: memberRes.data };
  };

  let { profileRow, memberRow } = await fetchProfileAndMember();

  if (!profileRow && !memberRow) {
    // Micro-wait in case on_auth_user_created trigger just ran concurrently
    await new Promise((r) => setTimeout(r, 400));
    const retry = await fetchProfileAndMember();
    profileRow = retry.profileRow;
    memberRow = retry.memberRow;
  }

  if (!profileRow && !memberRow) {
    throw new Error(
      'Profil & keanggotaan perusahaan belum ditemukan di tabel profiles / company_members. Pastikan migrasi SQL Supabase sudah dijalankan.'
    );
  }

  const baseRow = (profileRow || memberRow) as Record<string, unknown>;
  const profile = profileRow
    ? mapProfileRow(baseRow)
    : {
        uid: str(baseRow.profile_id || baseRow.id),
        authUserId: user.id,
        companyId: str(baseRow.company_id),
        email: str(baseRow.email),
        displayName: str(baseRow.display_name),
        role: normalizeUserRole(str(baseRow.role)),
        department: str(baseRow.department, 'Umum'),
        active: baseRow.active !== false,
        photoURL: str(baseRow.photo_url),
        createdAt: iso(baseRow.created_at),
        updatedAt: iso(baseRow.updated_at),
      };

  // Authoritative role & active check from company_members when available
  if (memberRow) {
    const member = memberRow as Record<string, unknown>;
    return {
      ...profile,
      companyId: str(member.company_id) || profile.companyId,
      role: normalizeUserRole(str(member.role)),
      active: member.active !== false && profile.active,
      department: str(member.department) || profile.department,
      email: profile.email || emailLower,
      displayName: profile.displayName || str(member.display_name) || displayName,
      photoURL: profile.photoURL || str(member.photo_url) || photoURL,
    };
  }

  return {
    ...profile,
    email: profile.email || emailLower,
    displayName: profile.displayName || displayName,
    photoURL: profile.photoURL || photoURL,
  };
}

export async function markSeedCompletedInSupabase(
  companyId: string,
  actorUid: string
): Promise<void> {
  const { error } = await supabase
    .from('companies')
    .update({
      initial_seed_completed: true,
      updated_by: toNullableUuid(actorUid),
      updated_at: new Date().toISOString(),
    })
    .eq('id', companyId);
  throwIfError(error, 'companies.mark_seed');
}

// ============================================================================
// Initial Fetch + Realtime Sync Subscription
// ============================================================================

export async function fetchAllErpData(
  companyId: string,
  options?: { includeUsers?: boolean; currentUserUid?: string }
): Promise<Partial<ErpState>> {
  const [
    companyRes,
    profilesRes,
    warehousesRes,
    categoriesRes,
    uomsRes,
    suppliersRes,
    customersRes,
    productsRes,
    posRes,
    poLogsRes,
    quotationsRes,
    sosRes,
    rfqsRes,
    returnsRes,
    batchesRes,
    movementsRes,
    invoicesRes,
    paymentsRes,
    coaRes,
    journalsRes,
    periodsRes,
    budgetsRes,
    auditsRes,
    notifsRes,
  ] = await Promise.all([
    supabase.from('companies').select('*').eq('id', companyId).maybeSingle(),
    options?.includeUsers
      ? supabase.from('profiles').select('*').eq('company_id', companyId).order('created_at', { ascending: false })
      : supabase.from('profiles').select('*').eq('id', options?.currentUserUid || ''),
    supabase.from('warehouses').select('*').eq('company_id', companyId).order('created_at', { ascending: true }),
    supabase.from('categories').select('*').eq('company_id', companyId).order('created_at', { ascending: true }),
    supabase.from('uoms').select('*').eq('company_id', companyId).order('created_at', { ascending: true }),
    supabase.from('suppliers').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    supabase.from('customers').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    supabase.from('products').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    supabase.from('purchase_orders').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    supabase.from('purchase_order_logs').select('*').eq('company_id', companyId).order('timestamp', { ascending: true }),
    supabase.from('sales_quotations').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    supabase.from('sales_orders').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    supabase.from('vendor_rfqs').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    supabase.from('goods_returns').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    supabase.from('inventory_batches').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    supabase.from('stock_movements').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    supabase.from('invoices').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    supabase.from('invoice_payments').select('*').eq('company_id', companyId).order('paid_at', { ascending: true }),
    supabase.from('chart_of_accounts').select('*').eq('company_id', companyId).order('code', { ascending: true }),
    supabase.from('journal_entries').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    supabase.from('accounting_period_locks').select('*').eq('company_id', companyId).order('period_key', { ascending: false }),
    supabase.from('monthly_budgets').select('*').eq('company_id', companyId).order('period_key', { ascending: false }),
    supabase.from('audit_logs').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(500),
    supabase.from('notifications').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(200),
  ]);

  throwIfError(companyRes.error, 'companies');
  throwIfError(profilesRes.error, 'profiles');
  throwIfError(warehousesRes.error, 'warehouses');
  throwIfError(categoriesRes.error, 'categories');
  throwIfError(uomsRes.error, 'uoms');
  throwIfError(suppliersRes.error, 'suppliers');
  throwIfError(customersRes.error, 'customers');
  throwIfError(productsRes.error, 'products');
  throwIfError(posRes.error, 'purchase_orders');
  throwIfError(poLogsRes.error, 'purchase_order_logs');
  throwIfError(quotationsRes.error, 'sales_quotations');
  throwIfError(sosRes.error, 'sales_orders');
  throwIfError(rfqsRes.error, 'vendor_rfqs');
  throwIfError(returnsRes.error, 'goods_returns');
  throwIfError(batchesRes.error, 'inventory_batches');
  throwIfError(movementsRes.error, 'stock_movements');
  throwIfError(invoicesRes.error, 'invoices');
  throwIfError(paymentsRes.error, 'invoice_payments');
  throwIfError(coaRes.error, 'chart_of_accounts');
  throwIfError(journalsRes.error, 'journal_entries');
  throwIfError(periodsRes.error, 'accounting_period_locks');
  throwIfError(budgetsRes.error, 'monthly_budgets');
  throwIfError(auditsRes.error, 'audit_logs');
  throwIfError(notifsRes.error, 'notifications');

  const logsByPo = new Map<string, OrderLog[]>();
  for (const row of poLogsRes.data || []) {
    const poId = str((row as Record<string, unknown>).purchase_order_id);
    const list = logsByPo.get(poId) || [];
    list.push(mapPoLogRow(row as Record<string, unknown>));
    logsByPo.set(poId, list);
  }

  const paymentsByInvoice = new Map<string, InvoicePayment[]>();
  for (const row of paymentsRes.data || []) {
    const invId = str((row as Record<string, unknown>).invoice_id);
    const list = paymentsByInvoice.get(invId) || [];
    list.push(mapInvoicePaymentRow(row as Record<string, unknown>));
    paymentsByInvoice.set(invId, list);
  }

  const empty = createEmptyErpState();
  return {
    settings: companyRes.data ? mapCompanyRow(companyRes.data as Record<string, unknown>) : empty.settings,
    users: (profilesRes.data || []).map((r) => mapProfileRow(r as Record<string, unknown>)),
    warehouses: (warehousesRes.data || []).map((r) => mapWarehouseRow(r as Record<string, unknown>)),
    categories: (categoriesRes.data || []).map((r) => mapCategoryRow(r as Record<string, unknown>)),
    uoms: (uomsRes.data || []).map((r) => mapUomRow(r as Record<string, unknown>)),
    suppliers: (suppliersRes.data || []).map((r) => mapSupplierRow(r as Record<string, unknown>)),
    customers: (customersRes.data || []).map((r) => mapCustomerRow(r as Record<string, unknown>)),
    products: (productsRes.data || []).map((r) => mapProductRow(r as Record<string, unknown>)),
    purchaseOrders: (posRes.data || []).map((r) => mapPoRow(r as Record<string, unknown>, logsByPo)),
    salesQuotations: (quotationsRes.data || []).map((r) => mapQuotationRow(r as Record<string, unknown>)),
    salesOrders: (sosRes.data || []).map((r) => mapSoRow(r as Record<string, unknown>)),
    vendorRfqs: (rfqsRes.data || []).map((r) => mapRfqRow(r as Record<string, unknown>)),
    goodsReturns: (returnsRes.data || []).map((r) => mapGoodsReturnRow(r as Record<string, unknown>)),
    inventoryBatches: (batchesRes.data || []).map((r) => mapBatchRow(r as Record<string, unknown>)),
    stockMovements: (movementsRes.data || []).map((r) => mapStockMovementRow(r as Record<string, unknown>)),
    invoices: (invoicesRes.data || []).map((r) => mapInvoiceRow(r as Record<string, unknown>, paymentsByInvoice)),
    chartOfAccounts: (coaRes.data || []).map((r) => mapCoaRow(r as Record<string, unknown>)),
    journalEntries: (journalsRes.data || []).map((r) => mapJournalRow(r as Record<string, unknown>)),
    periodClosings: (periodsRes.data || []).map((r) => mapPeriodClosingRow(r as Record<string, unknown>)),
    budgets: (budgetsRes.data || []).map((r) => mapBudgetRow(r as Record<string, unknown>)),
    auditLogs: (auditsRes.data || []).map((r) => mapAuditRow(r as Record<string, unknown>)),
    notifications: (notifsRes.data || []).map((r) => mapNotificationRow(r as Record<string, unknown>)),
  };
}

export function subscribeErpCollections(
  companyId: string,
  onUpdate: (partial: Partial<ErpState>) => void,
  onError: (err: Error) => void,
  options?: { includeUsers?: boolean; currentUserUid?: string }
): () => void {
  let cancelled = false;
  let refreshTimer: number | null = null;

  const loadSnapshot = async () => {
    try {
      const partial = await fetchAllErpData(companyId, options);
      if (!cancelled) {
        onUpdate(partial);
      }
    } catch (err) {
      if (!cancelled) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  };

  void loadSnapshot();

  const scheduleRefresh = () => {
    if (cancelled) return;
    if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      void loadSnapshot();
    }, 350);
  };

  const channel = supabase
    .channel(`erp_tenant_${companyId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public' },
      (payload) => {
        const record = (payload.new || payload.old) as Record<string, unknown> | undefined;
        if (!record) {
          scheduleRefresh();
          return;
        }
        if (
          record.company_id === companyId ||
          (payload.table === 'companies' && record.id === companyId)
        ) {
          scheduleRefresh();
        }
      }
    )
    .subscribe();

  return () => {
    cancelled = true;
    if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    void supabase.removeChannel(channel);
  };
}

// ============================================================================
// CRUD Operations (Direct PostgreSQL via Supabase JS Client)
// ============================================================================

export async function saveSupabaseRecord(
  collection: LogicalCollectionKey,
  docId: string,
  payload: Record<string, unknown>,
  isNew: boolean,
  companyId: string
): Promise<void> {
  const table = COLLECTION_TO_TABLE[collection];
  const now = new Date().toISOString();

  if (collection === 'settings') {
    const clean = serializePayload('companies', payload);
    delete clean.id;
    delete clean.created_at;
    clean.updated_at = now;
    const { error } = await supabase.from('companies').update(clean).eq('id', companyId);
    throwIfError(error, 'companies.update');
    return;
  }

  const row = serializePayload(table, payload, companyId);
  if (isNew) {
    row.id = docId;
    if (!row.created_at && table !== 'accounting_period_locks' && table !== 'monthly_budgets') {
      row.created_at = now;
    }
    if (!row.updated_at && table !== 'categories' && table !== 'uoms' && table !== 'stock_movements' && table !== 'audit_logs' && table !== 'notifications') {
      row.updated_at = now;
    }
    const { error } = await supabase.from(table).insert(row);
    throwIfError(error, `${table}.insert`);
  } else {
    delete row.id;
    delete row.company_id;
    delete row.created_by;
    delete row.created_at;
    if (table !== 'categories' && table !== 'uoms' && table !== 'stock_movements' && table !== 'audit_logs' && table !== 'notifications') {
      row.updated_at = now;
    }
    const { error } = await supabase.from(table).update(row).eq('id', docId).eq('company_id', companyId);
    throwIfError(error, `${table}.update`);
  }
}

export async function upsertPeriodOrBudget(
  collection: 'periodClosings' | 'budgets',
  docId: string,
  payload: Record<string, unknown>,
  companyId: string
): Promise<void> {
  const table = COLLECTION_TO_TABLE[collection];
  const row = serializePayload(table, payload, companyId);
  row.updated_at = new Date().toISOString();
  const periodKey = str(payload.periodKey || row.period_key);

  const { data: existingRow, error: lookupError } = await supabase
    .from(table)
    .select('id')
    .eq('company_id', companyId)
    .eq('period_key', periodKey)
    .maybeSingle();
  throwIfError(lookupError, `${table}.lookup`);

  if (existingRow?.id) {
    delete row.id;
    delete row.company_id;
    const { error } = await supabase
      .from(table)
      .update(row)
      .eq('id', existingRow.id)
      .eq('company_id', companyId);
    throwIfError(error, `${table}.update`);
  } else {
    row.id = UUID_REGEX.test(docId) ? docId : makeUuid();
    const { error } = await supabase.from(table).insert(row);
    throwIfError(error, `${table}.insert`);
  }
}

export async function deleteSupabaseRecord(
  collection: LogicalCollectionKey,
  docId: string,
  companyId: string
): Promise<void> {
  const table = COLLECTION_TO_TABLE[collection];
  const { error } = await supabase.from(table).delete().eq('id', docId).eq('company_id', companyId);
  throwIfError(error, `${table}.delete`);
}

export async function deleteSupabaseRecordsBatch(
  collection: LogicalCollectionKey,
  ids: string[],
  companyId: string
): Promise<void> {
  const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
  if (uniqueIds.length === 0) return;
  const table = COLLECTION_TO_TABLE[collection];
  const { error } = await supabase
    .from(table)
    .delete()
    .in('id', uniqueIds)
    .eq('company_id', companyId);
  throwIfError(error, `${table}.deleteBatch`);
}

export async function deleteSupabaseMixedEntries(
  entries: Array<{ col: LogicalCollectionKey; id: string }>,
  companyId: string
): Promise<void> {
  const grouped = new Map<LogicalCollectionKey, string[]>();
  for (const entry of entries) {
    const list = grouped.get(entry.col) || [];
    list.push(entry.id);
    grouped.set(entry.col, list);
  }
  await Promise.all(
    Array.from(grouped.entries()).map(([col, ids]) => deleteSupabaseRecordsBatch(col, ids, companyId))
  );
}

export async function deletePurchaseOrdersWithLogs(
  poIds: string[],
  companyId: string
): Promise<void> {
  // purchase_order_logs has ON DELETE CASCADE
  await deleteSupabaseRecordsBatch('purchaseOrders', poIds, companyId);
}

export async function deleteInvoicesWithPayments(
  invoiceIds: string[],
  companyId: string
): Promise<void> {
  // invoice_payments has ON DELETE CASCADE
  await deleteSupabaseRecordsBatch('invoices', invoiceIds, companyId);
}

export async function appendPoLog(
  poId: string,
  log: OrderLog,
  companyId: string
): Promise<void> {
  const row = serializePayload(
    'purchase_order_logs',
    {
      id: log.id,
      purchase_order_id: poId,
      action: log.action,
      actorId: log.actorId,
      actorName: log.actorName,
      note: log.note ?? null,
      timestamp: log.timestamp || new Date().toISOString(),
    },
    companyId
  );
  const { error } = await supabase.from('purchase_order_logs').insert(row);
  throwIfError(error, 'purchase_order_logs.insert');
}

export async function appendInvoicePayment(
  invoiceId: string,
  payment: InvoicePayment,
  companyId: string
): Promise<void> {
  const row = serializePayload(
    'invoice_payments',
    {
      id: payment.id,
      invoice_id: invoiceId,
      amount: payment.amount,
      currency: payment.currency,
      exchangeRate: payment.exchangeRate ?? 16250,
      paymentMethod: payment.paymentMethod,
      referenceNo: payment.referenceNo ?? '',
      notes: payment.notes ?? '',
      recordedBy: payment.recordedBy,
      recordedByName: payment.recordedByName ?? '',
      paidAt: payment.paidAt || new Date().toISOString(),
    },
    companyId
  );
  const { error } = await supabase.from('invoice_payments').insert(row);
  throwIfError(error, 'invoice_payments.insert');
}

export async function createImmutableRecord(
  collection: 'stockMovements' | 'auditLogs' | 'notifications' | 'categories' | 'uoms',
  docId: string,
  payload: Record<string, unknown>,
  companyId: string
): Promise<void> {
  await saveSupabaseRecord(collection, docId, payload, true, companyId);
}

export async function markNotificationReadInSupabase(
  notifId: string,
  readBy: string[],
  companyId: string
): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_by: readBy })
    .eq('id', notifId)
    .eq('company_id', companyId);
  throwIfError(error, 'notifications.markRead');
}

export async function resetTotalDatabaseInSupabase(
  companyId: string,
  actorUid: string,
  currentSettings: CompanySettings
): Promise<void> {
  const tablesToClear: ErpTableName[] = [
    'purchase_order_logs',
    'invoice_payments',
    'purchase_orders',
    'invoices',
    'sales_orders',
    'sales_quotations',
    'vendor_rfqs',
    'goods_returns',
    'inventory_batches',
    'accounting_period_locks',
    'monthly_budgets',
    'stock_movements',
    'journal_entries',
    'chart_of_accounts',
    'products',
    'suppliers',
    'customers',
    'warehouses',
    'categories',
    'uoms',
    'notifications',
    'audit_logs',
  ];

  for (const tbl of tablesToClear) {
    const { error } = await supabase.from(tbl).delete().eq('company_id', companyId);
    throwIfError(error, `${tbl}.reset`);
  }

  await saveSupabaseRecord(
    'settings',
    companyId,
    {
      ...currentSettings,
      initialSeedCompleted: true,
      updatedBy: actorUid,
    },
    false,
    companyId
  );
}

export async function seedInitialDataToSupabase(
  companyId: string,
  actorUid: string,
  currentSettings: CompanySettings
): Promise<boolean> {
  // Cek apakah database sudah memiliki CoA / Gudang / Produk agar idempotent
  const [coaCheck, whCheck, prodCheck] = await Promise.all([
    supabase.from('chart_of_accounts').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
    supabase.from('warehouses').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
  ]);
  throwIfError(coaCheck.error, 'seed.check.coa');
  throwIfError(whCheck.error, 'seed.check.warehouses');
  throwIfError(prodCheck.error, 'seed.check.products');

  if ((coaCheck.count || 0) > 0 || (whCheck.count || 0) > 0 || (prodCheck.count || 0) > 0) {
    await markSeedCompletedInSupabase(companyId, actorUid);
    return false;
  }

  const seed = remapSeedStateForCompany(createInitialSeedState(), companyId, actorUid);

  const upsertBatch = async (
    table: ErpTableName,
    items: Array<Record<string, unknown>>
  ): Promise<void> => {
    if (items.length === 0) return;
    const rows = items.map((item) => serializePayload(table, item, companyId));
    const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });
    throwIfError(error, `${table}.seed`);
  };

  // 1. Master Data & Chart of Accounts (parent rows first for FKs)
  await upsertBatch('warehouses', seed.warehouses as unknown as Array<Record<string, unknown>>);
  await upsertBatch('categories', seed.categories as unknown as Array<Record<string, unknown>>);
  await upsertBatch('uoms', seed.uoms as unknown as Array<Record<string, unknown>>);
  await upsertBatch('suppliers', seed.suppliers as unknown as Array<Record<string, unknown>>);
  await upsertBatch('customers', seed.customers as unknown as Array<Record<string, unknown>>);
  await upsertBatch('products', seed.products as unknown as Array<Record<string, unknown>>);
  await upsertBatch('chart_of_accounts', seed.chartOfAccounts as unknown as Array<Record<string, unknown>>);

  // 2. Quotations, Purchase Orders + Logs, Sales Orders, RFQs, Goods Returns
  await upsertBatch('sales_quotations', seed.salesQuotations as unknown as Array<Record<string, unknown>>);
  await upsertBatch('purchase_orders', seed.purchaseOrders as unknown as Array<Record<string, unknown>>);

  const poLogRows: Array<Record<string, unknown>> = [];
  for (const po of seed.purchaseOrders) {
    for (const log of po.logs || []) {
      poLogRows.push({
        id: log.id,
        purchase_order_id: po.id,
        action: log.action,
        actorId: log.actorId,
        actorName: log.actorName,
        note: log.note ?? null,
        timestamp: log.timestamp,
      });
    }
  }
  await upsertBatch('purchase_order_logs', poLogRows);

  await upsertBatch('sales_orders', seed.salesOrders as unknown as Array<Record<string, unknown>>);
  await upsertBatch('vendor_rfqs', seed.vendorRfqs as unknown as Array<Record<string, unknown>>);
  await upsertBatch('goods_returns', seed.goodsReturns as unknown as Array<Record<string, unknown>>);

  // 3. Inventory Batches & Stock Movements
  await upsertBatch('inventory_batches', seed.inventoryBatches as unknown as Array<Record<string, unknown>>);
  await upsertBatch('stock_movements', seed.stockMovements as unknown as Array<Record<string, unknown>>);

  // 4. Invoices + Payments, Journal Entries, Period Locks, Budgets
  await upsertBatch('invoices', seed.invoices as unknown as Array<Record<string, unknown>>);

  const paymentRows: Array<Record<string, unknown>> = [];
  for (const inv of seed.invoices) {
    for (const pay of inv.payments || []) {
      paymentRows.push({
        id: pay.id,
        invoice_id: inv.id,
        amount: pay.amount,
        currency: pay.currency,
        exchangeRate: pay.exchangeRate ?? 16250,
        paymentMethod: pay.paymentMethod,
        referenceNo: pay.referenceNo ?? '',
        notes: pay.notes ?? '',
        recordedBy: pay.recordedBy,
        recordedByName: pay.recordedByName ?? '',
        paidAt: pay.paidAt,
      });
    }
  }
  await upsertBatch('invoice_payments', paymentRows);

  await upsertBatch('journal_entries', seed.journalEntries as unknown as Array<Record<string, unknown>>);
  await upsertBatch('accounting_period_locks', seed.periodClosings as unknown as Array<Record<string, unknown>>);
  await upsertBatch('monthly_budgets', seed.budgets as unknown as Array<Record<string, unknown>>);

  // 5. Audit Logs & Notifications
  await upsertBatch('audit_logs', seed.auditLogs as unknown as Array<Record<string, unknown>>);
  await upsertBatch('notifications', seed.notifications as unknown as Array<Record<string, unknown>>);

  // 6. Update company metadata & mark initial seed complete
  await saveSupabaseRecord(
    'settings',
    companyId,
    {
      ...seed.settings,
      companyName: currentSettings.companyName || seed.settings.companyName,
      email: currentSettings.email || seed.settings.email,
      initialSeedCompleted: true,
      updatedBy: actorUid,
    },
    false,
    companyId
  );

  return true;
}


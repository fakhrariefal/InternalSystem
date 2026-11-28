import type {
  CompanySettings,
  Customer,
  IncotermOption,
  PaymentTermOption,
  PurchaseOrder,
  SalesOrder,
  SalesQuotation,
  Supplier,
  VendorRfq,
  Warehouse,
} from './types';

export const PAYMENT_TERM_OPTIONS: readonly PaymentTermOption[] = [
  'CBD',
  'COD',
  'TOP 14 Hari Kalender',
  'TOP 30 Hari Kalender',
  'TOP 45 Hari Kalender',
  'Custom',
] as const;

export const INCOTERM_OPTIONS: readonly IncotermOption[] = [
  'DDP - Franco Lokasi Pembeli',
  'EXW - Loco Gudang Penjual',
  'DAP',
  'CIP',
] as const;

export const MANDATORY_PO_ATTACHMENT_NOTE =
  'Wajib mencantumkan Nomor PO pada Surat Jalan/BAST dan Invoice.';

export function getDefaultQuotationTerms(): string {
  return [
    '1. Harga berlaku sesuai Validity Period yang tercantum; perubahan harga bahan baku/kurs di luar periode berlaku memerlukan penyesuaian tertulis.',
    '2. Ketersediaan stok dikonfirmasi ulang saat Purchase Order (PO) resmi diterima oleh PT Domestiq Hub Indonesia.',
    '3. Pengiriman dilakukan sesuai Incoterms dan Lead Time setelah syarat pembayaran awal terpenuhi.',
  ].join('\n');
}

export function getDefaultSalesOrderTerms(): string {
  return [
    '1. Pengiriman barang dilaksanakan sesuai jadwal, Incoterms, dan alamat tujuan pada Sales Order ini.',
    '2. Pembeli wajib memeriksa jumlah dan kondisi fisik barang saat serah terima serta menandatangani Surat Jalan/e-POD.',
    '3. Klaim ketidaksesuaian atau kerusakan barang diajukan maksimal 2x24 jam setelah barang diterima dengan bukti dokumentasi.',
    '4. Pembayaran wajib diselesaikan sesuai Payment Term yang disepakati melalui rekening resmi perusahaan.',
  ].join('\n');
}

export function getDefaultPurchaseOrderTerms(): string {
  return [
    `1. ${MANDATORY_PO_ATTACHMENT_NOTE}`,
    '2. Barang/jasa yang dikirim harus sesuai spesifikasi teknis, kuantitas, dan standar kualitas pada Purchase Order ini.',
    '3. Penerima berhak menolak pengiriman apabila barang rusak, tidak sesuai spesifikasi, atau melewati target kirim tanpa persetujuan tertulis.',
    '4. Pembayaran diproses setelah seluruh dokumen penagihan (Invoice, Faktur Pajak, Surat Jalan/BAST ber-Nomor PO) dinyatakan lengkap.',
  ].join('\n');
}

export function getDefaultQuotationOpeningText(companyName?: string): string {
  const corp =
    (companyName || 'PT Domestiq Hub Indonesia').trim() || 'PT Domestiq Hub Indonesia';
  return `Dengan hormat,\n\nSehubungan dengan kebutuhan pengadaan barang dan/atau jasa Bapak/Ibu, bersama surat ini kami dari ${corp} menyampaikan penawaran harga resmi beserta rincian spesifikasi, kuantitas, serta syarat dan ketentuan sebagai berikut:`;
}

export function getDefaultRfqOpeningText(companyName?: string): string {
  const corp =
    (companyName || 'PT Domestiq Hub Indonesia').trim() || 'PT Domestiq Hub Indonesia';
  return `Dengan hormat,\n\nSehubungan dengan rencana pengadaan barang dan/atau jasa perusahaan kami (${corp}), kami mengundang Bapak/Ibu untuk mengajukan surat penawaran harga resmi (Quotation) sesuai rincian item, kuantitas, serta batas waktu pengajuan berikut ini:`;
}

export function getDefaultRfqTerms(): string {
  return [
    '1. Mohon mencantumkan harga satuan terbaik (sebelum/sesudah PPN), ketersediaan stok, serta estimasi Lead Time pengiriman.',
    '2. Surat penawaran resmi agar mencantumkan masa berlaku penawaran (Validity Period), Incoterms, dan syarat pembayaran (Payment Term).',
    '3. Penawaran harap dikirimkan paling lambat sesuai Batas Waktu (Deadline) dengan mencantumkan Nomor RFQ ini sebagai referensi.',
  ].join('\n');
}

export function ensureMandatoryPoTermsNote(terms?: string): string {
  const clean = (terms || '').trim();
  if (!clean) return getDefaultPurchaseOrderTerms();
  const normalized = clean.toLowerCase();
  if (
    normalized.includes('nomor po') &&
    (normalized.includes('surat jalan') || normalized.includes('bast')) &&
    normalized.includes('invoice')
  ) {
    return clean;
  }
  return `${clean}\nCatatan Wajib: ${MANDATORY_PO_ATTACHMENT_NOTE}`;
}

export function resolvePaymentTermDisplay(
  paymentTerm?: string,
  paymentTermCustom?: string,
  fallback: string = 'CBD'
): string {
  const term = (paymentTerm || '').trim();
  if (!term) return fallback;
  if (term === 'Custom') {
    const custom = (paymentTermCustom || '').trim();
    return custom || 'Custom';
  }
  return term;
}

export function normalizePaymentTermSelection(
  rawTerm?: string,
  fallback: PaymentTermOption = 'TOP 30 Hari Kalender'
): { paymentTerm: PaymentTermOption; paymentTermCustom: string } {
  const val = (rawTerm || '').trim();
  if (!val) return { paymentTerm: fallback, paymentTermCustom: '' };
  if ((PAYMENT_TERM_OPTIONS as readonly string[]).includes(val)) {
    return { paymentTerm: val as PaymentTermOption, paymentTermCustom: '' };
  }
  const upper = val.toUpperCase();
  if (upper === 'CBD') return { paymentTerm: 'CBD', paymentTermCustom: '' };
  if (upper === 'COD') return { paymentTerm: 'COD', paymentTermCustom: '' };
  if (upper.includes('14')) return { paymentTerm: 'TOP 14 Hari Kalender', paymentTermCustom: '' };
  if (upper.includes('30')) return { paymentTerm: 'TOP 30 Hari Kalender', paymentTermCustom: '' };
  if (upper.includes('45')) return { paymentTerm: 'TOP 45 Hari Kalender', paymentTermCustom: '' };
  return { paymentTerm: 'Custom', paymentTermCustom: val };
}

export function mapSupplierToPaymentTerm(
  supplier?: Pick<Supplier, 'paymentScheme' | 'paymentTermDays'>
): { paymentTerm: PaymentTermOption; paymentTermCustom: string } {
  if (!supplier) {
    return { paymentTerm: 'TOP 30 Hari Kalender', paymentTermCustom: '' };
  }
  if (supplier.paymentScheme === 'CBD') {
    return { paymentTerm: 'CBD', paymentTermCustom: '' };
  }
  if (supplier.paymentScheme === 'COD') {
    return { paymentTerm: 'COD', paymentTermCustom: '' };
  }
  const days = Number(supplier.paymentTermDays);
  if (days === 0) return { paymentTerm: 'CBD', paymentTermCustom: '' };
  if (days === 14) return { paymentTerm: 'TOP 14 Hari Kalender', paymentTermCustom: '' };
  if (days === 30 || !Number.isFinite(days)) {
    return { paymentTerm: 'TOP 30 Hari Kalender', paymentTermCustom: '' };
  }
  if (days === 45) return { paymentTerm: 'TOP 45 Hari Kalender', paymentTermCustom: '' };
  return {
    paymentTerm: 'Custom',
    paymentTermCustom: `TOP ${Math.max(1, Math.round(days))} Hari Kalender`,
  };
}

export function mapCustomerToPaymentTerm(
  customer?: Pick<Customer, 'paymentScheme' | 'paymentTermDays'>
): { paymentTerm: PaymentTermOption; paymentTermCustom: string } {
  if (!customer) {
    return { paymentTerm: 'CBD', paymentTermCustom: '' };
  }
  if (customer.paymentScheme === 'CBD') {
    return { paymentTerm: 'CBD', paymentTermCustom: '' };
  }
  if (customer.paymentScheme === 'TOP 14 Hari') {
    return { paymentTerm: 'TOP 14 Hari Kalender', paymentTermCustom: '' };
  }
  if (customer.paymentScheme === 'TOP 30 Hari') {
    return { paymentTerm: 'TOP 30 Hari Kalender', paymentTermCustom: '' };
  }
  const days = Number(customer.paymentTermDays);
  if (days <= 0) return { paymentTerm: 'CBD', paymentTermCustom: '' };
  if (days === 14) return { paymentTerm: 'TOP 14 Hari Kalender', paymentTermCustom: '' };
  if (days === 30) return { paymentTerm: 'TOP 30 Hari Kalender', paymentTermCustom: '' };
  if (days === 45) return { paymentTerm: 'TOP 45 Hari Kalender', paymentTermCustom: '' };
  return {
    paymentTerm: 'Custom',
    paymentTermCustom: `TOP ${Math.round(days)} Hari Kalender`,
  };
}

export function getDefaultPoIncoterm(
  supplier?: Pick<Supplier, 'defaultCurrency'>
): IncotermOption {
  if (supplier?.defaultCurrency === 'USD') {
    return 'CIP';
  }
  return 'DDP - Franco Lokasi Pembeli';
}

export function getDefaultSalesIncoterm(): IncotermOption {
  return 'DDP - Franco Lokasi Pembeli';
}

export function getDefaultPoDeliveryLocation(
  incoterm: string,
  supplier?: Pick<Supplier, 'address' | 'name'>,
  warehouse?: Pick<Warehouse, 'address' | 'name'>,
  company?: Pick<CompanySettings, 'address'>
): string {
  if (incoterm.startsWith('EXW')) {
    return supplier?.address || supplier?.name || 'Gudang Penjual / Vendor';
  }
  return (
    warehouse?.address ||
    warehouse?.name ||
    company?.address ||
    'Gudang Penerima Pembeli'
  );
}

export function getDefaultSalesDeliveryLocation(
  incoterm: string,
  customer?: Pick<Customer, 'shippingAddress' | 'address' | 'name'>,
  warehouse?: Pick<Warehouse, 'address' | 'name'>
): string {
  if (incoterm.startsWith('EXW')) {
    return warehouse?.address || warehouse?.name || 'Gudang Penjual';
  }
  return (
    customer?.shippingAddress ||
    customer?.address ||
    customer?.name ||
    'Lokasi Pengiriman Pembeli'
  );
}

export function computeDueDateFromPaymentTerm(
  paymentTerm: string,
  paymentTermCustom?: string,
  baseDate: Date = new Date()
): string {
  let days = 0;
  if (paymentTerm === 'CBD' || paymentTerm === 'COD') {
    days = 0;
  } else if (paymentTerm === 'TOP 14 Hari Kalender') {
    days = 14;
  } else if (paymentTerm === 'TOP 30 Hari Kalender') {
    days = 30;
  } else if (paymentTerm === 'TOP 45 Hari Kalender') {
    days = 45;
  } else if (paymentTerm === 'Custom') {
    const match = (paymentTermCustom || '').match(/(\d+)/);
    days = match ? Math.min(365, Math.max(0, Number(match[1]))) : 30;
  }
  const target = new Date(baseDate.getTime() + days * 86_400_000);
  return target.toISOString().slice(0, 10);
}

export function computeValidityPeriodLabel(
  issueDateIso: string,
  validUntilIso: string
): string {
  const start = Date.parse(issueDateIso.slice(0, 10));
  const end = Date.parse(validUntilIso.slice(0, 10));
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return '14 Hari Kalender';
  }
  const diffDays = Math.round((end - start) / 86_400_000);
  if (diffDays <= 0) return '1 Hari Kalender';
  return `${diffDays} Hari Kalender`;
}

export function inheritTermsFromQuotation(
  qt: Pick<
    SalesQuotation,
    | 'quotationNumber'
    | 'paymentTerm'
    | 'paymentTermCustom'
    | 'incoterm'
    | 'deliveryLocation'
    | 'termsAndConditions'
    | 'notes'
  >,
  customer?: Pick<Customer, 'paymentScheme' | 'paymentTermDays' | 'shippingAddress' | 'address' | 'name'>,
  warehouse?: Pick<Warehouse, 'address' | 'name'>
): {
  paymentTerm: PaymentTermOption;
  paymentTermCustom: string;
  incoterm: string;
  deliveryLocation: string;
  termsAndConditions: string;
} {
  const mappedCustomerTerm = mapCustomerToPaymentTerm(customer);
  const paymentTermNormalized = qt.paymentTerm
    ? normalizePaymentTermSelection(qt.paymentTerm, mappedCustomerTerm.paymentTerm)
    : mappedCustomerTerm;

  const paymentTermCustom =
    paymentTermNormalized.paymentTerm === 'Custom'
      ? (qt.paymentTermCustom || paymentTermNormalized.paymentTermCustom || '').trim()
      : '';

  const incoterm = (qt.incoterm || getDefaultSalesIncoterm()).trim();
  const deliveryLocation = (
    qt.deliveryLocation || getDefaultSalesDeliveryLocation(incoterm, customer, warehouse)
  ).trim();

  const termsAndConditions = (
    qt.termsAndConditions || getDefaultSalesOrderTerms()
  ).trim();

  return {
    paymentTerm: paymentTermNormalized.paymentTerm,
    paymentTermCustom,
    incoterm,
    deliveryLocation,
    termsAndConditions,
  };
}

export function buildNextSequentialDocNumber(
  prefix: string,
  existingNumbers: Array<string | undefined>,
  minStart: number,
  padLen: number = 4
): string {
  let maxSeq = minStart - 1;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}(\\d+)$`, 'i');
  for (const num of existingNumbers) {
    if (!num) continue;
    const m = num.trim().match(pattern);
    if (m) {
      const seq = Number(m[1]);
      if (Number.isFinite(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }
  const next = Math.max(minStart, maxSeq + 1);
  return `${prefix}${String(next).padStart(padLen, '0')}`;
}

export interface OrderTermsSectionSummary {
  heading: string;
  metaRows: Array<{ label: string; value: string }>;
  mandatoryNotice?: string;
  termsText: string;
  additionalNotes?: string;
}

export function buildOrderTermsSummaryForPo(
  po: Pick<
    PurchaseOrder,
    | 'paymentTerm'
    | 'paymentTermCustom'
    | 'incoterm'
    | 'deliveryLocation'
    | 'termsAndConditions'
    | 'notes'
    | 'warehouseName'
    | 'warehouseId'
  >,
  supplier?: Pick<Supplier, 'paymentScheme' | 'paymentTermDays' | 'address' | 'name' | 'defaultCurrency'>,
  warehouse?: Pick<Warehouse, 'address' | 'name'>,
  company?: Pick<CompanySettings, 'address'>
): OrderTermsSectionSummary {
  const defaultTerm = mapSupplierToPaymentTerm(supplier);
  const paymentDisplay = po.paymentTerm
    ? resolvePaymentTermDisplay(po.paymentTerm, po.paymentTermCustom)
    : resolvePaymentTermDisplay(defaultTerm.paymentTerm, defaultTerm.paymentTermCustom);
  const incoterm = po.incoterm || getDefaultPoIncoterm(supplier);
  const deliveryLocation =
    po.deliveryLocation ||
    getDefaultPoDeliveryLocation(incoterm, supplier, warehouse, company) ||
    po.warehouseName ||
    '-';

  return {
    heading: 'Terms & Conditions',
    metaRows: [
      { label: 'Payment Term', value: paymentDisplay },
      { label: 'Incoterms', value: incoterm },
      { label: 'Lokasi Kirim', value: deliveryLocation },
    ],
    mandatoryNotice: MANDATORY_PO_ATTACHMENT_NOTE,
    termsText: (po.termsAndConditions || getDefaultPurchaseOrderTerms()).trim(),
    additionalNotes: po.notes?.trim() ? po.notes.trim() : undefined,
  };
}

export function buildOrderTermsSummaryForSo(
  so: Pick<
    SalesOrder,
    | 'paymentTerm'
    | 'paymentTermCustom'
    | 'incoterm'
    | 'deliveryLocation'
    | 'termsAndConditions'
    | 'notes'
    | 'quotationNumber'
  >,
  customer?: Pick<Customer, 'paymentScheme' | 'paymentTermDays' | 'shippingAddress' | 'address' | 'name'>,
  warehouse?: Pick<Warehouse, 'address' | 'name'>
): OrderTermsSectionSummary {
  const defaultTerm = mapCustomerToPaymentTerm(customer);
  const paymentDisplay = so.paymentTerm
    ? resolvePaymentTermDisplay(so.paymentTerm, so.paymentTermCustom)
    : resolvePaymentTermDisplay(defaultTerm.paymentTerm, defaultTerm.paymentTermCustom);
  const incoterm = so.incoterm || getDefaultSalesIncoterm();
  const deliveryLocation =
    so.deliveryLocation || getDefaultSalesDeliveryLocation(incoterm, customer, warehouse);

  const metaRows: Array<{ label: string; value: string }> = [
    { label: 'Payment Term', value: paymentDisplay },
    { label: 'Incoterms', value: incoterm },
    { label: 'Lokasi Kirim', value: deliveryLocation },
  ];
  if (so.quotationNumber) {
    metaRows.push({ label: 'Ref. Quotation', value: so.quotationNumber });
  }

  return {
    heading: 'Terms & Conditions',
    metaRows,
    termsText: (so.termsAndConditions || getDefaultSalesOrderTerms()).trim(),
    additionalNotes: so.notes?.trim() ? so.notes.trim() : undefined,
  };
}

export function buildOrderTermsSummaryForQuotation(
  qt: Pick<
    SalesQuotation,
    | 'paymentTerm'
    | 'paymentTermCustom'
    | 'incoterm'
    | 'deliveryLocation'
    | 'validityPeriod'
    | 'leadTime'
    | 'validUntil'
    | 'createdAt'
    | 'termsAndConditions'
    | 'notes'
  >,
  customer?: Pick<Customer, 'paymentScheme' | 'paymentTermDays' | 'shippingAddress' | 'address' | 'name'>,
  warehouse?: Pick<Warehouse, 'address' | 'name'>
): OrderTermsSectionSummary {
  const defaultTerm = mapCustomerToPaymentTerm(customer);
  const paymentDisplay = qt.paymentTerm
    ? resolvePaymentTermDisplay(qt.paymentTerm, qt.paymentTermCustom)
    : resolvePaymentTermDisplay(defaultTerm.paymentTerm, defaultTerm.paymentTermCustom);
  const incoterm = qt.incoterm || getDefaultSalesIncoterm();
  const deliveryLocation =
    qt.deliveryLocation || getDefaultSalesDeliveryLocation(incoterm, customer, warehouse);
  const validityPeriod =
    (qt.validityPeriod || '').trim() ||
    computeValidityPeriodLabel((qt.createdAt || new Date().toISOString()).slice(0, 10), qt.validUntil);
  const leadTime = (qt.leadTime || '').trim() || '3-5 Hari Kerja';

  return {
    heading: 'Terms & Conditions',
    metaRows: [
      { label: 'Payment Term', value: paymentDisplay },
      { label: 'Incoterms', value: incoterm },
      { label: 'Lokasi Kirim', value: deliveryLocation },
      { label: 'Validity Period', value: `${validityPeriod} (s/d ${qt.validUntil})` },
      { label: 'Lead Time', value: leadTime },
    ],
    termsText: (qt.termsAndConditions || getDefaultQuotationTerms()).trim(),
    additionalNotes: qt.notes?.trim() ? qt.notes.trim() : undefined,
  };
}

export function buildOrderTermsSummaryForRfq(
  rfq: Pick<VendorRfq, 'warehouseId' | 'warehouseName' | 'deadlineDate' | 'invitedSupplierIds' | 'notes'>,
  suppliers: Array<Pick<Supplier, 'id' | 'name'>> = [],
  warehouse?: Pick<Warehouse, 'address' | 'name'>
): OrderTermsSectionSummary {
  const invitedSuppliers = suppliers.filter((s) => rfq.invitedSupplierIds.includes(s.id));
  const invitedText =
    invitedSuppliers.length > 0
      ? invitedSuppliers.map((s) => s.name).join(', ')
      : rfq.invitedSupplierIds.length > 0
      ? `${rfq.invitedSupplierIds.length} Supplier Terundang`
      : 'Terbuka (Umum)';

  return {
    heading: 'Ketentuan Pengajuan Penawaran (RFQ)',
    metaRows: [
      { label: 'Gudang Tujuan', value: warehouse?.name || rfq.warehouseName || rfq.warehouseId },
      { label: 'Lokasi Gudang', value: warehouse?.address || '-' },
      { label: 'Batas Penawaran', value: rfq.deadlineDate },
      { label: 'Vendor Terundang', value: invitedText },
    ],
    termsText: getDefaultRfqTerms(),
    additionalNotes: rfq.notes?.trim() ? rfq.notes.trim() : undefined,
  };
}

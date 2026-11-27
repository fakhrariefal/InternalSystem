import { formatCurrency, getEffectiveTaxRatePercent, isCompanyPkp } from './erpLogic';
import type {
  AccountingInvoice,
  CompanySettings,
  Customer,
  InvoicePayment,
  PurchaseOrder,
  SalesOrder,
  SalesQuotation,
  StockMovement,
  Supplier,
  Warehouse,
} from './types';

export type PrintableDocumentType =
  | 'INVOICE'
  | 'QUOTATION'
  | 'PURCHASE_ORDER'
  | 'SALES_ORDER'
  | 'SURAT_JALAN'
  | 'KWITANSI'
  | 'REG_SUPPLIER'
  | 'REG_BUYER'
  | 'REPORT';

export interface PrintMetadataRow {
  label: string;
  value: string;
}

export interface PrintKvRow {
  label: string;
  value: string;
}

export interface PrintTotalRow {
  label: string;
  value: string;
  isGrandTotal?: boolean;
  tone?: 'default' | 'success' | 'accent';
}

export interface PrintSignatureSlot {
  roleLabel: string;
  signerName: string;
}

export interface PrintTableColumn {
  header: string;
  align?: 'left' | 'center' | 'right';
  widthClass?: string;
  bold?: boolean;
  mono?: boolean;
}

export interface PrintableDocumentData {
  docType: PrintableDocumentType;
  orientation?: 'portrait' | 'landscape';
  documentTitle: string;
  documentNumber: string;
  filenameBase: string;
  company: CompanySettings;
  leftMeta: PrintMetadataRow[];
  rightMeta: PrintMetadataRow[];
  columns: PrintTableColumn[];
  rows: string[][];
  notesTitle?: string;
  notesText?: string;
  statusBanner?: {
    tone: 'success' | 'info';
    title?: string;
    text: string;
  };
  bankInfo?: {
    heading: string;
    bankName: string;
    rows: PrintKvRow[];
  };
  totals?: PrintTotalRow[];
  signatures: PrintSignatureSlot[];
  qrVerification: {
    title: string;
    code: string;
    detailLine: string;
    payload: string;
  };
}

function terbilangIdLocal(n: number): string {
  const num = Math.round(Math.abs(n));
  if (num === 0) return 'Nol Rupiah';
  const satuan = [
    '',
    'Satu',
    'Dua',
    'Tiga',
    'Empat',
    'Lima',
    'Enam',
    'Tujuh',
    'Delapan',
    'Sembilan',
    'Sepuluh',
    'Sebelas',
  ];
  const convert = (val: number): string => {
    if (val < 12) return satuan[val];
    if (val < 20) return `${satuan[val - 10]} Belas`;
    if (val < 100) return `${satuan[Math.floor(val / 10)]} Puluh ${convert(val % 10)}`.trim();
    if (val < 200) return `Seratus ${convert(val - 100)}`.trim();
    if (val < 1000) return `${satuan[Math.floor(val / 100)]} Ratus ${convert(val % 100)}`.trim();
    if (val < 2000) return `Seribu ${convert(val - 1000)}`.trim();
    if (val < 1_000_000) return `${convert(Math.floor(val / 1000))} Ribu ${convert(val % 1000)}`.trim();
    if (val < 1_000_000_000)
      return `${convert(Math.floor(val / 1_000_000))} Juta ${convert(val % 1_000_000)}`.trim();
    if (val < 1_000_000_000_000)
      return `${convert(Math.floor(val / 1_000_000_000))} Miliar ${convert(val % 1_000_000_000)}`.trim();
    return `${convert(Math.floor(val / 1_000_000_000_000))} Triliun ${convert(val % 1_000_000_000_000)}`.trim();
  };
  return `${convert(num).replace(/\s+/g, ' ').trim()} Rupiah`;
}

export function buildPurchaseOrderPrintDoc(
  po: PurchaseOrder,
  company: CompanySettings,
  supplier?: Supplier
): PrintableDocumentData {
  return {
    docType: 'PURCHASE_ORDER',
    documentTitle: 'PURCHASE ORDER (PO)',
    documentNumber: po.poNumber,
    filenameBase: po.poNumber,
    company,
    leftMeta: [
      { label: 'Nomor PO', value: po.poNumber },
      {
        label: 'Status',
        value: `${po.status}${po.approvalTierRequired ? ` (${po.approvalTierRequired})` : ''}`,
      },
      { label: 'Supplier', value: supplier?.name || po.supplierName || po.supplierId },
      { label: 'Alamat Supplier', value: supplier?.address || '-' },
    ],
    rightMeta: [
      { label: 'Gudang Tujuan', value: po.warehouseName || po.warehouseId },
      { label: 'Tanggal PO', value: (po.createdAt || '').slice(0, 10) || '-' },
      { label: 'Target Kirim', value: po.expectedDate || '-' },
      { label: 'Mata Uang', value: po.currency },
    ],
    columns: [
      { header: 'No', align: 'center', widthClass: 'w-9' },
      { header: 'SKU', align: 'left', widthClass: 'w-24', mono: true },
      { header: 'Nama Barang', align: 'left' },
      { header: 'Satuan', align: 'center', widthClass: 'w-16' },
      { header: 'Qty', align: 'right', widthClass: 'w-14', mono: true },
      { header: 'Harga Satuan', align: 'right', widthClass: 'w-28', mono: true },
      { header: 'Total', align: 'right', widthClass: 'w-32', bold: true, mono: true },
    ],
    rows: po.items.map((item, idx) => [
      String(idx + 1),
      item.sku,
      item.productName,
      item.uomCode,
      String(item.qty),
      formatCurrency(item.unitPrice, po.currency),
      formatCurrency(item.lineTotal, po.currency),
    ]),
    notesTitle: po.notes ? 'Catatan Purchase Order' : undefined,
    notesText: po.notes || undefined,
    totals: [
      { label: 'Subtotal', value: formatCurrency(po.subtotal ?? po.totalAmount, po.currency) },
      { label: 'PPN', value: formatCurrency(po.taxAmount ?? 0, po.currency) },
      {
        label: 'Grand Total',
        value: formatCurrency(po.totalAmount, po.currency),
        isGrandTotal: true,
      },
    ],
    signatures: [
      { roleLabel: 'Dibuat Oleh,', signerName: po.createdByName || 'Purchasing' },
      {
        roleLabel: po.approvalTierRequired === 'Direktur' ? 'Disetujui Direktur,' : 'Disetujui Manager,',
        signerName: po.directorApprovedBy ? 'Direktur Utama' : 'Operasional / Manager',
      },
      { roleLabel: 'Konfirmasi Supplier,', signerName: supplier?.contactPerson || 'PIC Supplier' },
    ],
    qrVerification: {
      title: 'VERIFIKASI DIGITAL PURCHASE ORDER',
      code: po.poNumber,
      detailLine: `Supplier: ${supplier?.name || po.supplierName || '-'} | Status: ${po.status} | Total: ${formatCurrency(po.totalAmount, po.currency)}`,
      payload: `DHI-PO|${po.poNumber}|${po.supplierName || po.supplierId}|${po.totalAmount}|${po.status}`,
    },
  };
}

export function buildSalesQuotationPrintDoc(
  qt: SalesQuotation,
  company: CompanySettings,
  customer?: Customer,
  warehouse?: Warehouse
): PrintableDocumentData {
  return {
    docType: 'QUOTATION',
    documentTitle: 'PENAWARAN HARGA / SALES QUOTATION',
    documentNumber: qt.quotationNumber,
    filenameBase: qt.quotationNumber,
    company,
    leftMeta: [
      { label: 'No. Penawaran', value: qt.quotationNumber },
      { label: 'Status', value: qt.status },
      { label: 'Kepada Yth', value: customer?.name || qt.customerName || qt.customerId },
      { label: 'Alamat Customer', value: customer?.address || '-' },
    ],
    rightMeta: [
      { label: 'Gudang Asal', value: warehouse?.name || qt.warehouseName || qt.warehouseId },
      { label: 'Tanggal Terbit', value: (qt.createdAt || '').slice(0, 10) || '-' },
      { label: 'Berlaku Hingga', value: qt.validUntil },
      { label: 'Syarat Bayar', value: customer?.paymentScheme || 'CBD' },
    ],
    columns: [
      { header: 'No', align: 'center', widthClass: 'w-9' },
      { header: 'SKU', align: 'left', widthClass: 'w-24', mono: true },
      { header: 'Deskripsi Barang', align: 'left' },
      { header: 'Satuan', align: 'center', widthClass: 'w-16' },
      { header: 'Qty', align: 'right', widthClass: 'w-14', mono: true },
      { header: 'Harga Satuan', align: 'right', widthClass: 'w-28', mono: true },
      { header: 'Total', align: 'right', widthClass: 'w-32', bold: true, mono: true },
    ],
    rows: qt.items.map((item, idx) => [
      String(idx + 1),
      item.sku,
      item.productName,
      item.uomCode,
      String(item.qty),
      formatCurrency(item.unitPrice, qt.currency),
      formatCurrency(item.lineTotal, qt.currency),
    ]),
    notesTitle: qt.notes ? 'Catatan & Ketentuan' : undefined,
    notesText: qt.notes || undefined,
    totals: [
      { label: 'Subtotal (DPP)', value: formatCurrency(qt.subtotal, qt.currency) },
      {
        label: isCompanyPkp(company)
          ? `PPN ${getEffectiveTaxRatePercent(company)}%`
          : 'PPN (Non-PKP 0%)',
        value: formatCurrency(qt.taxAmount, qt.currency),
      },
      {
        label: 'Total Penawaran',
        value: formatCurrency(qt.totalAmount, qt.currency),
        isGrandTotal: true,
      },
    ],
    signatures: [
      { roleLabel: 'Hormat Kami,', signerName: qt.createdByName || 'Commercial B2B' },
      {
        roleLabel: 'Persetujuan Customer (PO / Stempel),',
        signerName: customer?.contactPerson || 'PIC Purchasing Customer',
      },
    ],
    qrVerification: {
      title: 'VERIFIKASI DIGITAL QUOTATION PENAWARAN',
      code: qt.quotationNumber,
      detailLine: `Customer: ${customer?.name || qt.customerName || '-'} | Berlaku s/d: ${qt.validUntil} | Total: ${formatCurrency(qt.totalAmount, qt.currency)}`,
      payload: `DHI-QT|${qt.quotationNumber}|${qt.customerName || qt.customerId}|${qt.totalAmount}|VALID:${qt.validUntil}`,
    },
  };
}

export function buildSalesInvoicePrintDoc(
  invoice: AccountingInvoice,
  company: CompanySettings,
  customer?: Customer,
  relatedSo?: SalesOrder,
  supplier?: Supplier
): PrintableDocumentData {
  const isAp = invoice.ledgerType === 'AP';
  const fpNumber = invoice.taxInvoiceNumber || relatedSo?.taxInvoiceNumber || '-';
  const items = relatedSo?.items || [];
  const companyIsPkp = isCompanyPkp(company);
  const ratePct = getEffectiveTaxRatePercent(company);
  const divisor = ratePct > 0 ? 1 + ratePct / 100 : 1;
  const dpp = relatedSo?.subtotal ?? Math.round(invoice.totalAmount / divisor);
  const ppn = relatedSo?.taxAmount ?? Math.round(invoice.totalAmount - dpp);

  return {
    docType: 'INVOICE',
    documentTitle: isAp
      ? 'DOKUMEN TAGIHAN SUPPLIER (AP INVOICE)'
      : 'INVOICE / FAKTUR PENJUALAN RESMI',
    documentNumber: invoice.invoiceNumber,
    filenameBase: invoice.invoiceNumber,
    company,
    leftMeta: isAp
      ? [
          { label: 'No. Invoice', value: invoice.invoiceNumber },
          { label: 'Jenis Ledger', value: 'Hutang Usaha (AP)' },
          { label: 'Supplier', value: supplier?.name || invoice.counterpartyName || invoice.counterpartyId },
          { label: 'NPWP Supplier', value: `${supplier?.npwp || '-'} (${supplier?.taxStatus || 'PKP'})` },
          { label: 'Alamat Supplier', value: supplier?.address || '-' },
        ]
      : [
          { label: 'No. Invoice', value: invoice.invoiceNumber },
          { label: 'No. Faktur Pajak', value: fpNumber },
          { label: 'Kepada Yth', value: customer?.name || invoice.counterpartyName || invoice.counterpartyId },
          { label: 'NPWP Buyer', value: `${customer?.npwp || '-'} (${customer?.taxStatus || 'PKP'})` },
          { label: 'Alamat Tagih', value: customer?.billingAddress || customer?.address || '-' },
        ],
    rightMeta: [
      { label: 'Ref. Order', value: invoice.referenceOrderNumber || '-' },
      { label: 'Tgl Terbit', value: invoice.issueDate || (invoice.createdAt || '').slice(0, 10) || '-' },
      { label: 'Jatuh Tempo', value: invoice.dueDate },
      { label: 'Status Tagihan', value: invoice.status },
      { label: 'Mata Uang', value: invoice.currency },
    ],
    columns: [
      { header: 'No', align: 'center', widthClass: 'w-9' },
      { header: 'SKU', align: 'left', widthClass: 'w-24', mono: true },
      { header: 'Deskripsi Barang / Jasa', align: 'left' },
      { header: 'Satuan', align: 'center', widthClass: 'w-16' },
      { header: 'Qty', align: 'right', widthClass: 'w-14', mono: true },
      { header: 'Harga Satuan', align: 'right', widthClass: 'w-28', mono: true },
      { header: 'Total', align: 'right', widthClass: 'w-32', bold: true, mono: true },
    ],
    rows:
      items.length > 0
        ? items.map((it, idx) => [
            String(idx + 1),
            it.sku,
            it.productName,
            it.uomCode,
            String(it.qty),
            formatCurrency(it.unitPrice, invoice.currency),
            formatCurrency(it.lineTotal, invoice.currency),
          ])
        : [
            [
              '1',
              invoice.referenceOrderNumber || '-',
              isAp
                ? `Tagihan Pengadaan Supplier (${invoice.invoiceNumber})`
                : `Tagihan Penjualan Barang Dagang (${invoice.invoiceNumber})`,
              'LOT',
              '1',
              formatCurrency(dpp, invoice.currency),
              formatCurrency(dpp, invoice.currency),
            ],
          ],
    bankInfo: {
      heading: isAp ? 'REKENING TUJUAN PEMBAYARAN SUPPLIER:' : 'REKENING PEMBAYARAN RESMI:',
      bankName: isAp
        ? supplier?.bankName || 'Sesuai Rekening Supplier Terdaftar'
        : company.bankName || 'Bank Mandiri Korporat',
      rows: isAp
        ? [
            { label: 'No. Rek', value: supplier?.bankAccount || '-' },
            { label: 'a/n', value: supplier?.name || invoice.counterpartyName || '-' },
          ]
        : [
            { label: 'No. Rek', value: company.bankAccountNumber || '-' },
            { label: 'a/n', value: company.bankAccountHolder || company.companyName },
          ],
    },
    totals: [
      { label: 'DPP', value: formatCurrency(dpp, invoice.currency) },
      {
        label: companyIsPkp ? `PPN (${ratePct}%)` : 'PPN (Non-PKP 0%)',
        value: formatCurrency(ppn, invoice.currency),
      },
      { label: 'Total Tagihan', value: formatCurrency(invoice.totalAmount, invoice.currency) },
      {
        label: 'Sudah Dibayar',
        value: formatCurrency(invoice.paidAmount, invoice.currency),
        tone: 'success',
      },
      {
        label: 'Sisa Tagihan',
        value: formatCurrency(invoice.balanceDue, invoice.currency),
        isGrandTotal: true,
        tone: 'accent',
      },
    ],
    signatures: [
      {
        roleLabel: isAp ? 'Bagian Keuangan / AP,' : 'Bagian Keuangan / AR,',
        signerName: company.companyName,
      },
    ],
    qrVerification: {
      title: isAp
        ? 'VERIFIKASI DIGITAL TAGIHAN SUPPLIER (AP)'
        : 'VERIFIKASI DIGITAL INVOICE / FAKTUR PENJUALAN',
      code: invoice.invoiceNumber,
      detailLine: `${isAp ? 'Ref PO' : 'No. Faktur Pajak'}: ${isAp ? invoice.referenceOrderNumber || '-' : fpNumber} | Partner: ${(isAp ? supplier?.name : customer?.name) || invoice.counterpartyName || '-'} | Sisa: ${formatCurrency(invoice.balanceDue, invoice.currency)}`,
      payload: `DHI-INV|${invoice.invoiceNumber}|FP:${fpNumber}|${invoice.totalAmount}|${invoice.status}`,
    },
  };
}

export function buildSalesOrderPrintDoc(
  so: SalesOrder,
  company: CompanySettings,
  customer?: Customer,
  warehouse?: Warehouse
): PrintableDocumentData {
  return {
    docType: 'SALES_ORDER',
    documentTitle: 'SALES ORDER (SO)',
    documentNumber: so.soNumber,
    filenameBase: so.soNumber,
    company,
    leftMeta: [
      { label: 'Nomor SO', value: so.soNumber },
      { label: 'Status', value: so.status },
      { label: 'Customer', value: customer?.name || so.customerName || so.customerId },
      { label: 'Alamat Kirim', value: customer?.shippingAddress || customer?.address || '-' },
    ],
    rightMeta: [
      { label: 'Gudang Asal', value: warehouse?.name || so.warehouseName || so.warehouseId },
      { label: 'Tanggal SO', value: (so.createdAt || '').slice(0, 10) || '-' },
      { label: 'Jatuh Tempo', value: so.dueDate || '-' },
      { label: 'Ref. Invoice', value: so.invoiceNumber || '-' },
    ],
    columns: [
      { header: 'No', align: 'center', widthClass: 'w-9' },
      { header: 'SKU', align: 'left', widthClass: 'w-24', mono: true },
      { header: 'Nama Barang', align: 'left' },
      { header: 'Satuan', align: 'center', widthClass: 'w-16' },
      { header: 'Order', align: 'right', widthClass: 'w-14', mono: true },
      { header: 'Terkirim', align: 'right', widthClass: 'w-16', mono: true },
      { header: 'Harga Satuan', align: 'right', widthClass: 'w-28', mono: true },
      { header: 'Total', align: 'right', widthClass: 'w-32', bold: true, mono: true },
    ],
    rows: so.items.map((item, idx) => [
      String(idx + 1),
      item.sku,
      item.productName,
      item.uomCode,
      String(item.qty),
      String(item.fulfilledQty),
      formatCurrency(item.unitPrice, so.currency),
      formatCurrency(item.lineTotal, so.currency),
    ]),
    notesTitle: so.notes ? 'Catatan Sales Order' : undefined,
    notesText: so.notes || undefined,
    totals: [
      { label: 'Subtotal', value: formatCurrency(so.subtotal ?? so.totalAmount, so.currency) },
      { label: 'PPN', value: formatCurrency(so.taxAmount ?? 0, so.currency) },
      {
        label: 'Grand Total',
        value: formatCurrency(so.totalAmount, so.currency),
        isGrandTotal: true,
      },
    ],
    signatures: [
      { roleLabel: 'Sales Representative,', signerName: so.createdByName || 'Sales Team' },
      { roleLabel: 'Disetujui Manager,', signerName: 'Operasional / Gudang' },
      { roleLabel: 'Konfirmasi Customer,', signerName: customer?.contactPerson || 'PIC Customer' },
    ],
    qrVerification: {
      title: 'VERIFIKASI DIGITAL SALES ORDER',
      code: so.soNumber,
      detailLine: `Customer: ${customer?.name || so.customerName || '-'} | Status: ${so.status} | Total: ${formatCurrency(so.totalAmount, so.currency)}`,
      payload: `DHI-SO|${so.soNumber}|${so.customerName || so.customerId}|${so.totalAmount}|${so.status}`,
    },
  };
}

export function buildSuratJalanPrintDoc(
  so: SalesOrder,
  company: CompanySettings,
  customer?: Customer,
  warehouse?: Warehouse,
  movement?: StockMovement
): PrintableDocumentData {
  const sjNumber = movement
    ? `SJ-${movement.movementNumber}`
    : `SJ-${so.soNumber.replace(/^SO-/, '')}`;
  const fieldPicName = customer?.picWarehouseName || customer?.contactPerson || '-';
  const fieldPicPhone = customer?.picWarehousePhone || customer?.phone || '-';

  const lineItems = movement
    ? [
        {
          sku: movement.productSku || '-',
          name: movement.productName || '-',
          uom: so.items.find((i) => i.productId === movement.productId)?.uomCode || 'Unit',
          orderQty:
            so.items.find((i) => i.productId === movement.productId)?.qty ??
            Math.abs(movement.quantityDelta),
          shippedQty: Math.abs(movement.quantityDelta),
          note: movement.notes || 'Sesuai dokumen pengiriman',
        },
      ]
    : so.items.map((it) => ({
        sku: it.sku,
        name: it.productName,
        uom: it.uomCode,
        orderQty: it.qty,
        shippedQty: it.fulfilledQty > 0 ? it.fulfilledQty : it.qty,
        note:
          it.fulfilledQty > 0
            ? it.fulfilledQty >= it.qty
              ? 'Lengkap / Baik'
              : `Parsial (Sisa ${it.qty - it.fulfilledQty})`
            : 'Rencana Kirim (Draft)',
      }));

  return {
    docType: 'SURAT_JALAN',
    documentTitle: 'SURAT JALAN / DELIVERY ORDER',
    documentNumber: sjNumber,
    filenameBase: sjNumber,
    company,
    leftMeta: [
      { label: 'No. Surat Jalan', value: sjNumber },
      { label: 'Referensi SO', value: so.soNumber },
      {
        label: 'Tanggal Kirim',
        value: (movement?.createdAt || so.updatedAt || so.createdAt || '').slice(0, 10) || '-',
      },
      { label: 'Gudang Asal', value: warehouse?.name || so.warehouseName || so.warehouseId },
      { label: 'Alamat Gudang', value: warehouse?.address || '-' },
    ],
    rightMeta: [
      { label: 'Kepada Yth', value: customer?.name || so.customerName || so.customerId },
      {
        label: 'Alamat Kirim',
        value: customer?.shippingAddress || customer?.address || 'Alamat Kirim Customer B2B',
      },
      { label: 'PIC Penerima', value: `${fieldPicName} (${fieldPicPhone})` },
      { label: 'Ref. Invoice', value: so.invoiceNumber || '-' },
    ],
    columns: [
      { header: 'No', align: 'center', widthClass: 'w-9' },
      { header: 'SKU', align: 'left', widthClass: 'w-24', mono: true },
      { header: 'Nama Barang', align: 'left' },
      { header: 'Satuan', align: 'center', widthClass: 'w-16' },
      { header: 'Qty Order', align: 'right', widthClass: 'w-16', mono: true },
      { header: 'Qty Dikirim', align: 'right', widthClass: 'w-20', bold: true, mono: true },
      { header: 'Keterangan', align: 'left' },
    ],
    rows: lineItems.map((row, idx) => [
      String(idx + 1),
      row.sku,
      row.name,
      row.uom,
      String(row.orderQty),
      String(row.shippedQty),
      row.note,
    ]),
    notesTitle: 'Catatan Pengiriman',
    notesText:
      movement?.notes || so.notes || 'Harap periksa kondisi & jumlah barang saat diterima.',
    statusBanner: so.podReceiverName
      ? {
          tone: 'success',
          title: 'e-POD TERVERIFIKASI',
          text: `Penerima: ${so.podReceiverName} (${(so.podTimestamp || '').slice(0, 16).replace('T', ' ')})`,
        }
      : undefined,
    signatures: [
      { roleLabel: 'Disiapkan Oleh (Gudang),', signerName: warehouse?.picName || 'Kepala Gudang' },
      { roleLabel: 'Pengemudi / Ekspedisi,', signerName: 'Nama & No. Polisi' },
      {
        roleLabel: 'Diterima Baik Oleh,',
        signerName: so.podReceiverName || 'Nama Terang & Stempel',
      },
    ],
    qrVerification: {
      title: 'VERIFIKASI DIGITAL SURAT JALAN (DO)',
      code: sjNumber,
      detailLine: `Ref. SO: ${so.soNumber} | Penerima: ${customer?.name || so.customerName || '-'} | e-POD: ${so.podReceiverName || 'Menunggu Serah Terima'}`,
      payload: `DHI-SJ|${sjNumber}|${so.soNumber}|${customer?.name || so.customerId}|POD:${so.podReceiverName || 'PENDING'}`,
    },
  };
}

export function buildPaymentReceiptPrintDoc(
  invoice: AccountingInvoice,
  payment: InvoicePayment,
  company: CompanySettings
): PrintableDocumentData {
  const kwNumber = `KWT-${payment.id.toUpperCase()}`;
  const amountIdr =
    payment.currency === 'USD'
      ? Math.round(payment.amount * (payment.exchangeRate || invoice.exchangeRate || 16200))
      : Math.round(payment.amount);

  return {
    docType: 'KWITANSI',
    documentTitle: 'KWITANSI PEMBAYARAN RESMI / OFFICIAL RECEIPT',
    documentNumber: kwNumber,
    filenameBase: kwNumber,
    company,
    leftMeta: [
      { label: 'No. Kwitansi', value: kwNumber },
      { label: 'No. Invoice', value: `${invoice.invoiceNumber} (${invoice.ledgerType})` },
      { label: 'Order Referensi', value: invoice.referenceOrderNumber || '-' },
    ],
    rightMeta: [
      { label: 'Tanggal Bayar', value: (payment.paidAt || '').slice(0, 10) || '-' },
      { label: 'Metode Pembayaran', value: payment.paymentMethod },
      { label: 'Status Invoice', value: invoice.status },
    ],
    columns: [
      { header: 'Keterangan Dokumen', align: 'left', widthClass: 'w-56', bold: true },
      { header: 'Detail Pembayaran', align: 'left' },
    ],
    rows: [
      [
        invoice.ledgerType === 'AR' ? 'Sudah Terima Dari' : 'Dibayarkan Kepada',
        invoice.counterpartyName || invoice.counterpartyId,
      ],
      ['Nomor Referensi Transfer / Giro', payment.referenceNo || '-'],
      ['Nominal Pembayaran', formatCurrency(payment.amount, payment.currency)],
      ['Terbilang (IDR Ekuivalen)', terbilangIdLocal(amountIdr)],
      ['Catatan Transaksi', payment.notes || 'Pembayaran tercatat sah pada sistem akuntansi ERP.'],
    ],
    statusBanner: {
      tone: 'info',
      title: 'SALDO TAGIHAN',
      text: `Sisa Saldo Invoice Setelah Transaksi Ini: ${formatCurrency(invoice.balanceDue, invoice.currency)} (${invoice.status})`,
    },
    signatures: [
      { roleLabel: 'Dicatat Oleh (Finance),', signerName: payment.recordedByName || 'Finance Team' },
    ],
    qrVerification: {
      title: 'VERIFIKASI DIGITAL KWITANSI PEMBAYARAN',
      code: kwNumber,
      detailLine: `Invoice: ${invoice.invoiceNumber} | Nominal: ${formatCurrency(payment.amount, payment.currency)} | Ref: ${payment.referenceNo || '-'}`,
      payload: `DHI-KWT|${kwNumber}|${invoice.invoiceNumber}|${payment.amount}|${payment.referenceNo || '-'}`,
    },
  };
}

export function formatPartnerRegistrationNumber(
  code: string | undefined,
  fallbackId: string,
  registeredAt?: string
): string {
  const yearMatch = (registeredAt || '').match(/^(\d{4})/);
  const year = yearMatch ? yearMatch[1] : String(new Date().getFullYear());
  const raw = (code || fallbackId || '001').trim().toUpperCase();
  const withoutPrefix = raw
    .replace(/^(?:REG|SUP|CUST|CUS|BUY|VND)[-_]+/gi, '')
    .replace(/^\d{4}[-_]+/, '');
  const base = withoutPrefix || raw;
  const suffix = /^\d+$/.test(base) ? base.padStart(3, '0') : base;
  return `REG-${year}-${suffix}`;
}

export function buildSupplierRegistrationPrintDoc(
  supplier: Supplier,
  company: CompanySettings
): PrintableDocumentData {
  const regCode = formatPartnerRegistrationNumber(
    supplier.code,
    supplier.id,
    supplier.createdAt || supplier.verifiedAt || supplier.updatedAt
  );
  const verifiedDate =
    (supplier.verifiedAt || supplier.updatedAt || supplier.createdAt || '').slice(0, 10) || '-';

  return {
    docType: 'REG_SUPPLIER',
    documentTitle: 'BUKTI REGISTRASI VENDOR / SUPPLIER RESMI',
    documentNumber: regCode,
    filenameBase: `Bukti_Registrasi_Supplier_${supplier.code || supplier.id}`,
    company,
    leftMeta: [
      { label: 'No. Registrasi', value: regCode },
      { label: 'Kode Supplier', value: supplier.code },
      { label: 'Status Registrasi', value: `${supplier.verificationStatus || 'Verified'} (Disetujui Direktur)` },
      { label: 'Tanggal Approve', value: verifiedDate },
    ],
    rightMeta: [
      { label: 'Kategori Vendor', value: supplier.vendorCategory || '-' },
      { label: 'Skema Pembayaran', value: `${supplier.paymentScheme || '-'} (${supplier.paymentTermDays} Hari)` },
      { label: 'Mata Uang Default', value: supplier.defaultCurrency },
      { label: 'Status Aktif', value: supplier.active ? 'Aktif Bekerjasama' : 'Non-Aktif' },
    ],
    columns: [
      { header: 'Atribut Data Partner', align: 'left', widthClass: 'w-56', bold: true },
      { header: 'Informasi Terverifikasi Sistem ERP', align: 'left' },
    ],
    rows: [
      ['Nama Perusahaan / Vendor', supplier.name],
      ['Nomor Induk Berusaha (NIB)', supplier.nib || '-'],
      ['NPWP & Status Pajak', `${supplier.npwp || '-'} (${supplier.taxStatus || 'PKP'})`],
      ['Alamat Operasional / Kantor', supplier.address || '-'],
      ['Kontak Person (PIC)', supplier.contactPerson || '-'],
      ['No. Telepon / WhatsApp', supplier.phone || '-'],
      ['Email Bisnis Resmi', supplier.email || '-'],
      ['Rekening Pembayaran Bank', `${supplier.bankName || '-'} — ${supplier.bankAccount || '-'}`],
    ],
    statusBanner: {
      tone: 'success',
      title: 'PERNYATAAN REGISTRASI SAH:',
      text: `Partner di atas telah resmi disetujui & terdaftar sebagai Vendor/Supplier aktif pada ${company.companyName || 'PT Domestiq Hub Indonesia'}.`,
    },
    signatures: [
      { roleLabel: 'Mengetahui (Vendor),', signerName: supplier.contactPerson || supplier.name },
      { roleLabel: 'Disahkan Oleh (Direktur / Admin),', signerName: company.companyName || 'Direktur Utama' },
    ],
    qrVerification: {
      title: 'VERIFIKASI DIGITAL BUKTI REGISTRASI SUPPLIER',
      code: regCode,
      detailLine: `Vendor: ${supplier.name} (${supplier.code}) | NIB: ${supplier.nib || '-'} | Status: ${supplier.verificationStatus || 'Verified'}`,
      payload: `DHI-REG-SUP|${regCode}|${supplier.name}|NIB:${supplier.nib || '-'}|NPWP:${supplier.npwp || '-'}|${verifiedDate}`,
    },
  };
}

export function buildBuyerRegistrationPrintDoc(
  customer: Customer,
  company: CompanySettings
): PrintableDocumentData {
  const regCode = formatPartnerRegistrationNumber(
    customer.code,
    customer.id,
    customer.createdAt || customer.verifiedAt || customer.updatedAt
  );
  const verifiedDate =
    (customer.verifiedAt || customer.updatedAt || customer.createdAt || '').slice(0, 10) || '-';

  return {
    docType: 'REG_BUYER',
    documentTitle: 'BUKTI REGISTRASI BUYER / CUSTOMER B2B RESMI',
    documentNumber: regCode,
    filenameBase: `Bukti_Registrasi_Buyer_${customer.code || customer.id}`,
    company,
    leftMeta: [
      { label: 'No. Registrasi', value: regCode },
      { label: 'Kode Buyer', value: customer.code },
      { label: 'Status Registrasi', value: `${customer.verificationStatus || 'Verified'} (Disetujui Direktur)` },
      { label: 'Tanggal Approve', value: verifiedDate },
    ],
    rightMeta: [
      { label: 'Skema Pembayaran', value: `${customer.paymentScheme || 'CBD'} (${customer.paymentTermDays || 0} Hari)` },
      { label: 'Limit Kredit Disetujui', value: formatCurrency(customer.creditLimit || 0, 'IDR') },
      { label: 'Status Pajak', value: customer.taxStatus || 'PKP' },
      { label: 'Status Aktif', value: customer.active ? 'Aktif Bertransaksi' : 'Non-Aktif' },
    ],
    columns: [
      { header: 'Atribut Profil Buyer B2B', align: 'left', widthClass: 'w-56', bold: true },
      { header: 'Informasi Terverifikasi Sistem ERP', align: 'left' },
    ],
    rows: [
      ['Nama Perusahaan Buyer', customer.name],
      ['Nomor Induk Berusaha (NIB)', customer.nib || '-'],
      ['Nomor Pokok Wajib Pajak (NPWP)', customer.npwp || '-'],
      ['Alamat Penagihan (Billing)', customer.billingAddress || customer.address || '-'],
      ['Alamat Pengiriman (Shipping)', customer.shippingAddress || customer.address || '-'],
      [
        'PIC Purchasing',
        `${customer.picPurchasingName || customer.contactPerson || '-'} (${customer.picPurchasingPhone || customer.phone || '-'})`,
      ],
      ['PIC Gudang / Penerima', `${customer.picWarehouseName || '-'} (${customer.picWarehousePhone || '-'})`],
      ['PIC Finance / AP', `${customer.picFinanceName || '-'} (${customer.picFinancePhone || '-'})`],
      ['Email Korespondensi', customer.email || '-'],
    ],
    statusBanner: {
      tone: 'success',
      title: 'PERNYATAAN REGISTRASI SAH:',
      text: `Buyer di atas telah disetujui dan berhak melakukan transaksi B2B sesuai limit kredit pada ${company.companyName || 'PT Domestiq Hub Indonesia'}.`,
    },
    signatures: [
      {
        roleLabel: 'Perwakilan Buyer,',
        signerName: customer.picPurchasingName || customer.contactPerson || customer.name,
      },
      { roleLabel: 'Disahkan Oleh (Direktur / Admin),', signerName: company.companyName || 'Direktur Utama' },
    ],
    qrVerification: {
      title: 'VERIFIKASI DIGITAL BUKTI REGISTRASI BUYER B2B',
      code: regCode,
      detailLine: `Buyer: ${customer.name} (${customer.code}) | Limit: ${formatCurrency(customer.creditLimit || 0, 'IDR')} | Skema: ${customer.paymentScheme || 'CBD'}`,
      payload: `DHI-REG-BUY|${regCode}|${customer.name}|NIB:${customer.nib || '-'}|LIMIT:${customer.creditLimit || 0}|${verifiedDate}`,
    },
  };
}

export interface TableReportPrintInput {
  documentTitle: string;
  documentNumber: string;
  filenameBase: string;
  subtitle?: string;
  company: CompanySettings;
  leftMeta?: PrintMetadataRow[];
  rightMeta?: PrintMetadataRow[];
  columns: PrintTableColumn[];
  rows: string[][];
  totals?: PrintTotalRow[];
  notesTitle?: string;
  notesText?: string;
  orientation?: 'portrait' | 'landscape';
  signerLabel?: string;
  signerName?: string;
}

export function buildTableReportPrintDoc(input: TableReportPrintInput): PrintableDocumentData {
  const today = new Date().toISOString().slice(0, 10);
  const orientation =
    input.orientation || (input.columns.length >= 6 ? 'landscape' : 'portrait');

  return {
    docType: 'REPORT',
    orientation,
    documentTitle: input.documentTitle,
    documentNumber: input.documentNumber,
    filenameBase: input.filenameBase,
    company: input.company,
    leftMeta: input.leftMeta || [
      { label: 'Jenis Laporan', value: input.documentTitle },
      { label: 'Tanggal Cetak', value: today },
      { label: 'Total Baris', value: `${input.rows.length} baris` },
    ],
    rightMeta: input.rightMeta || [
      { label: 'Ringkasan', value: input.subtitle || 'Laporan Resmi ERP' },
      { label: 'Perusahaan', value: input.company.companyName || 'PT Domestiq Hub Indonesia' },
      { label: 'NPWP', value: input.company.npwp || '-' },
    ],
    columns: input.columns,
    rows: input.rows.length > 0 ? input.rows : [input.columns.map((_, i) => (i === 0 ? 'Tidak ada data pada periode/filter ini.' : '-'))],
    notesTitle: input.notesTitle,
    notesText: input.notesText,
    totals: input.totals,
    signatures: [
      {
        roleLabel: input.signerLabel || 'Disusun / Diverifikasi Oleh,',
        signerName: input.signerName || input.company.companyName || 'Finance & Management',
      },
    ],
    qrVerification: {
      title: 'VERIFIKASI DIGITAL LAPORAN RESMI ERP',
      code: input.documentNumber,
      detailLine: `${input.documentTitle} | ${input.subtitle || today} | ${input.rows.length} baris`,
      payload: `DHI-RPT|${input.documentNumber}|${input.documentTitle}|${today}|ROWS:${input.rows.length}`,
    },
  };
}

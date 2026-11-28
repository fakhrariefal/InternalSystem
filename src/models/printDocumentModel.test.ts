import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBuyerRegistrationPrintDoc,
  buildPaymentReceiptPrintDoc,
  buildPurchaseOrderPrintDoc,
  buildSalesInvoicePrintDoc,
  buildSalesOrderPrintDoc,
  buildSalesQuotationPrintDoc,
  buildSupplierRegistrationPrintDoc,
  buildSuratJalanPrintDoc,
  formatPartnerRegistrationNumber,
} from './printDocumentModel';
import { createInitialSeedState } from './seedData';

test('Unified print model generates aligned metadata, totals, full notes, and bottom QR payloads for Invoices, Quotations, and POs', () => {
  const seed = createInitialSeedState();
  const po = seed.purchaseOrders[0];
  const qt = seed.salesQuotations[0];
  const arInv = seed.invoices.find((i) => i.ledgerType === 'AR');
  const apInv = seed.invoices.find((i) => i.ledgerType === 'AP');
  assert.ok(po && qt && arInv && apInv);

  const poSupplier = seed.suppliers.find((s) => s.id === po.supplierId);
  const poWh = seed.warehouses.find((w) => w.id === po.warehouseId);
  const poDoc = buildPurchaseOrderPrintDoc(po, seed.settings, poSupplier, poWh);
  assert.equal(poDoc.docType, 'PURCHASE_ORDER');
  assert.equal(poDoc.documentNumber, po.poNumber);
  assert.equal(poDoc.leftMeta.length, 4);
  assert.equal(poDoc.rightMeta.length, 4);
  assert.equal(poDoc.totals?.length, 3);
  assert.ok(poDoc.termsSection);
  assert.ok(poDoc.termsSection.mandatoryNotice?.includes('Nomor PO'));
  assert.ok(poDoc.termsSection.mandatoryNotice?.includes('Surat Jalan/BAST'));
  assert.ok(poDoc.termsSection.mandatoryNotice?.includes('Invoice'));
  assert.equal(poDoc.qrVerification.code, po.poNumber);
  assert.ok(poDoc.qrVerification.payload.startsWith('DHI-PO|'));

  const qtCustomer = seed.customers.find((c) => c.id === qt.customerId);
  const qtWh = seed.warehouses.find((w) => w.id === qt.warehouseId);
  const qtLongNotes = {
    ...qt,
    paymentTerm: 'Custom' as const,
    paymentTermCustom: 'DP 40% + TOP 21 Hari Kalender',
    validityPeriod: '21 Hari Kalender',
    leadTime: '4-6 Hari Kerja',
    notes: 'Baris 1\nBaris 2\nBaris 3\nBaris 4\nBaris 5 Syarat Pengiriman Lengkap',
  };
  const qtDoc = buildSalesQuotationPrintDoc(qtLongNotes, seed.settings, qtCustomer, qtWh);
  assert.equal(qtDoc.docType, 'QUOTATION');
  assert.equal(qtDoc.rightMeta[3]?.value, 'DP 40% + TOP 21 Hari Kalender');
  assert.equal(qtDoc.totals?.[2]?.label, 'Total Penawaran');
  assert.equal(qtDoc.totals?.[2]?.isGrandTotal, true);
  assert.ok(qtDoc.termsSection);
  assert.ok(qtDoc.termsSection.metaRows.some((r) => r.label === 'Validity Period' && r.value.includes('21 Hari Kalender')));
  assert.ok(qtDoc.termsSection.metaRows.some((r) => r.label === 'Lead Time' && r.value === '4-6 Hari Kerja'));
  assert.ok(qtDoc.termsSection.additionalNotes?.includes('Baris 5 Syarat Pengiriman Lengkap'));
  assert.equal(qtDoc.qrVerification.code, qt.quotationNumber);

  const invCustomer = seed.customers.find((c) => c.id === arInv.counterpartyId);
  const invSo = seed.salesOrders.find((s) => s.soNumber === arInv.referenceOrderNumber);
  const arDoc = buildSalesInvoicePrintDoc(arInv, seed.settings, invCustomer, invSo);
  assert.equal(arDoc.docType, 'INVOICE');
  assert.ok(arDoc.bankInfo);
  assert.equal(arDoc.bankInfo.rows.length, 2);
  assert.equal(arDoc.totals?.length, 5);
  assert.equal(arDoc.qrVerification.code, arInv.invoiceNumber);

  const apSupplier = seed.suppliers.find((s) => s.id === apInv.counterpartyId);
  const apDoc = buildSalesInvoicePrintDoc(apInv, seed.settings, undefined, undefined, apSupplier);
  assert.equal(apDoc.docType, 'INVOICE');
  assert.ok(apDoc.documentTitle.includes('AP INVOICE'));
  assert.equal(apDoc.qrVerification.code, apInv.invoiceNumber);
});

test('Unified print model generates SO, Surat Jalan, Kwitansi, and Verified Partner Registration documents cleanly', () => {
  const seed = createInitialSeedState();
  const so = seed.salesOrders[0];
  const customer = seed.customers.find((c) => c.id === so.customerId);
  const wh = seed.warehouses.find((w) => w.id === so.warehouseId);
  const supplier = seed.suppliers[1] || seed.suppliers[0];
  const paidInv = seed.invoices.find((i) => (i.payments || []).length > 0);
  const firstPayment = paidInv?.payments?.[0];
  assert.ok(so && customer && wh && supplier && paidInv && firstPayment);

  const soDoc = buildSalesOrderPrintDoc(so, seed.settings, customer, wh);
  assert.equal(soDoc.docType, 'SALES_ORDER');
  assert.equal(soDoc.rows.length, so.items.length);
  assert.ok(soDoc.termsSection);
  assert.ok(soDoc.termsSection.metaRows.some((r) => r.label === 'Payment Term'));
  assert.ok(soDoc.termsSection.metaRows.some((r) => r.label === 'Incoterms'));

  const sjDoc = buildSuratJalanPrintDoc(so, seed.settings, customer, wh);
  assert.equal(sjDoc.docType, 'SURAT_JALAN');
  assert.ok(sjDoc.documentNumber.startsWith('SJ-'));

  const kwtDoc = buildPaymentReceiptPrintDoc(paidInv, firstPayment, seed.settings);
  assert.equal(kwtDoc.docType, 'KWITANSI');
  assert.ok(kwtDoc.statusBanner);

  const supReg = buildSupplierRegistrationPrintDoc(
    { ...supplier, code: 'SUP-002', createdAt: '2026-11-27T08:00:00Z' },
    seed.settings
  );
  assert.equal(supReg.docType, 'REG_SUPPLIER');
  assert.equal(supReg.documentNumber, 'REG-2026-002');
  assert.equal(supReg.leftMeta[0]?.value, 'REG-2026-002');
  assert.equal(supReg.qrVerification.code, 'REG-2026-002');
  assert.ok(supReg.qrVerification.payload.startsWith('DHI-REG-SUP|REG-2026-002|'));

  const buyReg = buildBuyerRegistrationPrintDoc(
    { ...customer, code: 'CUST-004', createdAt: '2026-11-27T08:00:00Z' },
    seed.settings
  );
  assert.equal(buyReg.docType, 'REG_BUYER');
  assert.equal(buyReg.documentNumber, 'REG-2026-004');
  assert.ok(buyReg.qrVerification.payload.startsWith('DHI-REG-BUY|REG-2026-004|'));

  assert.equal(formatPartnerRegistrationNumber('SUP-2026-009', 'sup-9', '2026-05-10'), 'REG-2026-009');
  assert.equal(formatPartnerRegistrationNumber('CUS-001', 'cust-1', '2026-05-02'), 'REG-2026-001');
  assert.equal(formatPartnerRegistrationNumber(undefined, 'sup-2', '2026-05-10'), 'REG-2026-002');
});

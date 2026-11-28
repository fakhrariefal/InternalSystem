import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNextSequentialDocNumber,
  buildOrderTermsSummaryForPo,
  buildOrderTermsSummaryForQuotation,
  buildOrderTermsSummaryForRfq,
  buildOrderTermsSummaryForSo,
  computeDueDateFromPaymentTerm,
  computeValidityPeriodLabel,
  ensureMandatoryPoTermsNote,
  getDefaultPoDeliveryLocation,
  getDefaultPoIncoterm,
  getDefaultPurchaseOrderTerms,
  getDefaultQuotationOpeningText,
  getDefaultQuotationTerms,
  getDefaultRfqOpeningText,
  getDefaultRfqTerms,
  getDefaultSalesDeliveryLocation,
  getDefaultSalesOrderTerms,
  INCOTERM_OPTIONS,
  inheritTermsFromQuotation,
  MANDATORY_PO_ATTACHMENT_NOTE,
  mapCustomerToPaymentTerm,
  mapSupplierToPaymentTerm,
  PAYMENT_TERM_OPTIONS,
  resolvePaymentTermDisplay,
} from './orderTerms';

test('Required dropdown option sets match specification exactly', () => {
  assert.deepEqual([...PAYMENT_TERM_OPTIONS], [
    'CBD',
    'COD',
    'TOP 14 Hari Kalender',
    'TOP 30 Hari Kalender',
    'TOP 45 Hari Kalender',
    'Custom',
  ]);
  assert.deepEqual([...INCOTERM_OPTIONS], [
    'DDP - Franco Lokasi Pembeli',
    'EXW - Loco Gudang Penjual',
    'DAP',
    'CIP',
  ]);
});

test('Vendor Master Data maps Payment Term, Incoterms, and delivery location accurately', () => {
  assert.deepEqual(mapSupplierToPaymentTerm({ paymentScheme: 'CBD', paymentTermDays: 0 }), {
    paymentTerm: 'CBD',
    paymentTermCustom: '',
  });
  assert.deepEqual(mapSupplierToPaymentTerm({ paymentScheme: 'COD', paymentTermDays: 0 }), {
    paymentTerm: 'COD',
    paymentTermCustom: '',
  });
  assert.deepEqual(mapSupplierToPaymentTerm({ paymentScheme: 'TOP', paymentTermDays: 14 }), {
    paymentTerm: 'TOP 14 Hari Kalender',
    paymentTermCustom: '',
  });
  assert.deepEqual(mapSupplierToPaymentTerm({ paymentScheme: 'TOP', paymentTermDays: 30 }), {
    paymentTerm: 'TOP 30 Hari Kalender',
    paymentTermCustom: '',
  });
  assert.deepEqual(mapSupplierToPaymentTerm({ paymentScheme: 'TOP', paymentTermDays: 60 }), {
    paymentTerm: 'Custom',
    paymentTermCustom: 'TOP 60 Hari Kalender',
  });
  assert.equal(getDefaultPoIncoterm({ defaultCurrency: 'IDR' }), 'DDP - Franco Lokasi Pembeli');
  assert.equal(getDefaultPoIncoterm({ defaultCurrency: 'USD' }), 'CIP');
  assert.equal(
    getDefaultPoDeliveryLocation(
      'EXW - Loco Gudang Penjual',
      { address: 'Kawasan Jababeka Blok B5', name: 'PT Vendor' },
      { address: 'Gudang Sunter', name: 'Sunter' }
    ),
    'Kawasan Jababeka Blok B5'
  );
  assert.equal(
    getDefaultPoDeliveryLocation(
      'DDP - Franco Lokasi Pembeli',
      { address: 'Kawasan Jababeka Blok B5', name: 'PT Vendor' },
      { address: 'Gudang Sunter', name: 'Sunter' }
    ),
    'Gudang Sunter'
  );
});

test('Quotation conversion copies Payment Term, Incoterms, delivery location, and T&C into SO', () => {
  const inherited = inheritTermsFromQuotation(
    {
      quotationNumber: 'QTN-2026-0010',
      paymentTerm: 'Custom',
      paymentTermCustom: 'DP 30% + Pelunasan 70% setelah BAST',
      incoterm: 'CIP',
      deliveryLocation: 'Site Balikpapan KM 13',
      termsAndConditions: 'Garansi resmi 12 bulan sejak serah terima.',
    },
    {
      name: 'PT Buyer',
      paymentScheme: 'CBD',
      paymentTermDays: 0,
      shippingAddress: 'Jakarta',
      address: 'Jakarta',
    },
    { name: 'Gudang Pusat', address: 'Sunter' }
  );

  assert.equal(inherited.paymentTerm, 'Custom');
  assert.equal(inherited.paymentTermCustom, 'DP 30% + Pelunasan 70% setelah BAST');
  assert.equal(inherited.incoterm, 'CIP');
  assert.equal(inherited.deliveryLocation, 'Site Balikpapan KM 13');
  assert.equal(inherited.termsAndConditions, 'Garansi resmi 12 bulan sejak serah terima.');
  assert.equal(
    resolvePaymentTermDisplay(inherited.paymentTerm, inherited.paymentTermCustom),
    'DP 30% + Pelunasan 70% setelah BAST'
  );
});

test('PO mandatory note & summary builders produce complete bottom-left T&C sections', () => {
  assert.ok(getDefaultPurchaseOrderTerms().includes(MANDATORY_PO_ATTACHMENT_NOTE));
  assert.ok(getDefaultQuotationTerms().length > 40);
  assert.ok(getDefaultSalesOrderTerms().length > 40);

  const enforced = ensureMandatoryPoTermsNote('Pengiriman Senin-Jumat jam kerja.');
  assert.ok(enforced.includes(MANDATORY_PO_ATTACHMENT_NOTE));

  const poSummary = buildOrderTermsSummaryForPo(
    {
      paymentTerm: 'TOP 45 Hari Kalender',
      incoterm: 'DAP',
      deliveryLocation: 'Hub Industri Cikarang',
      termsAndConditions: 'Kualitas sesuai SNI.',
      warehouseId: 'wh_1',
    },
    { paymentScheme: 'TOP', paymentTermDays: 30, defaultCurrency: 'IDR', address: 'Cilegon', name: 'Sup' }
  );
  assert.equal(poSummary.mandatoryNotice, MANDATORY_PO_ATTACHMENT_NOTE);
  assert.equal(poSummary.metaRows[0]?.value, 'TOP 45 Hari Kalender');
  assert.equal(poSummary.metaRows[1]?.value, 'DAP');
  assert.equal(poSummary.metaRows[2]?.value, 'Hub Industri Cikarang');

  const qtSummary = buildOrderTermsSummaryForQuotation({
    paymentTerm: 'TOP 14 Hari Kalender',
    incoterm: 'DDP - Franco Lokasi Pembeli',
    deliveryLocation: 'Bekasi Timur',
    validityPeriod: '14 Hari Kalender',
    leadTime: '3-5 Hari Kerja',
    validUntil: '2026-12-20',
    createdAt: '2026-12-06T00:00:00Z',
  });
  assert.ok(qtSummary.metaRows.some((r) => r.label === 'Validity Period' && r.value.includes('14 Hari Kalender')));
  assert.ok(qtSummary.metaRows.some((r) => r.label === 'Lead Time' && r.value === '3-5 Hari Kerja'));

  const soSummary = buildOrderTermsSummaryForSo({
    paymentTerm: 'COD',
    incoterm: 'EXW - Loco Gudang Penjual',
    deliveryLocation: 'Gudang Sunter',
    quotationNumber: 'QT-2026-0042',
  });
  assert.ok(soSummary.metaRows.some((r) => r.label === 'Payment Term' && r.value === 'COD'));
  assert.ok(soSummary.metaRows.some((r) => r.label === 'Ref. Quotation' && r.value === 'QT-2026-0042'));
});

test('Sequential numbering avoids collisions after deletions and date helpers work cleanly', () => {
  assert.equal(
    buildNextSequentialDocNumber('PO-2026-', ['PO-2026-0041', 'PO-2026-0091'], 92),
    'PO-2026-0092'
  );
  // Even if earlier docs were deleted leaving only PO-2026-0095 and array length=1, next is 0096
  assert.equal(
    buildNextSequentialDocNumber('PO-2026-', ['PO-2026-0095'], 92),
    'PO-2026-0096'
  );
  assert.equal(
    buildNextSequentialDocNumber('QTN-2026-', ['QT-2026-0042', 'QTN-2026-0003'], 1),
    'QTN-2026-0004'
  );

  const base = new Date('2026-12-01T00:00:00Z');
  assert.equal(computeDueDateFromPaymentTerm('CBD', '', base), '2026-12-01');
  assert.equal(computeDueDateFromPaymentTerm('TOP 14 Hari Kalender', '', base), '2026-12-15');
  assert.equal(computeDueDateFromPaymentTerm('Custom', 'TOP 60 Hari', base), '2027-01-30');
  assert.equal(computeValidityPeriodLabel('2026-12-01', '2026-12-15'), '14 Hari Kalender');

  assert.deepEqual(mapCustomerToPaymentTerm({ paymentScheme: 'TOP 14 Hari', paymentTermDays: 14 }), {
    paymentTerm: 'TOP 14 Hari Kalender',
    paymentTermCustom: '',
  });
  assert.equal(
    getDefaultSalesDeliveryLocation('EXW - Loco Gudang Penjual', { name: 'Cus' }, { address: 'Gudang A', name: 'A' }),
    'Gudang A'
  );
});

test('Opening texts & Vendor RFQ provisions summary are generated cleanly', () => {
  const qtOpening = getDefaultQuotationOpeningText('PT Nusantara Jaya');
  assert.ok(qtOpening.includes('Dengan hormat'));
  assert.ok(qtOpening.includes('PT Nusantara Jaya'));

  const rfqOpening = getDefaultRfqOpeningText('PT Nusantara Jaya');
  assert.ok(rfqOpening.includes('Dengan hormat'));
  assert.ok(rfqOpening.includes('PT Nusantara Jaya'));
  assert.ok(rfqOpening.toLowerCase().includes('penawaran harga'));

  assert.ok(getDefaultRfqTerms().includes('Validity Period'));

  const rfqSummary = buildOrderTermsSummaryForRfq(
    {
      warehouseId: 'wh_1',
      warehouseName: 'Gudang Sunter',
      deadlineDate: '2026-12-10',
      invitedSupplierIds: ['sup_1', 'sup_2'],
      notes: 'Harap lampirkan katalog teknis.',
    },
    [
      {
        id: 'sup_1',
        name: 'PT Vendor Satu',
      },
    ],
    { name: 'Gudang Sunter', address: 'Jl. Danau Sunter No. 1' }
  );
  assert.equal(rfqSummary.heading, 'Ketentuan Pengajuan Penawaran (RFQ)');
  assert.ok(rfqSummary.metaRows.some((r) => r.label === 'Vendor Terundang' && r.value === 'PT Vendor Satu'));
  assert.equal(rfqSummary.additionalNotes, 'Harap lampirkan katalog teknis.');
});

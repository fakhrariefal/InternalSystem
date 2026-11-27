import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExecutiveContributions,
  buildReminderDrafts,
  buildSixMonthChartSeries,
  calculateOrderTotals,
  calculateTotalStockValueIdr,
  canTransitionPoStatus,
  canTransitionSoStatus,
  checkSoStockAvailability,
  computeBalanceSheet,
  computeBatchAlerts,
  computeBudgetVsActual,
  computeIncomeStatement,
  computeInvoiceStatus,
  computeLedgerStatement,
  computeMonthlyPerformance,
  computeThreeWayMatchStatus,
  computeTrialBalance,
  computeVatReconciliation,
  convertToIdr,
  findSeededDummyMasterTargets,
  findSeededDummyOrderTargets,
  formatCompactIdr,
  formatFirebaseAuthErrorMessage,
  formatMonthKeyLabel,
  getAgingBucket,
  getCashBankAccounts,
  getEffectiveTaxRatePercent,
  isCashBankAccount,
  isCompanyPkp,
  isDateInClosedPeriod,
  isEmailRegistered,
  isLikelyMobileUserAgent,
  isLowStockProduct,
  isSafeDocumentUrl,
  isServiceOrderItem,
  isValidEmailFormat,
  normalizeSupplierCategories,
  normalizeUserEmail,
  pickCashBankAccountId,
  requiresDirectorApproval,
  resolveBuyerTermDays,
  resolveEffectiveUnitPrice,
  resolvePeriodDateRange,
  resolveSupplierTermDays,
  sanitizeAuthProfileFields,
  shouldFallbackToRedirectAuth,
  splitOrderSubtotalByService,
  summarizeAgingReport,
  validateBalancedJournalLines,
  validateBlueprintId,
  validateBuyerForSalesOrder,
  validateSupplierForPayment,
  validateSupplierForPurchaseOrder,
} from './erpLogic';
import { canAccessModule, hasPermission, normalizeUserRole } from './rbac';
import { createEmptyErpState, createInitialSeedState } from './seedData';
import type { Customer, Supplier } from './types';

test('Currency conversion IDR/USD works accurately', () => {
  assert.equal(convertToIdr(100, 'USD', 16200), 1620000);
  assert.equal(convertToIdr(550000, 'IDR', 16200), 550000);
});

test('Order totals calculation with PPN 11%', () => {
  const totals = calculateOrderTotals(
    [
      { qty: 10, unitPrice: 100000 },
      { qty: 2, unitPrice: 250000 },
    ],
    11
  );
  assert.equal(totals.subtotal, 1500000);
  assert.equal(totals.taxAmount, 165000);
  assert.equal(totals.totalAmount, 1665000);
});

test('PO and SO state machine transitions enforce valid workflows', () => {
  assert.equal(canTransitionPoStatus('Draft', 'Submitted'), true);
  assert.equal(canTransitionPoStatus('Draft', 'Approved by Manager'), false);
  assert.equal(canTransitionPoStatus('Submitted', 'Approved by Manager'), true);
  assert.equal(canTransitionPoStatus('Closed', 'Draft'), false);

  assert.equal(canTransitionSoStatus('Draft', 'Confirmed'), true);
  assert.equal(canTransitionSoStatus('Confirmed', 'Partially Delivered'), true);
  assert.equal(canTransitionSoStatus('Closed', 'Invoiced'), false);
});

test('Invoice partial payment & overdue status calculation', () => {
  const futureDate = '2027-01-15T00:00:00.000Z';
  const pastDate = '2026-01-15T00:00:00.000Z';
  const refNow = new Date('2026-11-22T00:00:00.000Z');

  assert.deepEqual(computeInvoiceStatus(1000000, 400000, futureDate, refNow), {
    balanceDue: 600000,
    status: 'PARTIAL',
  });
  assert.deepEqual(computeInvoiceStatus(1000000, 1000000, futureDate, refNow), {
    balanceDue: 0,
    status: 'PAID',
  });
  assert.deepEqual(computeInvoiceStatus(1000000, 200000, pastDate, refNow), {
    balanceDue: 800000,
    status: 'OVERDUE',
  });
});

test('Aging bucket categorization and report summary', () => {
  const refNow = new Date('2026-11-22T00:00:00.000Z');
  assert.equal(getAgingBucket('2026-12-01T00:00:00.000Z', refNow), 'Belum Jatuh Tempo');
  assert.equal(getAgingBucket('2026-11-10T00:00:00.000Z', refNow), '1-30 Hari');
  assert.equal(getAgingBucket('2026-10-05T00:00:00.000Z', refNow), '31-60 Hari');
  assert.equal(getAgingBucket('2026-07-01T00:00:00.000Z', refNow), '> 90 Hari');
});

test('RBAC matrix enforces strict 8-role permissions and Angel Investor dashboard-only isolation', () => {
  assert.equal(hasPermission('Direktur', 'master:users'), true);
  assert.equal(normalizeUserRole('Super Admin'), 'Direktur');
  assert.equal(normalizeUserRole('Anggel Investor'), 'Angel Investor');
  assert.equal(hasPermission('Super Admin', 'master:users'), true);
  assert.equal(hasPermission('Manager', 'po:approve'), true);
  assert.equal(hasPermission('Purchasing', 'po:approve'), false);
  assert.equal(hasPermission('Purchasing', 'po:create'), true);
  assert.equal(hasPermission('Warehouse', 'inventory:write'), true);
  assert.equal(hasPermission('Sales', 'so:create'), true);
  assert.equal(hasPermission('Finance', 'accounting:write'), true);
  assert.equal(hasPermission('Viewer', 'po:create'), false);
  assert.equal(hasPermission('Viewer', 'accounting:write'), false);
  assert.equal(hasPermission('Angel Investor', 'po:create'), false);
  assert.equal(hasPermission('Angel Investor', 'master:write'), false);
  assert.equal(hasPermission('Angel Investor', 'accounting:write'), false);
  assert.equal(canAccessModule('Angel Investor', 'dashboard'), true);
  assert.equal(canAccessModule('Angel Investor', 'master'), false);
  assert.equal(canAccessModule('Angel Investor', 'purchasing'), false);
  assert.equal(canAccessModule('Angel Investor', 'inventory'), false);
  assert.equal(canAccessModule('Angel Investor', 'sales'), false);
  assert.equal(canAccessModule('Angel Investor', 'accounting'), false);
  assert.equal(canAccessModule('Angel Investor', 'reports'), false);
  assert.equal(canAccessModule('Angel Investor', 'system'), false);
});

test('Blueprint ID validation blocks path traversal & invalid characters', () => {
  assert.equal(validateBlueprintId('sup_01-jkt'), true);
  assert.equal(validateBlueprintId('../etc/passwd'), false);
  assert.equal(validateBlueprintId(''), false);
});

test('Seed data integrity meets minimum enterprise requirements', () => {
  const seed = createInitialSeedState();
  assert.equal(seed.suppliers.length >= 5, true);
  assert.equal(seed.customers.length >= 8, true);
  assert.equal(seed.products.length >= 25, true);
  assert.equal(seed.warehouses.length >= 3, true);
  assert.equal(seed.purchaseOrders.length >= 5, true);
  assert.equal(seed.salesOrders.length >= 5, true);
  assert.equal(calculateTotalStockValueIdr(seed.products, 16200) > 0, true);
  assert.equal(seed.products.some(isLowStockProduct), true);

  const chart = buildSixMonthChartSeries(seed.purchaseOrders, seed.salesOrders, 16200, new Date('2026-11-22T00:00:00.000Z'));
  assert.equal(chart.length, 6);

  const aging = summarizeAgingReport(seed.invoices, 'AR', 16200, new Date('2026-11-22T00:00:00.000Z'));
  assert.equal(Object.values(aging).some((v) => v > 0), true);

  const check = checkSoStockAvailability(seed.salesOrders[0].items, seed.salesOrders[0].warehouseId, seed.products);
  assert.equal(typeof check.sufficient, 'boolean');
});

test('User email normalization, format validation, and duplicate checks work cleanly', () => {
  assert.equal(normalizeUserEmail('  Staff.Baru@DomestiqHub.com '), 'staff.baru@domestiqhub.com');
  assert.equal(isValidEmailFormat('staff@domestiqhub.com'), true);
  assert.equal(isValidEmailFormat('invalid-email'), false);

  const users = [
    { uid: 'u1', email: 'fakhrariefal@domestiqhub.com' },
    { uid: 'u2', email: 'purchasing@domestiqhub.com' },
  ];
  assert.equal(isEmailRegistered(users, 'FAKHRARIEFAL@domestiqhub.com'), true);
  assert.equal(isEmailRegistered(users, 'fakhrariefal@domestiqhub.com', 'u1'), false);
  assert.equal(isEmailRegistered(users, 'baru@domestiqhub.com'), false);
});

test('Empty ERP state starts clean without hardcoded dummy users or products', () => {
  const empty = createEmptyErpState();
  assert.equal(empty.users.length, 0);
  assert.equal(empty.products.length, 0);
  assert.equal(empty.suppliers.length, 0);
  assert.equal(empty.customers.length, 0);
  assert.equal(empty.purchaseOrders.length, 0);
  assert.equal(empty.salesOrders.length, 0);
});

test('findSeededDummyMasterTargets only selects seeded dummy IDs and preserves custom master records', () => {
  const seed = createInitialSeedState();
  const customState = {
    products: [seed.products[0], { id: 'prd_custom_99' }],
    suppliers: [seed.suppliers[0], { id: 'sup_custom_99' }],
    customers: [{ id: 'cus_custom_99' }],
    warehouses: [seed.warehouses[0]],
    categories: [seed.categories[0]],
    uoms: [seed.uoms[0]],
  };
  const targets = findSeededDummyMasterTargets(customState, seed);
  assert.deepEqual(targets.productIds, [seed.products[0].id]);
  assert.deepEqual(targets.supplierIds, [seed.suppliers[0].id]);
  assert.deepEqual(targets.customerIds, []);
  assert.equal(targets.totalCount, 5);
});

test('findSeededDummyOrderTargets only selects seeded dummy PO/SO IDs and preserves custom orders', () => {
  const seed = createInitialSeedState();
  const targets = findSeededDummyOrderTargets(
    {
      purchaseOrders: [seed.purchaseOrders[0], { id: 'po_custom_1' }],
      salesOrders: [seed.salesOrders[0], seed.salesOrders[1], { id: 'so_custom_1' }],
    },
    seed
  );
  assert.deepEqual(targets.poIds, [seed.purchaseOrders[0].id]);
  assert.deepEqual(targets.soIds, [seed.salesOrders[0].id, seed.salesOrders[1].id]);
  assert.equal(targets.totalCount, 3);
});

test('Double-entry journal validation rejects unbalanced lines and accepts balanced entries', () => {
  assert.equal(validateBalancedJournalLines([]).valid, false);
  assert.equal(
    validateBalancedJournalLines([
      { accountId: 'coa_1101', debitIdr: 500000, creditIdr: 0 },
      { accountId: 'coa_6104', debitIdr: 0, creditIdr: 400000 },
    ]).valid,
    false
  );
  assert.equal(
    validateBalancedJournalLines([
      { accountId: 'coa_1101', debitIdr: -100, creditIdr: 0 },
      { accountId: 'coa_6104', debitIdr: 0, creditIdr: 100 },
    ]).valid,
    false
  );
  const ok = validateBalancedJournalLines([
    { accountId: 'coa_6101', debitIdr: 1200000, creditIdr: 0 },
    { accountId: 'coa_6102', debitIdr: 300000, creditIdr: 0 },
    { accountId: 'coa_1102', debitIdr: 0, creditIdr: 1500000 },
  ]);
  assert.equal(ok.valid, true);
  assert.equal(ok.totalDebitIdr, 1500000);
  assert.equal(ok.differenceIdr, 0);
});

test('General Ledger (Buku Besar) computes running balance & period opening balance accurately', () => {
  const seed = createInitialSeedState();
  const bankMandiri = seed.chartOfAccounts.find((a) => a.id === 'coa_1102')!;
  const fullStmt = computeLedgerStatement(bankMandiri, seed.journalEntries);
  assert.equal(fullStmt.closingBalanceIdr, 430075500);

  // Starting from 2026-09-01 should roll prior transactions into openingBalanceIdr
  // Prior to 2026-09-01: +420,000,000 (Jun 1) - 44,400,000 (Jul 20) + 46,675,500 (Aug 12) = 422,275,500
  const periodStmt = computeLedgerStatement(bankMandiri, seed.journalEntries, '2026-09-01', '2026-12-31');
  assert.equal(periodStmt.openingBalanceIdr, 422275500);
  assert.equal(periodStmt.closingBalanceIdr, 430075500);
});

test('Seeded Trial Balance, Income Statement, Balance Sheet & AP/AR ledger reconcile 100%', () => {
  const seed = createInitialSeedState();
  const tb = computeTrialBalance(seed.chartOfAccounts, seed.journalEntries);
  assert.equal(tb.isBalanced, true);
  assert.equal(tb.totalEndingDebitIdr, tb.totalEndingCreditIdr);

  const pnl = computeIncomeStatement(seed.chartOfAccounts, seed.journalEntries);
  assert.equal(pnl.totalRevenueIdr, 122705000);
  assert.equal(pnl.totalCogsIdr, 96545000);
  assert.equal(pnl.grossProfitIdr, 26160000);
  assert.equal(pnl.totalExpensesIdr, 18550000);
  assert.equal(pnl.netIncomeIdr, 7610000);

  const bs = computeBalanceSheet(seed.chartOfAccounts, seed.journalEntries);
  assert.equal(bs.isBalanced, true);
  assert.equal(bs.totalAssetsIdr, bs.totalLiabilitiesIdr + bs.totalEquityIdr);

  // AR & AP account balances in Buku Besar match unpaid AR/AP invoices exact to the Rupiah
  const arRow = tb.rows.find((r) => r.account.id === 'coa_1201')!;
  const apRow = tb.rows.find((r) => r.account.id === 'coa_2101')!;
  const unpaidArIdr = seed.invoices
    .filter((i) => i.ledgerType === 'AR' && i.balanceDue > 0)
    .reduce((s, i) => s + convertToIdr(i.balanceDue, i.currency, i.exchangeRate || 16200), 0);
  const unpaidApIdr = seed.invoices
    .filter((i) => i.ledgerType === 'AP' && i.balanceDue > 0)
    .reduce((s, i) => s + convertToIdr(i.balanceDue, i.currency, i.exchangeRate || 16200), 0);

  assert.equal(arRow.closingBalanceIdr, unpaidArIdr);
  assert.equal(apRow.closingBalanceIdr, unpaidApIdr);
  assert.equal(pickCashBankAccountId('Kas Tunai'), 'coa_1101');
  assert.equal(pickCashBankAccountId('Transfer BCA'), 'coa_1103');
  assert.equal(pickCashBankAccountId('Transfer Bank Mandiri'), 'coa_1102');

  const empty = createEmptyErpState();
  assert.equal(empty.chartOfAccounts.length, 0);
  assert.equal(empty.journalEntries.length, 0);
});

test('Monthly performance report reconciles with Income Statement and order volumes', () => {
  const seed = createInitialSeedState();
  const monthly = computeMonthlyPerformance(
    seed.chartOfAccounts,
    seed.journalEntries,
    seed.purchaseOrders,
    seed.salesOrders,
    seed.settings.defaultExchangeRateUsdIdr
  );
  const pnl = computeIncomeStatement(seed.chartOfAccounts, seed.journalEntries);

  assert.ok(monthly.months.length >= 6);
  assert.equal(monthly.totalRevenueIdr, pnl.totalRevenueIdr);
  assert.equal(monthly.totalCogsIdr, pnl.totalCogsIdr);
  assert.equal(monthly.totalGrossProfitIdr, pnl.grossProfitIdr);
  assert.equal(monthly.totalOperatingExpensesIdr, pnl.totalExpensesIdr);
  assert.equal(monthly.totalNetIncomeIdr, pnl.netIncomeIdr);
  assert.ok(monthly.months.some((m) => m.monthKey === '2026-11' && m.monthLabel === 'Nov 2026'));
});

test('Bilingual formatting and executive contributions compute accurately', () => {
  const seed = createInitialSeedState();
  assert.equal(formatCompactIdr(1_500_000_000, 'id'), 'Rp 1.50 M');
  assert.equal(formatCompactIdr(1_500_000_000, 'en'), 'Rp 1.50 B');
  assert.equal(formatCompactIdr(25_000_000, 'id'), 'Rp 25.0 Jt');
  assert.equal(formatCompactIdr(25_000_000, 'en'), 'Rp 25.0 M');
  assert.equal(formatMonthKeyLabel('2026-05', 'id'), 'Mei 2026');
  assert.equal(formatMonthKeyLabel('2026-05', 'en'), 'May 2026');

  const range = resolvePeriodDateRange('month', new Date(2026, 10, 23));
  assert.equal(range.startDate, '2026-11-01');
  assert.equal(range.endDate, '2026-11-23');

  const contrib = buildExecutiveContributions({
    purchaseOrders: seed.purchaseOrders,
    salesOrders: seed.salesOrders,
    products: seed.products,
    usdToIdrRate: seed.settings.defaultExchangeRateUsdIdr,
  });
  assert.ok(contrib.topCustomers.length > 0);
  assert.ok(contrib.topSuppliers.length > 0);
  assert.ok(contrib.stockByCategory.length > 0);
  assert.ok(contrib.topCustomers[0].amountIdr >= contrib.topCustomers[contrib.topCustomers.length - 1].amountIdr);
});

test('Cash/Bank accounts sync dynamically with Chart of Accounts (Buku Besar)', () => {
  const seed = createInitialSeedState();
  const customBank = {
    ...seed.chartOfAccounts[1],
    id: 'coa_custom_bri',
    code: '1104',
    name: 'Bank BRI Giro',
    active: true,
  };
  const customCashOutside11 = {
    ...seed.chartOfAccounts[0],
    id: 'coa_custom_cash',
    code: '1010',
    name: 'Kas Besar Direksi',
    active: true,
  };
  const coaList = [...seed.chartOfAccounts, customBank, customCashOutside11];
  const cashBanks = getCashBankAccounts(coaList);
  assert.ok(cashBanks.some((a) => a.id === 'coa_custom_bri' && a.code === '1104'));
  assert.ok(cashBanks.some((a) => a.id === 'coa_custom_cash' && a.code === '1010'));
  assert.ok(!cashBanks.some((a) => a.code === '1201'));
  assert.equal(isCashBankAccount(seed.chartOfAccounts.find((a) => a.code === '1201')!), false);
  assert.equal(pickCashBankAccountId('Transfer Bank · 1104 Bank BRI Giro', coaList), 'coa_custom_bri');
});

test('3-tier RBAC separates Purchasing supplier registration, Sales buyer registration, Admin approval, and Warehouse read-only', () => {
  assert.equal(hasPermission('Direktur', 'partner:approve'), true);
  assert.equal(hasPermission('Manager', 'partner:approve'), false);
  assert.equal(hasPermission('Purchasing', 'supplier:write'), true);
  assert.equal(hasPermission('Purchasing', 'buyer:write'), false);
  assert.equal(hasPermission('Purchasing', 'partner:approve'), false);

  assert.equal(hasPermission('Sales', 'buyer:write'), true);
  assert.equal(hasPermission('Sales', 'supplier:write'), false);
  assert.equal(hasPermission('Sales', 'partner:approve'), false);

  assert.equal(hasPermission('Warehouse', 'supplier:write'), false);
  assert.equal(hasPermission('Warehouse', 'buyer:write'), false);
  assert.equal(hasPermission('Warehouse', 'partner:approve'), false);
});

test('Supplier verification & payment rules block unverified TOP, large tx > 10M, and Blacklisted', () => {
  assert.equal(resolveSupplierTermDays('CBD', 30), 0);
  assert.equal(resolveSupplierTermDays('COD', 14), 0);
  assert.equal(resolveSupplierTermDays('TOP', 45), 45);

  const baseSup: Supplier = {
    id: 'sup_t1',
    code: 'SUP-T1',
    name: 'PT Uji Vendor',
    vendorCategory: 'Safety/MRO',
    paymentScheme: 'CBD',
    paymentTermDays: 0,
    defaultCurrency: 'IDR',
    verificationStatus: 'Pending',
    active: true,
    createdBy: 'usr_p',
    createdAt: '2026-11-24T00:00:00.000Z',
    updatedAt: '2026-11-24T00:00:00.000Z',
  };

  // Pending CBD <= 10M allowed; > 10M blocked
  assert.equal(validateSupplierForPurchaseOrder({ supplier: baseSup, totalAmountIdr: 5_000_000 }).allowed, true);
  assert.equal(validateSupplierForPurchaseOrder({ supplier: baseSup, totalAmountIdr: 12_000_000 }).allowed, false);

  // Pending TOP blocked even for small amount
  const pendingTop: Supplier = { ...baseSup, paymentScheme: 'TOP', paymentTermDays: 30 };
  assert.equal(validateSupplierForPurchaseOrder({ supplier: pendingTop, totalAmountIdr: 1_000_000 }).allowed, false);

  // Verified TOP allowed
  const verifiedTop: Supplier = { ...pendingTop, verificationStatus: 'Verified' };
  assert.equal(validateSupplierForPurchaseOrder({ supplier: verifiedTop, totalAmountIdr: 50_000_000 }).allowed, true);

  // Blacklisted blocked always
  const blacklisted: Supplier = { ...verifiedTop, verificationStatus: 'Blacklisted' };
  assert.equal(validateSupplierForPurchaseOrder({ supplier: blacklisted, totalAmountIdr: 500_000 }).allowed, false);

  // Payment rules
  assert.equal(validateSupplierForPayment({ supplier: baseSup, payAmountIdr: 8_000_000 }).allowed, true);
  assert.equal(validateSupplierForPayment({ supplier: baseSup, payAmountIdr: 15_000_000 }).allowed, false);
  assert.equal(validateSupplierForPayment({ supplier: verifiedTop, payAmountIdr: 50_000_000 }).allowed, true);
  assert.equal(validateSupplierForPayment({ supplier: blacklisted, payAmountIdr: 100_000 }).allowed, false);
});

test('Buyer TOP scheme requires Admin approval and Credit Limit enforcement', () => {
  assert.equal(resolveBuyerTermDays('CBD'), 0);
  assert.equal(resolveBuyerTermDays('TOP 14 Hari'), 14);
  assert.equal(resolveBuyerTermDays('TOP 30 Hari'), 30);

  const baseBuyer: Customer = {
    id: 'cus_t1',
    code: 'CUS-T1',
    name: 'PT Uji Klien',
    paymentScheme: 'CBD',
    creditLimit: 0,
    paymentTermDays: 0,
    verificationStatus: 'Pending',
    active: true,
    createdBy: 'usr_s',
    createdAt: '2026-11-24T00:00:00.000Z',
    updatedAt: '2026-11-24T00:00:00.000Z',
  };

  // Pending CBD <= 10M allowed; > 10M blocked
  assert.equal(
    validateBuyerForSalesOrder({ customer: baseBuyer, newOrderAmountIdr: 6_000_000, openArIdr: 0 }).allowed,
    true
  );
  assert.equal(
    validateBuyerForSalesOrder({ customer: baseBuyer, newOrderAmountIdr: 15_000_000, openArIdr: 0 }).allowed,
    false
  );

  // TOP Pending blocked until Admin Approves & sets Credit Limit
  const pendingTopBuyer: Customer = { ...baseBuyer, paymentScheme: 'TOP 30 Hari', paymentTermDays: 30 };
  assert.equal(
    validateBuyerForSalesOrder({ customer: pendingTopBuyer, newOrderAmountIdr: 1_000_000, openArIdr: 0 }).allowed,
    false
  );

  // Verified TOP with Credit Limit 50M
  const approvedTopBuyer: Customer = {
    ...pendingTopBuyer,
    verificationStatus: 'Verified',
    creditLimit: 50_000_000,
  };
  assert.equal(
    validateBuyerForSalesOrder({
      customer: approvedTopBuyer,
      newOrderAmountIdr: 20_000_000,
      openArIdr: 25_000_000,
    }).allowed,
    true
  );
  // Exceeding Credit Limit (25M AR + 30M SO > 50M Limit) rejected
  assert.equal(
    validateBuyerForSalesOrder({
      customer: approvedTopBuyer,
      newOrderAmountIdr: 30_000_000,
      openArIdr: 25_000_000,
    }).allowed,
    false
  );

  // Blacklisted rejected
  const blacklistedBuyer: Customer = { ...approvedTopBuyer, verificationStatus: 'Blacklisted' };
  assert.equal(
    validateBuyerForSalesOrder({
      customer: blacklistedBuyer,
      newOrderAmountIdr: 100_000,
      openArIdr: 0,
    }).allowed,
    false
  );
});

test('isSafeDocumentUrl accepts safe PDF/image data URLs and HTTPS links while rejecting unsafe URIs', () => {
  assert.equal(isSafeDocumentUrl('https://storage.googleapis.com/bucket/doc.pdf'), true);
  assert.equal(isSafeDocumentUrl('data:application/pdf;base64,JVBERi0xLjQ='), true);
  assert.equal(isSafeDocumentUrl('data:image/jpeg;base64,/9j/4AAQ'), true);
  assert.equal(isSafeDocumentUrl('javascript:alert(1)'), false);
  assert.equal(isSafeDocumentUrl('data:text/html;base64,PHNjcmlwdD4='), false);
  assert.equal(isSafeDocumentUrl(''), false);
});

test('Contract pricing resolves customer tier price when qty and validity match', () => {
  const seed = createInitialSeedState();
  const cus01 = seed.customers.find((c) => c.id === 'cus_01')!;
  const helm = seed.products.find((p) => p.id === 'prd_01')!;

  // Below minQty (50) uses standard sellPrice (135,000)
  const belowMin = resolveEffectiveUnitPrice(cus01, helm, 10, 'IDR', 16200, '2026-11-22');
  assert.equal(belowMin.isContractPrice, false);
  assert.equal(belowMin.unitPrice, 135000);

  // At/above minQty (50) uses contract price (128,000)
  const atMin = resolveEffectiveUnitPrice(cus01, helm, 60, 'IDR', 16200, '2026-11-22');
  assert.equal(atMin.isContractPrice, true);
  assert.equal(atMin.unitPrice, 128000);

  // Past validity date falls back to catalog price
  const expired = resolveEffectiveUnitPrice(cus01, helm, 60, 'IDR', 16200, '2028-01-01');
  assert.equal(expired.isContractPrice, false);
  assert.equal(expired.unitPrice, 135000);
});

test('Approval matrix flags POs above manager limit for Direktur approval', () => {
  assert.equal(requiresDirectorApproval(20_000_000, 25_000_000), false);
  assert.equal(requiresDirectorApproval(25_000_000, 25_000_000), false);
  assert.equal(requiresDirectorApproval(41_625_000, 25_000_000), true);
  assert.equal(hasPermission('Direktur', 'director:approve'), true);
  assert.equal(hasPermission('Manager', 'director:approve'), false);
  assert.equal(hasPermission('Purchasing', 'rfq:write'), true);
  assert.equal(hasPermission('Sales', 'quotation:write'), true);
  assert.equal(hasPermission('Finance', 'period:close'), true);
  assert.equal(hasPermission('Angel Investor', 'director:approve'), false);
  assert.equal(hasPermission('Angel Investor', 'period:close'), false);
});

test('3-Way Matching accurately classifies MATCHED, PARTIAL_GR, VARIANCE, and NO_INVOICE', () => {
  const seed = createInitialSeedState();
  const po02 = seed.purchaseOrders.find((p) => p.id === 'po_02')!;
  const po03 = seed.purchaseOrders.find((p) => p.id === 'po_03')!;
  const po04 = seed.purchaseOrders.find((p) => p.id === 'po_04')!;

  assert.equal(computeThreeWayMatchStatus(po02, seed.invoices, 16200).status, 'MATCHED');
  assert.equal(computeThreeWayMatchStatus(po03, seed.invoices, 16200).status, 'PARTIAL_GR');
  assert.equal(computeThreeWayMatchStatus(po04, seed.invoices, 16200).status, 'NO_INVOICE');

  // Inject variance invoice
  const mismatchInvoices = seed.invoices.map((inv) =>
    inv.id === 'inv_ap_02' ? { ...inv, totalAmount: inv.totalAmount + 500000 } : inv
  );
  const varResult = computeThreeWayMatchStatus(po02, mismatchInvoices, 16200);
  assert.equal(varResult.status, 'VARIANCE');
  assert.equal(varResult.varianceIdr, 500000);
});

test('PPN reconciliation (PKP) computes PPN Keluaran, PPN Masukan, returns, and net balance', () => {
  const seed = createInitialSeedState();
  const allVat = computeVatReconciliation(seed.invoices, seed.goodsReturns, 16200, 'ALL');
  // Seeded goodsReturns are Pending so they should not offset yet
  assert.equal(allVat.salesReturnVatIdr, 0);
  assert.equal(allVat.purchaseReturnVatIdr, 0);
  assert.ok(allVat.netPpnKeluaranIdr > 0);
  assert.ok(allVat.netPpnMasukanIdr > 0);

  // Completed sales return reduces PPN Keluaran
  const completedReturns = seed.goodsReturns.map((r) =>
    r.id === 'ret_02' ? { ...r, status: 'Completed' as const } : r
  );
  const afterReturnVat = computeVatReconciliation(seed.invoices, completedReturns, 16200, 'ALL');
  assert.equal(afterReturnVat.salesReturnVatIdr, 206250);
  assert.equal(afterReturnVat.netPpnKeluaranIdr, allVat.netPpnKeluaranIdr - 206250);
});

test('Period closing lock blocks locked month and allows open month', () => {
  const seed = createInitialSeedState();
  assert.equal(isDateInClosedPeriod('2026-06-15', seed.periodClosings).locked, true);
  assert.equal(isDateInClosedPeriod('2026-11-22', seed.periodClosings).locked, false);
});

test('Budget vs Actual compares monthly revenue/COGS/OpEx against actual GL performance', () => {
  const seed = createInitialSeedState();
  const monthly = computeMonthlyPerformance(
    seed.chartOfAccounts,
    seed.journalEntries,
    seed.purchaseOrders,
    seed.salesOrders,
    seed.settings.defaultExchangeRateUsdIdr
  );
  const bva = computeBudgetVsActual(seed.budgets, monthly, 'id');
  assert.equal(bva.length, 3);
  const sep = bva.find((r) => r.periodKey === '2026-09')!;
  assert.equal(sep.targetRevenueIdr, 55000000);
  assert.equal(sep.actualRevenueIdr, 50775000);
  assert.ok(sep.revenueAttainmentPercent > 90 && sep.revenueAttainmentPercent < 95);
});

test('Batch expiry alerts & Smart reminder drafts detect expired batches, overdue AR, pending PO, and low stock', () => {
  const seed = createInitialSeedState();
  const refDate = new Date('2026-11-22T08:00:00.000Z');
  const batchAlerts = computeBatchAlerts(seed.inventoryBatches, refDate, 60);
  assert.equal(batchAlerts.expired.length, 1);
  assert.equal(batchAlerts.expiringSoon.length, 1);
  assert.equal(batchAlerts.warrantyExpiringSoon.length, 1);

  const drafts = buildReminderDrafts({
    invoices: seed.invoices,
    purchaseOrders: seed.purchaseOrders,
    products: seed.products,
    batches: seed.inventoryBatches,
    customers: seed.customers,
    suppliers: seed.suppliers,
    lang: 'id',
    companyName: seed.settings.companyName,
    referenceDate: refDate,
  });
  assert.ok(drafts.some((d) => d.category === 'AR_OVERDUE' && Boolean(d.whatsappUrl)));
  assert.ok(drafts.some((d) => d.category === 'PO_APPROVAL'));
  assert.ok(drafts.some((d) => d.category === 'LOW_STOCK'));
  assert.ok(drafts.some((d) => d.category === 'BATCH_EXPIRY'));
});

test('Auth profile field sanitization clamps long names/URLs and normalizes email', () => {
  const longName = 'A'.repeat(160);
  const longPhoto = `https://example.com/${'x'.repeat(600)}`;
  const sanitized = sanitizeAuthProfileFields({
    email: '  Fakhra.Riefal@DomestiqHub.com ',
    displayName: longName,
    photoURL: longPhoto,
  });
  assert.equal(sanitized.emailLower, 'fakhra.riefal@domestiqhub.com');
  assert.equal(sanitized.displayName.length, 120);
  assert.equal(sanitized.photoURL, '');

  const fallback = sanitizeAuthProfileFields({
    email: 'investor@domestiqhub.com',
    displayName: '   ',
    photoURL: 'https://example.com/avatar.png',
  });
  assert.equal(fallback.displayName, 'investor');
  assert.equal(fallback.photoURL, 'https://example.com/avatar.png');
});

test('Firebase auth error formatter translates permission and popup codes into clear Indonesian messages', () => {
  const permJson = JSON.stringify({
    error: 'Missing or insufficient permissions.',
    operationType: 'write',
    path: 'users/abc',
  });
  assert.match(formatFirebaseAuthErrorMessage(new Error(permJson)), /Akses profil Firestore ditolak/);
  assert.match(
    formatFirebaseAuthErrorMessage(new Error('Firebase: Error (auth/popup-closed-by-user).')),
    /Popup login Google ditutup/
  );
});

test('Mobile auth redirect fallback triggers only outside embedded iframes for popup-blocked environments', () => {
  assert.equal(shouldFallbackToRedirectAuth({ code: 'auth/popup-blocked' }, false), true);
  assert.equal(
    shouldFallbackToRedirectAuth({ code: 'auth/operation-not-supported-in-this-environment' }, false),
    true
  );
  assert.equal(shouldFallbackToRedirectAuth({ code: 'auth/popup-blocked' }, true), false);
  assert.equal(shouldFallbackToRedirectAuth({ code: 'auth/popup-closed-by-user' }, false), false);

  assert.equal(
    isLikelyMobileUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'),
    true
  );
  assert.equal(
    isLikelyMobileUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'),
    false
  );
});

test('Empty database reset state starts completely clean across all operational and accounting collections', () => {
  const empty = createEmptyErpState();
  assert.equal(empty.suppliers.length, 0);
  assert.equal(empty.customers.length, 0);
  assert.equal(empty.warehouses.length, 0);
  assert.equal(empty.categories.length, 0);
  assert.equal(empty.uoms.length, 0);
  assert.equal(empty.products.length, 0);
  assert.equal(empty.purchaseOrders.length, 0);
  assert.equal(empty.salesOrders.length, 0);
  assert.equal(empty.salesQuotations.length, 0);
  assert.equal(empty.vendorRfqs.length, 0);
  assert.equal(empty.goodsReturns.length, 0);
  assert.equal(empty.inventoryBatches.length, 0);
  assert.equal(empty.periodClosings.length, 0);
  assert.equal(empty.budgets.length, 0);
  assert.equal(empty.stockMovements.length, 0);
  assert.equal(empty.invoices.length, 0);
  assert.equal(empty.chartOfAccounts.length, 0);
  assert.equal(empty.journalEntries.length, 0);
  assert.equal(empty.auditLogs.length, 0);
  assert.equal(empty.notifications.length, 0);

  const emptyMonthly = computeMonthlyPerformance([], [], [], [], empty.settings.defaultExchangeRateUsdIdr);
  assert.equal(emptyMonthly.months.length, 0);
  assert.equal(computeBudgetVsActual(empty.budgets, emptyMonthly, 'id').length, 0);
  const emptyVat = computeVatReconciliation(empty.invoices, empty.goodsReturns, 16200, 'ALL');
  assert.equal(emptyVat.netVatPayableIdr, 0);
});

test('Only Direktur holds master:users destructive delete & database reset privileges', () => {
  assert.equal(hasPermission('Direktur', 'master:users'), true);
  assert.equal(hasPermission('Manager', 'master:users'), false);
  assert.equal(hasPermission('Finance', 'master:users'), false);
  assert.equal(hasPermission('Purchasing', 'master:users'), false);
  assert.equal(hasPermission('Sales', 'master:users'), false);
  assert.equal(hasPermission('Warehouse', 'master:users'), false);
  assert.equal(hasPermission('Viewer', 'master:users'), false);
  assert.equal(hasPermission('Angel Investor', 'master:users'), false);
});

test('Company PKP status controls effective tax rate and VAT reconciliation totals', () => {
  const empty = createEmptyErpState();
  assert.equal(isCompanyPkp(empty.settings), false);
  assert.equal(getEffectiveTaxRatePercent(empty.settings), 0);

  const pkpSettings = { ...empty.settings, isPkp: true, taxRatePercent: 11 };
  assert.equal(isCompanyPkp(pkpSettings), true);
  assert.equal(getEffectiveTaxRatePercent(pkpSettings), 11);

  const nonPkpOrderTotals = calculateOrderTotals(
    [{ qty: 2, unitPrice: 500000 }],
    getEffectiveTaxRatePercent(empty.settings)
  );
  assert.equal(nonPkpOrderTotals.subtotal, 1000000);
  assert.equal(nonPkpOrderTotals.taxAmount, 0);
  assert.equal(nonPkpOrderTotals.totalAmount, 1000000);

  const seed = createInitialSeedState();
  const vatNonPkp = computeVatReconciliation(seed.invoices, [], 16200, 'ALL', {
    isPkp: false,
    taxRatePercent: 0,
  });
  assert.equal(vatNonPkp.netPpnKeluaranIdr, 0);
  assert.equal(vatNonPkp.netPpnMasukanIdr, 0);
  assert.equal(vatNonPkp.netVatPayableIdr, 0);
  assert.equal(vatNonPkp.statusLabel, 'Nihil');
});

test('Supplier categories normalize cleanly by trimming, deduplicating, and falling back to defaults', () => {
  const defaults = normalizeSupplierCategories([]);
  assert.ok(defaults.length > 0);
  const custom = normalizeSupplierCategories([
    '  Logistik & Ekspedisi ',
    'ATK & Packaging',
    'Logistik & Ekspedisi',
    '',
  ]);
  assert.deepEqual(custom, ['Logistik & Ekspedisi', 'ATK & Packaging']);
});

test('Service / Non-Stok items are excluded from stock valuation, low stock, stock availability, and split separately for Expense posting', () => {
  const seed = createInitialSeedState();
  const serviceProd = {
    ...seed.products[0],
    id: 'prod_ongkir',
    sku: 'SRV-ONGKIR',
    name: 'Biaya Pengiriman Ekspedisi',
    isService: true,
    buyPrice: 250000,
    sellPrice: 300000,
    minStock: 10,
    maxStock: 100,
    warehouseStocks: { [seed.warehouses[0].id]: 0 },
  };
  const products = [seed.products[0], serviceProd];

  assert.equal(isLowStockProduct(serviceProd), false);
  const valWithoutSvc = calculateTotalStockValueIdr([seed.products[0]], 16200);
  const valWithSvc = calculateTotalStockValueIdr(products, 16200);
  assert.equal(valWithSvc, valWithoutSvc);

  const stockCheck = checkSoStockAvailability(
    [{ productId: serviceProd.id, qty: 3, fulfilledQty: 0 }],
    seed.warehouses[0].id,
    products
  );
  assert.equal(stockCheck.sufficient, true);
  assert.equal(stockCheck.shortages.length, 0);

  const adHocOngkir = {
    productId: 'svc_ongkir',
    sku: 'SRV-ONGKIR',
    productName: 'Ongkos Kirim',
    uomCode: 'Trip',
    qty: 1,
    fulfilledQty: 0,
    unitPrice: 150000,
    lineTotal: 150000,
    isService: true,
  };
  const stockLine = {
    productId: seed.products[0].id,
    sku: seed.products[0].sku,
    productName: seed.products[0].name,
    uomCode: seed.products[0].uomCode,
    qty: 2,
    fulfilledQty: 0,
    unitPrice: 100000,
    lineTotal: 200000,
  };
  assert.equal(isServiceOrderItem(adHocOngkir, products), true);
  assert.equal(isServiceOrderItem(stockLine, products), false);

  const split = splitOrderSubtotalByService([stockLine, adHocOngkir], products);
  assert.equal(split.stockSubtotal, 200000);
  assert.equal(split.serviceSubtotal, 150000);
  assert.equal(split.stockSubtotal + split.serviceSubtotal, 350000);

  const contrib = buildExecutiveContributions({
    purchaseOrders: [],
    salesOrders: [],
    products: [serviceProd],
    usdToIdrRate: 16200,
  });
  assert.equal(contrib.stockByCategory.length, 0);
});

test('Multiple manual service rows (SRV-MANUAL) stay non-stock, sum cleanly, and split for Beban Operasional', () => {
  const seed = createInitialSeedState();
  const stockProd = seed.products[0];

  const svcAngkut = {
    productId: 'svc_1764140000001_ab12',
    sku: 'SRV-MANUAL',
    productName: 'Jasa Angkut Gudang',
    uomCode: 'JASA',
    qty: 1,
    fulfilledQty: 0,
    unitPrice: 175000,
    lineTotal: 175000,
    isService: true,
  };
  const svcPacking = {
    productId: 'svc_1764140000002_cd34',
    sku: 'SRV-MANUAL',
    productName: 'Biaya Packing Kayu',
    uomCode: 'JASA',
    qty: 2,
    fulfilledQty: 0,
    unitPrice: 50000,
    lineTotal: 100000,
    isService: true,
  };
  const stockLine = {
    productId: stockProd.id,
    sku: stockProd.sku,
    productName: stockProd.name,
    uomCode: stockProd.uomCode,
    qty: 3,
    fulfilledQty: 0,
    unitPrice: 100000,
    lineTotal: 300000,
    isService: false,
  };

  assert.equal(isServiceOrderItem(svcAngkut, seed.products), true);
  assert.equal(isServiceOrderItem(svcPacking, seed.products), true);
  assert.equal(isServiceOrderItem(stockLine, seed.products), false);

  const avail = checkSoStockAvailability(
    [stockLine, svcAngkut, svcPacking],
    seed.warehouses[0].id,
    seed.products
  );
  assert.equal(avail.shortages.some((s) => s.productId.startsWith('svc_')), false);

  const split = splitOrderSubtotalByService([stockLine, svcAngkut, svcPacking], seed.products);
  assert.equal(split.stockSubtotal, 300000);
  assert.equal(split.serviceSubtotal, 275000);

  const nonPkpTotals = calculateOrderTotals([stockLine, svcAngkut, svcPacking], 0);
  assert.equal(nonPkpTotals.subtotal, 575000);
  assert.equal(nonPkpTotals.taxAmount, 0);
  assert.equal(nonPkpTotals.totalAmount, 575000);

  const pkpTotals = calculateOrderTotals([stockLine, svcAngkut, svcPacking], 11);
  assert.equal(pkpTotals.subtotal, 575000);
  assert.equal(pkpTotals.taxAmount, 63250);
  assert.equal(pkpTotals.totalAmount, 638250);
});


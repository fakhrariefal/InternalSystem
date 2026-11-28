import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findSeededDummyAccountingTargets,
  findSeededDummyMasterTargets,
  findSeededDummyOrderTargets,
} from './erpLogic';
import { createInitialSeedState } from './seedData';
import { deterministicUuid, remapSeedStateForCompany } from './seedRemapper';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('deterministicUuid generates valid RFC-4122 UUIDs isolated per company', () => {
  const a1 = deterministicUuid('11111111-1111-4111-8111-111111111111', 'product', 'prd_1');
  const a2 = deterministicUuid('11111111-1111-4111-8111-111111111111', 'product', 'prd_1');
  const b1 = deterministicUuid('22222222-2222-4222-8222-222222222222', 'product', 'prd_1');
  assert.match(a1, UUID_REGEX);
  assert.equal(a1, a2);
  assert.notEqual(a1, b1);
});

test('remapSeedStateForCompany converts every entity ID and FK to valid UUIDs with zero broken references', () => {
  const companyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const rawSeed = createInitialSeedState();
  const remapped = remapSeedStateForCompany(rawSeed, companyId, actorId);

  const whIds = new Set(remapped.warehouses.map((w) => w.id));
  const catIds = new Set(remapped.categories.map((c) => c.id));
  const supIds = new Set(remapped.suppliers.map((s) => s.id));
  const cusIds = new Set(remapped.customers.map((c) => c.id));
  const prodIds = new Set(remapped.products.map((p) => p.id));
  const coaIds = new Set(remapped.chartOfAccounts.map((a) => a.id));
  const poIds = new Set(remapped.purchaseOrders.map((p) => p.id));
  const qtIds = new Set(remapped.salesQuotations.map((q) => q.id));

  for (const w of remapped.warehouses) assert.match(w.id, UUID_REGEX);
  for (const c of remapped.categories) assert.match(c.id, UUID_REGEX);
  for (const u of remapped.uoms) assert.match(u.id, UUID_REGEX);

  for (const s of remapped.suppliers) {
    assert.match(s.id, UUID_REGEX);
    assert.equal(s.createdBy, actorId);
  }
  for (const cu of remapped.customers) {
    assert.match(cu.id, UUID_REGEX);
    assert.equal(cu.createdBy, actorId);
    for (const tier of cu.contractPrices || []) {
      assert.ok(prodIds.has(tier.productId), `Customer contract price product ${tier.productId} missing`);
    }
  }
  for (const p of remapped.products) {
    assert.match(p.id, UUID_REGEX);
    assert.ok(catIds.has(p.categoryId), `Product categoryId ${p.categoryId} not remapped`);
    for (const whKey of Object.keys(p.warehouseStocks)) {
      assert.ok(whIds.has(whKey), `Product warehouseStocks key ${whKey} not remapped`);
    }
  }
  for (const po of remapped.purchaseOrders) {
    assert.match(po.id, UUID_REGEX);
    assert.ok(supIds.has(po.supplierId));
    assert.ok(whIds.has(po.warehouseId));
    for (const item of po.items) {
      assert.ok(prodIds.has(item.productId) || item.isService);
    }
    for (const log of po.logs || []) {
      assert.match(log.id, UUID_REGEX);
      assert.equal(log.actorId, actorId);
    }
  }
  for (const so of remapped.salesOrders) {
    assert.match(so.id, UUID_REGEX);
    assert.ok(cusIds.has(so.customerId));
    assert.ok(whIds.has(so.warehouseId));
    if (so.quotationId) assert.ok(qtIds.has(so.quotationId));
  }
  for (const rfq of remapped.vendorRfqs) {
    assert.match(rfq.id, UUID_REGEX);
    assert.ok(whIds.has(rfq.warehouseId));
    for (const sid of rfq.invitedSupplierIds) assert.ok(supIds.has(sid));
    if (rfq.awardedSupplierId) assert.ok(supIds.has(rfq.awardedSupplierId));
    if (rfq.awardedPoId) assert.ok(poIds.has(rfq.awardedPoId));
  }
  for (const j of remapped.journalEntries) {
    assert.match(j.id, UUID_REGEX);
    for (const line of j.lines) {
      assert.ok(coaIds.has(line.accountId), `Journal accountId ${line.accountId} missing in CoA`);
    }
  }

  // Verify Hapus Dummy targets work against remapped Supabase IDs
  const dummyMaster = findSeededDummyMasterTargets(remapped, remapped);
  assert.equal(dummyMaster.totalCount, remapped.products.length + remapped.suppliers.length + remapped.customers.length + remapped.warehouses.length + remapped.categories.length + remapped.uoms.length);

  const dummyOrders = findSeededDummyOrderTargets(remapped, remapped);
  assert.equal(dummyOrders.totalCount, remapped.purchaseOrders.length + remapped.salesOrders.length);

  const dummyJrn = findSeededDummyAccountingTargets(remapped, remapped);
  assert.equal(dummyJrn.length, remapped.journalEntries.length);
});

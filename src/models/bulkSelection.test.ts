import assert from 'node:assert/strict';
import test from 'node:test';
import {
  areAllVisibleSelected,
  areSomeVisibleSelected,
  countSelectedVisible,
  pickSelectedItems,
  pruneSelectedIds,
  toggleSelectAllVisible,
  toggleSelectedId,
} from './bulkSelection';

test('toggleSelectedId adds and removes single IDs without mutating original set', () => {
  const initial = new Set<string>(['a']);
  const added = toggleSelectedId(initial, 'b');
  assert.deepEqual(Array.from(initial), ['a']);
  assert.deepEqual(Array.from(added), ['a', 'b']);

  const removed = toggleSelectedId(added, 'a');
  assert.deepEqual(Array.from(removed), ['b']);
});

test('areAllVisibleSelected and areSomeVisibleSelected handle empty, partial, and full selections', () => {
  const emptyVisible: string[] = [];
  assert.equal(areAllVisibleSelected(emptyVisible, new Set(['a'])), false);
  assert.equal(areSomeVisibleSelected(emptyVisible, new Set(['a'])), false);

  const visible = ['po-1', 'po-2', 'po-3'];
  assert.equal(areAllVisibleSelected(visible, new Set()), false);
  assert.equal(areSomeVisibleSelected(visible, new Set()), false);

  const partial = new Set(['po-2']);
  assert.equal(areAllVisibleSelected(visible, partial), false);
  assert.equal(areSomeVisibleSelected(visible, partial), true);
  assert.equal(countSelectedVisible(visible, partial), 1);

  const full = new Set(['po-1', 'po-2', 'po-3', 'hidden-99']);
  assert.equal(areAllVisibleSelected(visible, full), true);
  assert.equal(areSomeVisibleSelected(visible, full), false);
  assert.equal(countSelectedVisible(visible, full), 3);
});

test('toggleSelectAllVisible toggles only visible IDs while preserving off-filter selections', () => {
  const visible = ['so-1', 'so-2'];
  const existing = new Set(['off-filter']);

  const selectedAll = toggleSelectAllVisible(visible, existing);
  assert.equal(selectedAll.has('so-1'), true);
  assert.equal(selectedAll.has('so-2'), true);
  assert.equal(selectedAll.has('off-filter'), true);

  const deselectedVisible = toggleSelectAllVisible(visible, selectedAll);
  assert.equal(deselectedVisible.has('so-1'), false);
  assert.equal(deselectedVisible.has('so-2'), false);
  assert.equal(deselectedVisible.has('off-filter'), true);
});

test('pruneSelectedIds removes deleted or out-of-scope IDs and keeps reference when unchanged', () => {
  const selected = new Set(['id-1', 'id-2', 'deleted-3']);
  const pruned = pruneSelectedIds(selected, ['id-1', 'id-2', 'id-4']);
  assert.deepEqual(Array.from(pruned), ['id-1', 'id-2']);

  const unchanged = pruneSelectedIds(pruned, ['id-1', 'id-2', 'id-4']);
  assert.equal(unchanged, pruned);
});

test('pickSelectedItems returns selected items preserving list order', () => {
  const rows = [
    { id: 'r1', code: 'A' },
    { id: 'r2', code: 'B' },
    { id: 'r3', code: 'C' },
  ];
  const picked = pickSelectedItems(rows, new Set(['r3', 'r1']));
  assert.deepEqual(
    picked.map((x) => x.code),
    ['A', 'C']
  );
});

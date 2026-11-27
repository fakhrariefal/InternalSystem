export function toggleSelectedId(selected: Set<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

export function areAllVisibleSelected(
  visibleIds: readonly string[],
  selected: Set<string>
): boolean {
  if (visibleIds.length === 0) return false;
  for (const id of visibleIds) {
    if (!selected.has(id)) return false;
  }
  return true;
}

export function areSomeVisibleSelected(
  visibleIds: readonly string[],
  selected: Set<string>
): boolean {
  if (visibleIds.length === 0) return false;
  let anySelected = false;
  let allSelected = true;
  for (const id of visibleIds) {
    if (selected.has(id)) {
      anySelected = true;
    } else {
      allSelected = false;
    }
  }
  return anySelected && !allSelected;
}

export function countSelectedVisible(
  visibleIds: readonly string[],
  selected: Set<string>
): number {
  let count = 0;
  for (const id of visibleIds) {
    if (selected.has(id)) count += 1;
  }
  return count;
}

export function toggleSelectAllVisible(
  visibleIds: readonly string[],
  selected: Set<string>
): Set<string> {
  const next = new Set(selected);
  if (visibleIds.length === 0) return next;

  const allSelected = areAllVisibleSelected(visibleIds, selected);
  if (allSelected) {
    for (const id of visibleIds) {
      next.delete(id);
    }
  } else {
    for (const id of visibleIds) {
      next.add(id);
    }
  }
  return next;
}

export function pruneSelectedIds(
  selected: Set<string>,
  validIds: readonly string[]
): Set<string> {
  if (selected.size === 0) return selected;
  const validSet = new Set(validIds);
  let changed = false;
  const next = new Set<string>();
  for (const id of selected) {
    if (validSet.has(id)) {
      next.add(id);
    } else {
      changed = true;
    }
  }
  return changed ? next : selected;
}

export function pickSelectedItems<T extends { id: string }>(
  items: readonly T[],
  selected: Set<string>
): T[] {
  if (selected.size === 0) return [];
  return items.filter((item) => selected.has(item.id));
}

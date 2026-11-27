import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  areAllVisibleSelected,
  areSomeVisibleSelected,
  countSelectedVisible,
  pickSelectedItems,
  pruneSelectedIds,
  toggleSelectAllVisible,
  toggleSelectedId,
} from '../models/bulkSelection';

export function useBulkSelection(validIds: readonly string[], visibleIds?: readonly string[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const effectiveVisibleIds = visibleIds ?? validIds;
  const validSignature = useMemo(() => validIds.join('\u0001'), [validIds]);

  useEffect(() => {
    setSelectedIds((prev) => pruneSelectedIds(prev, validIds));
    // validSignature tracks exact membership of validIds without array identity churn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validSignature]);

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) => toggleSelectedId(prev, id));
  }, []);

  const toggleAllVisible = useCallback(() => {
    setSelectedIds((prev) => toggleSelectAllVisible(effectiveVisibleIds, prev));
  }, [effectiveVisibleIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const allVisibleSelected = useMemo(
    () => areAllVisibleSelected(effectiveVisibleIds, selectedIds),
    [effectiveVisibleIds, selectedIds]
  );

  const someVisibleSelected = useMemo(
    () => areSomeVisibleSelected(effectiveVisibleIds, selectedIds),
    [effectiveVisibleIds, selectedIds]
  );

  const selectedVisibleCount = useMemo(
    () => countSelectedVisible(effectiveVisibleIds, selectedIds),
    [effectiveVisibleIds, selectedIds]
  );

  const pickSelected = useCallback(
    <T extends { id: string }>(items: readonly T[]): T[] => pickSelectedItems(items, selectedIds),
    [selectedIds]
  );

  return {
    selectedIds,
    selectedCount: selectedIds.size,
    selectedVisibleCount,
    isSelected,
    allVisibleSelected,
    someVisibleSelected,
    toggleOne,
    toggleAllVisible,
    clearSelection,
    pickSelected,
  };
}

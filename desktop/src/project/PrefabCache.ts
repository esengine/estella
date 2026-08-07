// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  PrefabCache.ts
 * @brief Loaded `.esprefab` content, and the synchronous resolver expansion needs.
 *
 * `flattenPrefab` walks a variant's base and every `nestedPrefab` in one pass and
 * cannot await, so {@link load} warms every reachable dependency up front and
 * {@link resolveSync} reads them out of memory.
 *
 * Separate from {@link AssetRegistry}: that says where an asset is, from a scan;
 * this holds content, invalidated per file. A lookup-table rebuild must not drop
 * loaded prefabs, which is what an incremental rescan turns on.
 */
import { migratePrefabData, validateOverrides } from 'esengine';
import type { PrefabData, SceneData, PrefabOverride, StaleOverride } from 'esengine';
import { AssetRegistry, UUID_PREFIX } from './AssetRegistry';
import { usePrefabConflicts } from '@/store/prefabConflicts';
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';

class PrefabCacheImpl {
  /** ref (`@uuid:`) → the loaded `.esprefab`. */
  private readonly byRef = new Map<string, PrefabData>();

  /**
   * Load a `.esprefab` by ref, cached, warming its base and every nested
   * reference so {@link resolveSync} can answer for all of them.
   */
  async load(ref: string): Promise<PrefabData | null> {
    if (!ref.startsWith(UUID_PREFIX)) return null;
    const cached = this.byRef.get(ref);
    if (cached) return cached;
    const path = AssetRegistry.pathForUuid(ref.slice(UUID_PREFIX.length).toLowerCase());
    if (!path) return null;
    try {
      const prefab = migratePrefabData(JSON.parse(await window.estella.fs.read(path))).data as PrefabData;
      // Cache BEFORE warming deps so a variant/nested ref CYCLE terminates (the
      // second visit hits the cache and returns instead of re-fetching forever).
      this.byRef.set(ref, prefab);
      await this.warm(prefab);
      return prefab;
    } catch (err) {
      console.warn('[project] prefab load failed', path, err);
      return null;
    }
  }

  /** Recursively load a prefab's base (variant `basePrefab`) + every entity's
   *  `nestedPrefab` ref into the cache. flattenPrefab resolves those SYNChronously
   *  during expansion, so they must already be resident. */
  private async warm(prefab: PrefabData): Promise<void> {
    if (prefab.basePrefab) await this.load(prefab.basePrefab);
    for (const e of prefab.entities) {
      const nested = e.nestedPrefab?.prefabPath;
      if (nested) await this.load(nested);
    }
  }

  /** Synchronous prefab resolver for flattenPrefab's variant / nested expansion —
   *  a cache read (the async {@link load} pre-warms every dependency). Passed to
   *  the scene-load + instantiate paths so a variant / nested instance resolves
   *  its base the same way in both.
   *
   *  An arrow property, not a method: it is handed around as a bare callback. */
  resolveSync = (ref: string): PrefabData | null => this.byRef.get(ref) ?? null;

  /** The entity carrying `prefabId` inside a cached prefab, if it is loaded. */
  entityOf(ref: string, prefabId: string): PrefabData['entities'][number] | undefined {
    return this.byRef.get(ref)?.entities.find((e) => e.prefabEntityId === prefabId);
  }

  /** Record a prefab this editor just wrote, so the next expansion sees the new
   *  content without a disk round-trip. */
  put(ref: string, prefab: PrefabData): void {
    this.byRef.set(ref, prefab);
  }

  /** Drop everything — a full rescan, or a pass that rewrote every prefab on disk. */
  clear(): void {
    this.byRef.clear();
  }

  /** Drop ONE prefab, so the next {@link load} re-reads it. For a caller that
   *  knows the file changed and must not wait for the rescan that would also
   *  notice — a reload racing an eviction reads the copy it is replacing. */
  forget(ref: string): void {
    this.byRef.delete(ref);
  }

  /**
   * Evict only the prefabs whose FILE changed or went away, given the paths a
   * rescan reported and the set it still knows about.
   *
   * Selective on purpose: an incremental rescan fires on any disk touch, and
   * dropping the whole cache there means a scene save re-reads every `.esprefab`
   * the open scene instantiates.
   */
  evictChanged(changed: ReadonlySet<string>, kept: ReadonlySet<string>): void {
    for (const ref of [...this.byRef.keys()]) {
      const p = AssetRegistry.pathForUuid(ref.slice(UUID_PREFIX.length).toLowerCase());
      if (!p || changed.has(p) || !kept.has(p)) this.byRef.delete(ref);
    }
  }

  /**
   * Scan a raw scene's prefab-instance entries for STALE overrides — ones that
   * target an entity / component the prefab no longer has. The loader silently
   * drops them (the customization vanishes with no trace), so record them per
   * instance root ({@link usePrefabConflicts}) for the Inspector to surface. Only
   * FLAT bases are checked: validateOverrides is structural, so a variant / nested
   * base (whose inherited entities live in ITS base) would false-positive.
   */
  reportStaleOverrides(raw: SceneData): void {
    const byInstance = new Map<number, StaleOverride[]>();
    for (const e of raw.entities as unknown[]) {
      const entry = e as { id?: number; prefab?: string; overrides?: PrefabOverride[] };
      if (typeof entry.prefab !== 'string' || !entry.overrides?.length || typeof entry.id !== 'number') continue;
      const base = this.byRef.get(entry.prefab);
      if (!base || base.basePrefab || base.entities.some((be) => be.nestedPrefab)) continue;
      const { stale } = validateOverrides(base, { instanceOverrides: entry.overrides });
      if (stale.length > 0) byInstance.set(entry.id, stale);
    }
    usePrefabConflicts.getState().setAll(byInstance);
    const total = usePrefabConflicts.getState().total;
    if (total > 0) {
      console.warn(
        `[prefab] ${total} stale override(s) on ${byInstance.size} instance(s) reference prefab ` +
        `structure that no longer exists — dropped on load. Select an affected instance to review, ` +
        `or save to persist the cleanup.`,
      );
      Toasts.push(t('proj.staleOverrides', { overrides: total, instances: byInstance.size }), 'warn', 4500);
    }
  }
}

/** The open project's loaded prefab assets. */
export const PrefabCache = new PrefabCacheImpl();

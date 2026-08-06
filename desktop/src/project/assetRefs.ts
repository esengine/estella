// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  assetRefs.ts
 * @brief Reverse lookup over the asset dependency graph — "which scenes/prefabs
 *        reference this asset" — so deleting an in-use asset can warn first. The
 *        graph (`deps`) is built main-side (assetDb) expressly for delete-detection;
 *        this is the pure, testable consumer.
 */

/** The structural slice of the asset index this needs (uuid↔path + dep edges). */
export interface AssetIndexLike {
  entries: Array<{ uuid: string; path: string }>;
  deps: Record<string, string[]>;
}

/** An index inverted once, then asked about as many assets as you like. */
export interface ReverseRefs {
  /** The uuid minted for the asset at a path, or null if it isn't a tracked asset. */
  uuidOf(path: string): string | null;
  /** Project-relative paths of the documents referencing the asset at `path`. */
  referrersOf(path: string): string[];
}

/**
 * Invert the dep graph once.
 *
 * {@link referencingPaths} rebuilds a uuid→path map of the WHOLE project and
 * walks every dep edge on each call. That is the right shape for one asset and
 * quadratic for a selection: deleting a folder of sprites asked the same
 * 36k-entry question once per file.
 */
export function reverseRefs(index: AssetIndexLike): ReverseRefs {
  const pathOfUuid = new Map(index.entries.map((e) => [e.uuid, e.path] as const));
  const uuidOfPath = new Map(index.entries.map((e) => [e.path, e.uuid] as const));
  const referrers = new Map<string, string[]>();
  for (const [uuid, refs] of Object.entries(index.deps)) {
    const from = pathOfUuid.get(uuid);
    if (!from) continue;
    // A document naming the same asset twice is one referrer, not two.
    for (const ref of new Set(refs)) {
      const arr = referrers.get(ref);
      if (arr) arr.push(from);
      else referrers.set(ref, [from]);
    }
  }
  return {
    uuidOf: (path) => uuidOfPath.get(path) ?? null,
    referrersOf: (path) => {
      const target = uuidOfPath.get(path);
      if (!target) return [];
      return (referrers.get(target) ?? []).filter((p) => p !== path);
    },
  };
}

/**
 * Project-relative paths of the scenes/prefabs that reference the asset at `path`.
 * Empty if `path` isn't a tracked asset (e.g. a folder) or nothing references it.
 */
export function referencingPaths(index: AssetIndexLike, path: string): string[] {
  return reverseRefs(index).referrersOf(path);
}

/** One asset/scene that references the asset being inspected or deleted. */
export interface AssetUsage {
  /** Project-relative path of the referencing document; null = the unsaved,
   *  still-untitled scene (it exists only in memory). */
  path: string | null;
  /** The reference lives in the unsaved in-memory scene, not (yet) on disk. */
  unsaved: boolean;
}

/**
 * Whether a JSON tree (a scene/asset document) references the asset identified
 * by `uuid` (as `@uuid:` or a bare uuid string) or by its exact project path
 * (path-valued slots, e.g. spine skeleton/atlas).
 */
export function valueReferencesAsset(
  value: unknown,
  target: { uuid: string | null; path: string },
): boolean {
  return referencesAny(
    value,
    new Set(target.uuid ? [target.uuid.toLowerCase()] : []),
    new Set([target.path]),
  );
}

/** One walk of a document against MANY targets — the batch's inner loop. */
function referencesAny(value: unknown, uuids: ReadonlySet<string>, paths: ReadonlySet<string>): boolean {
  const walk = (v: unknown): boolean => {
    if (typeof v === 'string') {
      if (paths.has(v)) return true;
      if (uuids.size === 0) return false;
      const body = v.startsWith('@uuid:') ? v.slice('@uuid:'.length) : v;
      return uuids.has(body.toLowerCase());
    }
    if (Array.isArray(v)) return v.some(walk);
    if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).some(walk);
    return false;
  };
  return walk(value);
}

/**
 * The full usage list for the asset at `path`: the on-disk dependency graph
 * (saved scenes/prefabs/materials/…) plus the UNSAVED in-memory scene — the
 * dep graph is built from files, so a reference added since the last save is
 * invisible to it and deleting would still break the open scene.
 */
export function collectAssetUsages(
  index: AssetIndexLike,
  path: string,
  liveScene?: { path: string | null; data: unknown } | null,
): AssetUsage[] {
  return collectAssetUsagesOfAll(index, [path], liveScene);
}

/**
 * The usage list for a whole SELECTION, over one inverted index and one walk of
 * the live scene — the delete-many shape.
 *
 * Rows are deduplicated: the dialog answers "what breaks if this goes", and one
 * scene that happens to use six of the selected sprites is one thing that breaks.
 */
export function collectAssetUsagesOfAll(
  index: AssetIndexLike,
  paths: readonly string[],
  liveScene?: { path: string | null; data: unknown } | null,
): AssetUsage[] {
  const refs = reverseRefs(index);
  const out: AssetUsage[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    for (const p of refs.referrersOf(path)) {
      if (seen.has(p)) continue;
      seen.add(p);
      out.push({ path: p, unsaved: false });
    }
  }
  if (!liveScene?.data) return out;
  // A saved copy of the same scene already reports it — one row per document.
  if (liveScene.path && seen.has(liveScene.path)) return out;
  const uuids = new Set<string>();
  for (const path of paths) {
    const uuid = refs.uuidOf(path);
    if (uuid) uuids.add(uuid.toLowerCase());
  }
  if (!referencesAny(liveScene.data, uuids, new Set(paths))) return out;
  return [...out, { path: liveScene.path, unsaved: true }];
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  assetSlots.ts
 * @brief The single registry of loadable asset slots. One entry per slot carries
 *        the `.meta` type vocabulary that resolves to it AND the live loader that
 *        fetches it. `metaTypeToSlot` (the reverse map) and the hot-load dispatch
 *        both derive from this table, so a slot can no longer name a meta-type it
 *        has no loader for (the old failure mode when two parallel switches — one
 *        meta→slot, one slot→loader — drifted). Adding a loadable type is one entry.
 */
import type { AssetsData } from 'esengine';

/** Slots whose resolved `{handle}` must be recorded where the incremental resolver
 *  looks it up — these have no live engine-side cache getter like textures. */
export type SlotRecord = 'material' | 'font' | 'mesh';

export interface AssetSlotDef {
  /** `.meta` type vocabulary values that resolve to this slot. `font` folds both
   *  `font` and `bitmapFont`; slots with no meta-type (none today) would omit it. */
  metaTypes: readonly string[];
  /** The live loader — the SAME one the scene-open preload dispatches to (one
   *  loading truth, two trigger times). `ref` preserves importer-settings keying;
   *  `path` is for file-fetched slots. */
  load(assets: AssetsData, ref: string, path: string): Promise<unknown>;
  /** When set, the loader's `{handle}` result is recorded under this kind. */
  record?: SlotRecord;
}

export const ASSET_SLOTS: Record<string, AssetSlotDef> = {
  // ref (not path): importer settings key off the original ref.
  texture: { metaTypes: ['texture'], load: (a, ref) => a.loadTexture(ref) },
  material: { metaTypes: ['material'], load: (a, ref) => a.loadMaterial(ref), record: 'material' },
  font: { metaTypes: ['font', 'bitmapFont'], load: (a, ref) => a.loadFont(ref), record: 'font' },
  // GPU geometry: a handle like a material's, so a mesh assigned after the
  // scene-open preload (or re-imported on disk) reaches the World the same way.
  mesh: { metaTypes: ['mesh'], load: (a, _ref, path) => a.load('mesh', path), record: 'mesh' },
  audio: { metaTypes: ['audio'], load: (a, ref) => a.loadAudio(ref) },
  // Video streams at runtime (play-mode only) — no edit-mode handle to preload.
  video: { metaTypes: ['video'], load: () => Promise.resolve() },
  // raw ref: the loader aliases it for component lookups.
  'anim-clip': { metaTypes: ['animclip'], load: (a, ref) => a.loadAnimClip(ref) },
  timeline: { metaTypes: ['animation'], load: (a, _ref, path) => a.loadTimeline(path) },
  tilemap: { metaTypes: ['tilemap'], load: (a, _ref, path) => a.loadTilemap(path) },
  tileset: { metaTypes: ['tileset'], load: (a, _ref, path) => a.loadTileset(path) },
  statemachine: { metaTypes: ['statemachine'], load: (a, _ref, path) => a.loadStateMachine(path) },
  behaviortree: { metaTypes: ['behaviortree'], load: (a, _ref, path) => a.loadBehaviorTree(path) },
  animatorcontroller: { metaTypes: ['animatorcontroller'], load: (a, _ref, path) => a.loadAnimatorController(path) },
};

const metaToSlot = new Map<string, string>();
for (const [slot, def] of Object.entries(ASSET_SLOTS)) {
  for (const mt of def.metaTypes) metaToSlot.set(mt, slot);
}

/** `.meta` type vocabulary → asset-slot type (what the hot loader dispatches on),
 *  or null for types no component slot references (scene/shader/spine have no slot;
 *  prefabs expand at load). */
export function metaTypeToSlot(metaType: string | undefined): string | null {
  return metaType ? metaToSlot.get(metaType) ?? null : null;
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The edit realm's one answer to "what live handle is this asset ref?".
 *
 * Two doors open a scene here — the project transport (ProjectStore) and the
 * dev/automation one (SceneLoader). Resolution belongs to the realm, not to
 * whichever of them opened the file, or they drift.
 */
import { Assets, type AssetsData } from 'esengine';
import { EngineHost } from './EngineHost';
import { Reconciler } from './Reconciler';
import { SceneStore } from './SceneStore';
import { AssetRegistry, refUuid } from '@/project/AssetRegistry';
import { ASSET_SLOTS, type SlotRecord } from '@/project/assetSlots';

/** The handle maps a scene preload produces — the subset this resolver reads. */
export interface PreloadHandles {
  textureHandles: Map<string, number>;
  materialHandles: Map<string, number>;
  fontHandles: Map<string, number>;
  meshHandles: Map<string, number>;
}

const emptyHandles = (): PreloadHandles => ({
  textureHandles: new Map(), materialHandles: new Map(),
  fontHandles: new Map(), meshHandles: new Map(),
});

class AssetBindingImpl {
  private preload: PreloadHandles | null = null;

  /** Adopt a scene preload's handles as what refs resolve against. */
  adopt(handles: PreloadHandles): void {
    this.preload = handles;
  }

  /** Wire this binding into the Reconciler. Idempotent; both scene doors call it. */
  install(): void {
    Reconciler.setAssetResolver((ref) => this.handleFor(ref));
    Reconciler.setRefPathResolver((ref) => AssetRegistry.refPath(ref));
    Reconciler.setAssetTouchListener((ref, slot) => this.hotLoad(ref, slot));
  }

  /** The live GL handle for a ref. Textures read the engine's live cache (so a
   *  just-assigned one resolves); the rest fall back to the scene preload. */
  handleFor(ref: string): number {
    const tex = EngineHost.getResource(Assets)?.getTexture(ref);
    if (tex) return tex.handle;
    const uuid = refUuid(ref);
    const path = uuid !== null ? AssetRegistry.pathForUuid(uuid) : ref;
    const r = this.preload;
    if (!path || !r) return 0;
    return r.materialHandles.get(path) ?? r.fontHandles.get(path)
        ?? r.meshHandles.get(path) ?? 0;
  }

  /** The live material handle for @p path, or 0 — the Material Editor pushes
   *  edits onto it so the viewport reflects them. */
  materialHandle(path: string): number {
    return this.preload?.materialHandles.get(path) ?? 0;
  }

  /**
   * The async half: a projection resolved `ref` COLD (assigned after the scene
   * preload, or re-written on disk). Load it through its slot's loader, then
   * re-project what references it. Deduped per registry generation, so a broken
   * ref cannot re-fetch forever.
   */
  hotLoad(ref: string, fieldType: string): void {
    const path = AssetRegistry.refPath(ref);
    if (path === null) return; // unknown uuid — diagnostics reports it; nothing to load
    const key = `${fieldType}:${path}`;
    if (AssetRegistry.hotLoadStartedFor(key)) return;
    AssetRegistry.markHotLoadStarted(key);
    const assets = EngineHost.getResource(Assets);
    if (!assets) return;
    void this.loadForSlot(assets, fieldType, ref, path)
      .then(() => {
        AssetRegistry.clearLoadFailure(path);
        Reconciler.reprojectRefs((r) => AssetRegistry.refPath(r) === path);
        SceneStore.poke();
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        AssetRegistry.noteLoadFailure(path, msg);
        console.error(`[assets] live load of ${fieldType} "${path}" failed: ${msg}`);
      });
  }

  /** Load `ref` through the loader its slot type names — the same loaders the
   *  scene-open preload dispatches to (one loading truth, two trigger times). */
  private loadForSlot(assets: AssetsData, fieldType: string, ref: string,
                      path: string): Promise<unknown> {
    const def = ASSET_SLOTS[fieldType];
    if (!def) return Promise.reject(new Error(`no live loader for asset slot type "${fieldType}"`));
    const loaded = def.load(assets, ref, path);
    if (!def.record) return loaded;
    const kind = def.record;
    return loaded.then((r) => this.record(kind, path, (r as { handle: number }).handle));
  }

  /** Record a hot-loaded handle where the incremental resolver looks it up
   *  (these slots have no live engine-side cache getter like textures). */
  private record(kind: SlotRecord, path: string, handle: number): void {
    if (!this.preload) this.preload = emptyHandles();
    const maps = this.preload;
    const target = kind === 'material' ? maps.materialHandles
      : kind === 'font' ? maps.fontHandles : maps.meshHandles;
    target.set(path, handle);
  }
}

export const AssetBinding = new AssetBindingImpl();

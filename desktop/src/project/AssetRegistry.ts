// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  AssetRegistry.ts
 * @brief The project's asset database: uuid ↔ path, plus each asset's `.meta`
 *        importer block and content-minted type, from the asset scan.
 *
 * Does NOT scan — that needs the open project, its root and its watcher, which
 * belong to ProjectStore, which feeds results in through {@link rebuild}. The
 * dependency runs one way, so a query never reaches back for a project.
 */
import { Assets, getEditorType, isBuiltinMeshRef, textureImportSettingsFrom, setTextureParams, setTextureSliceBorder, TextureFilter, TextureWrap } from 'esengine';
import { EngineHost } from '@/engine/EngineHost';
import { assetTypeOf } from '@/project/assetMeta';
import { ASSET_TYPES, assetTypeDef } from '@/project/assetTypes';
import type { AssetType } from '@/types';

export const UUID_PREFIX = '@uuid:';

// UUID v4 shape — serialized refs come in three forms: `@uuid:` (canonical),
// a BARE uuid (`.esanim` flipbook frame textures), or a plain path. A bare
// uuid must resolve through the registry like a prefixed one; treating it as
// a path guarantees a 404 (estella://project/<uuid>) and white sprites.
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The uuid carried by a ref (`@uuid:` prefixed, any body — explicit intent —
 *  or bare-but-uuid-shaped), else null for plain paths. Lower-cased. */
export function refUuid(ref: string): string | null {
  if (ref.startsWith(UUID_PREFIX)) return ref.slice(UUID_PREFIX.length).toLowerCase();
  return UUID_SHAPE.test(ref) ? ref.toLowerCase() : null;
}

/** One entry of a scanned index — the shape the main process reports. */
export type AssetEntryLite = { uuid: string; path: string; type?: string; importer?: Record<string, unknown> };

/** A pickable asset for the inspector's asset picker. */
export interface AssetEntry {
  ref: string;
  path: string;
  name: string;
  type: AssetType;
}

/** Whether an asset of the editor `type` is a valid pick for a `fieldType` slot. */
function assetMatchesSlot(type: AssetType, path: string, fieldType?: string): boolean {
  if (!fieldType) return true;
  // A 'texture' slot accepts any image (texture or sprite); others match by name.
  if (fieldType === 'texture') return type === 'texture' || type === 'sprite';
  // Spine slots split the shared 'spine' Content-Browser type into its two
  // halves, through the SDK's own classification (.skel vs .atlas) — the same
  // vocabulary the cook's dep scan uses.
  if (fieldType === 'spine-skeleton' || fieldType === 'spine-atlas') {
    const named = getEditorType(path);
    if (named === 'spine-skeleton' || named === 'spine-atlas') return named === fieldType;
    // A JSON skeleton has no extension of its own — Spine 2.1 exports nothing
    // else — so what says it is one is its registered `spine` type, minted from
    // the marker inside the file. Only the skeleton half can arrive unnamed:
    // the atlas is always `.atlas`.
    return fieldType === 'spine-skeleton' && type === 'spine';
  }
  if (type === fieldType) return true;
  // Slots named in the SDK's editorType vocabulary rather than the
  // Content-Browser type name (anim-clip for .esanim, timeline for .estimeline).
  return getEditorType(path) === fieldType;
}

class AssetRegistryImpl {
  /** uuid (lower-case) → project-relative path. */
  private readonly uuidToPath = new Map<string, string>();
  /** project-relative path → uuid (lower-case). */
  private readonly pathToUuid = new Map<string, string>();
  /** uuid → the `.meta` importer block, for import settings and texture params. */
  private readonly uuidToImporter = new Map<string, Record<string, unknown>>();
  /** uuid → the type minted from the file's content (what an extension cannot say). */
  private readonly uuidToType = new Map<string, string>();
  /** path → why its last load failed, so a ref can report more than "missing". */
  private readonly loadFailures = new Map<string, string>();
  /** Refs whose live hot-load is already in flight or done — one attempt each. */
  private readonly hotLoadStarted = new Set<string>();

  // — Lifecycle, driven by ProjectStore's scan ————————————————————————————————

  /**
   * Rebuild the lookup tables from a scanned index, and point the engine's
   * `Assets` at them.
   *
   * Tables only: the prefab cache and live-load bookkeeping are deliberately left
   * alone, because the incremental path invalidates those selectively — a scene
   * save must not drop every loaded `.esprefab`.
   */
  rebuild(entries: readonly AssetEntryLite[]): void {
    this.uuidToPath.clear();
    this.pathToUuid.clear();
    this.uuidToImporter.clear();
    this.uuidToType.clear();
    for (const e of entries) {
      const uuid = e.uuid.toLowerCase();
      this.uuidToPath.set(uuid, e.path);
      this.pathToUuid.set(e.path, uuid);
      if (e.importer) this.uuidToImporter.set(uuid, e.importer);
      if (e.type) this.uuidToType.set(uuid, e.type);
    }

    const assets = EngineHost.getResource(Assets);
    if (assets) {
      assets.baseUrl = 'estella://project';
      assets.setAssetRefResolver((ref) => this.refPath(ref));
      // Edit viewport honors each texture's `.meta` filter/wrap at load — the same
      // settings the runtime applies (was runtime-only, so edit ≠ play before).
      assets.setTextureImportSettingsResolver((ref) => this.textureImportFor(ref));
    }
  }

  /** Drop what a full repopulate invalidates: every load attempt is retried. */
  clearLoadState(): void {
    this.hotLoadStarted.clear();
    this.loadFailures.clear();
  }

  /** True when this ref's one hot-load attempt has already been made. */
  hotLoadStartedFor(ref: string): boolean {
    return this.hotLoadStarted.has(ref);
  }

  markHotLoadStarted(ref: string): void {
    this.hotLoadStarted.add(ref);
  }

  noteLoadFailure(path: string, reason: string): void {
    this.loadFailures.set(path, reason);
  }

  /** A path loaded successfully — forget the last failure recorded against it. */
  clearLoadFailure(path: string): void {
    this.loadFailures.delete(path);
  }

  /** Forget the hot-load attempts made for one project path, so a changed file is
   *  loaded again. Hot-load keys are `<slot>:<path>`, one per slot the ref filled. */
  forgetHotLoadsFor(path: string): void {
    for (const key of [...this.hotLoadStarted]) if (key.endsWith(`:${path}`)) this.hotLoadStarted.delete(key);
  }

  // — Raw lookups, for callers that hold one half of the pair ————————————————

  /** The uuid a tracked path was minted with, or undefined. */
  uuidFor(path: string): string | undefined {
    return this.pathToUuid.get(path);
  }

  /** The path a uuid names, or undefined. */
  pathForUuid(uuid: string): string | undefined {
    return this.uuidToPath.get(uuid);
  }

  /** The `.meta` importer block for a uuid, or undefined. */
  importerForUuid(uuid: string): Record<string, unknown> | undefined {
    return this.uuidToImporter.get(uuid);
  }

  /** The content-minted `.meta` type for a uuid, or undefined. */
  typeForUuid(uuid: string): string | undefined {
    return this.uuidToType.get(uuid);
  }

  /** Every (uuid, path) pair. */
  entries(): IterableIterator<[string, string]> {
    return this.uuidToPath.entries();
  }

  /** Every (path, uuid) pair. */
  pathEntries(): IterableIterator<[string, string]> {
    return this.pathToUuid.entries();
  }

  /** Every tracked project path. */
  paths(): IterableIterator<string> {
    return this.uuidToPath.values();
  }

  // — Queries ————————————————————————————————————————————————————————————————

  /** The project path a ref points at, or null when the registry has no such uuid.
   *  A plain path resolves to itself. */
  refPath(ref: string): string | null {
    const uuid = refUuid(ref);
    if (uuid === null) return ref;
    return this.uuidToPath.get(uuid) ?? null;
  }

  /** The portable `@uuid:` ref for a tracked path, or null when it is not tracked. */
  assetRef(path: string): string | null {
    const uuid = this.pathToUuid.get(path);
    return uuid ? UUID_PREFIX + uuid : null;
  }

  /** Whether a path is a tracked asset at all. */
  tracks(path: string): boolean {
    return this.pathToUuid.has(path);
  }

  /** The path + leaf name behind a ref, for anything that displays one. */
  assetInfo(ref: unknown): { path: string; name: string } | null {
    if (typeof ref !== 'string' || ref.length === 0) return null;
    const path = ref.startsWith(UUID_PREFIX)
      ? this.uuidToPath.get(ref.slice(UUID_PREFIX.length).toLowerCase())
      : this.assetRef(ref)
        ? ref
        : undefined;
    return path ? { path, name: path.split('/').pop() ?? path } : null;
  }

  /**
   * The Content-Browser type of a project file — the ONE answer the picker, the
   * drag-drop guard and the browser tiles all read, so they cannot disagree about
   * what a file is.
   *
   * The name decides it wherever an extension (or a `_ske.json`-style suffix) can:
   * that claim is cheap, and holds for files the registry has never seen. Where
   * the name says nothing, the registered `.meta` type does — it was minted from
   * the file's own content, which is the only thing that can tell a Spine JSON
   * skeleton from any other `.json`.
   */
  assetTypeAt(path: string): AssetType {
    const byName = assetTypeOf(path.split('/').pop() ?? path);
    if (byName !== 'file') return byName;
    const uuid = this.pathToUuid.get(path);
    const metaType = uuid ? this.uuidToType.get(uuid) : undefined;
    return metaType && assetTypeDef(metaType) !== ASSET_TYPES.file ? (metaType as AssetType) : byName;
  }

  /** Project assets valid for an asset slot (the inspector's asset picker), by name. */
  listAssets(fieldType?: string): AssetEntry[] {
    const out: AssetEntry[] = [];
    for (const [uuid, path] of this.uuidToPath) {
      const name = path.split('/').pop() ?? path;
      const type = this.assetTypeAt(path);
      if (!assetMatchesSlot(type, path, fieldType)) continue;
      out.push({ ref: UUID_PREFIX + uuid, path, name, type });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Whether the asset at `path` is a valid pick for a `fieldType` slot — the same rule
   *  the picker popover filters by, exposed so drag-drop can reject a wrong-typed asset. */
  assetTypeAllowed(fieldType: string | undefined, path: string): boolean {
    if (!fieldType) return true;
    return assetMatchesSlot(this.assetTypeAt(path), path, fieldType);
  }

  /** Why a ref does not resolve, or null when it does. Distinguishes "no such uuid"
   *  from "registered but its load failed", which a caller cannot tell apart from
   *  a null path. */
  assetRefProblem(ref: string): string | null {
    if (isBuiltinMeshRef(ref)) return null;
    const uuid = refUuid(ref);
    const path = uuid !== null ? (this.uuidToPath.get(uuid) ?? null) : ref;
    if (path === null) return 'unresolved: no asset with this uuid in the registry';
    if (uuid === null && !this.pathToUuid.has(path)) {
      return `unresolved: "${path}" is not a registered asset`;
    }
    const failure = this.loadFailures.get(path);
    return failure ? `load failed: ${failure}` : null;
  }

  /**
   * Turn a Content-Browser drag (a project-relative path) into a portable
   * `@uuid:` ref, preloading the asset so the Reconciler's synchronous projection
   * finds its handle when the model field is set. Textures resolve live; other
   * types are best-effort (resolved at scene load). Returns null if the path
   * isn't a tracked asset.
   */
  async assetRefForPath(path: string, assetType?: string): Promise<string | null> {
    const uuid = this.pathToUuid.get(path);
    if (!uuid) return null;
    const ref = UUID_PREFIX + uuid;
    // Spine slots are path-valued: nothing to preload here — the spine binding
    // (skeleton + atlas + pages) loads as a pair when the component syncs.
    if (assetType === 'spine-skeleton' || assetType === 'spine-atlas') return ref;
    const assets = EngineHost.getResource(Assets);
    if (assets) {
      try {
        if (assetType === 'material') await assets.loadMaterial(ref);
        else if (assetType === 'font') await assets.loadFont(ref);
        else await assets.loadTexture(ref);
      } catch {
        // non-loadable for this slot — the field still stores the ref losslessly
      }
    }
    return ref;
  }

  /** A texture's parsed `.meta` import settings, by ref or by path. */
  textureImportFor(ref: string): ReturnType<typeof textureImportSettingsFrom> {
    const uuid = refUuid(ref) ?? this.pathToUuid.get(ref);
    return textureImportSettingsFrom(uuid ? this.uuidToImporter.get(uuid) : undefined);
  }

  /** The raw `.meta` importer block for a path, or undefined. */
  importerFor(path: string): Record<string, unknown> | undefined {
    const uuid = this.pathToUuid.get(path);
    return uuid ? this.uuidToImporter.get(uuid) : undefined;
  }

  /**
   * Push a texture's just-saved import settings to its LIVE gl handle so the edit
   * viewport reflects a filter/wrap change immediately — no scene reload / sprite
   * repoint (the handle is updated in place; sprites keep referencing it). Call
   * after the asset inspector writes the `.meta` + a refresh.
   */
  applyLiveTextureSettings(path: string): void {
    const uuid = this.pathToUuid.get(path);
    const s = textureImportSettingsFrom(uuid ? this.uuidToImporter.get(uuid) : undefined);
    const handle = uuid ? EngineHost.getResource(Assets)?.getTexture(UUID_PREFIX + uuid)?.handle : undefined;
    if (!s || !handle) return;
    const filter = s.filter === 'nearest' ? TextureFilter.Nearest : TextureFilter.Linear;
    const wrap =
      s.wrap === 'clamp' ? TextureWrap.ClampToEdge : s.wrap === 'mirror' ? TextureWrap.MirroredRepeat : TextureWrap.Repeat;
    setTextureParams(handle, filter, filter, wrap, wrap);
    // The 9-slice border is applied at load; re-stamp it so dragging a border in
    // the asset inspector re-slices the live viewport without a scene reload.
    if (s.sliceBorder) {
      const b = s.sliceBorder;
      setTextureSliceBorder(handle, b.left, b.right, b.top, b.bottom);
    }
  }
}

/** The open project's asset database. Empty until a project is opened. */
export const AssetRegistry = new AssetRegistryImpl();

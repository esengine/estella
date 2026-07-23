// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Shared cook → AddressableManifest (v2.0) builder.
 *
 *        Reads the flat `assets.manifest.json` a cook emits and produces the
 *        AddressableManifest (groups + bundle modes + content-addressed paths +
 *        a build `revision`) the runtime's `Assets.setManifest` / `loadGroup` /
 *        hot-update consume. ONE builder for EVERY target — web, desktop, and
 *        mini-game all get the same addressable model, so `loadGroup` and hot-
 *        update are platform-uniform (historically only the mini-game export
 *        emitted a v2.0 manifest; web/desktop shipped only the flat v1.0 one).
 *
 *        Pure Node (fs). `deriveManifestRevision` is imported from the SDK source
 *        — the SAME hash the runtime reads back — so build and runtime agree by
 *        construction (mirrors how the cook imports `contentHashHex`).
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { deriveManifestRevision, type AddressableManifest } from '../../sdk/src/asset/AddressableManifest';

/** The flat v1.0 cook manifest this reads (see cookAssets `CookManifestEntry`). */
interface FlatManifest {
  entries: {
    uuid: string; path: string; sourcePath?: string; type: string;
    contentHash?: string; size?: number; group?: string; groupMode?: string;
    compressedFormats?: string[];
    atlas?: { page: number; frame: { x: number; y: number; width: number; height: number }; pageWidth: number; pageHeight: number };
  }[];
}

// Editor asset type → AddressableAssetType (sdk/src/assetTypes.ts). Feeds the
// runtime Catalog; an unmapped type degrading to 'binary' is harmless.
const ADDRESSABLE_TYPE: Record<string, string> = {
  texture: 'texture', material: 'material', audio: 'audio', 'bitmap-font': 'bitmap-font',
  prefab: 'prefab', spine: 'spine',
  scene: 'json', 'anim-clip': 'json', tilemap: 'json', timeline: 'json', json: 'json', shader: 'text',
};
export const addrType = (editorType: string): string => ADDRESSABLE_TYPE[editorType] ?? 'binary';

/** A group's bundleMode from its assets' cooked `groupMode`, with the legacy
 *  fallback (an entry without groupMode): `main` → local, else lazy subpackage. */
export function bundleModeFor(groupName: string, groupMode: string | undefined): string {
  if (groupMode === 'local' || groupMode === 'lazy' || groupMode === 'remote') return groupMode;
  return groupName === 'main' ? 'local' : 'lazy';
}

/**
 * Build the AddressableManifest (as a pretty JSON string) from a cook output
 * dir's flat `assets.manifest.json`. Each asset carries its `contentHash` + `size`
 * so the runtime dedupes by content and treats `<hash>.<ext>` as a permanently-
 * cacheable url; a top-level `revision` (hash-of-hashes) is the fast hot-update
 * gate. `size` falls back to stat() only for a legacy cook that omitted it.
 */
export async function buildAddressableManifest(absOut: string): Promise<string> {
  const flat = JSON.parse(await readFile(path.join(absOut, 'assets.manifest.json'), 'utf8')) as FlatManifest;
  type Entry = {
    path: string; address?: string; type: string; size: number; labels: string[]; contentHash?: string;
    metadata?: { atlasPage?: number; atlasFrame?: { x: number; y: number; width: number; height: number }; atlasPageWidth?: number; atlasPageHeight?: number };
  };
  type Group = { bundleMode: string; labels: string[]; assets: Record<string, Entry> };
  const groups: Record<string, Group> = {};
  for (const e of flat.entries) {
    let size = e.size ?? 0;
    if (e.size == null) { try { size = (await stat(path.join(absOut, e.path))).size; } catch { /* missing → 0 */ } }
    const groupName = e.group ?? 'main';
    const group = (groups[groupName] ??= {
      bundleMode: bundleModeFor(groupName, e.groupMode), labels: [], assets: {},
    });
    const entry: Entry = { path: e.path, type: addrType(e.type), size, labels: [] };
    if (e.contentHash) entry.contentHash = e.contentHash;
    // The logical source path rides as the asset's address: path-style refs
    // resolve through it. Only meaningful when staging renamed the file.
    if (e.sourcePath && e.sourcePath !== e.path) entry.address = e.sourcePath;
    if (e.atlas) {
      entry.metadata = {
        atlasPage: e.atlas.page, atlasFrame: e.atlas.frame,
        atlasPageWidth: e.atlas.pageWidth, atlasPageHeight: e.atlas.pageHeight,
      };
    }
    group.assets[e.uuid.toLowerCase()] = entry;
  }
  // Always emit a main group so the runtime's main package exists even if every
  // asset landed in a subpackage / remote group.
  groups.main ??= { bundleMode: 'local', labels: [], assets: {} };
  const manifest = { version: '2.0', groups } as unknown as AddressableManifest;
  manifest.revision = deriveManifestRevision(manifest);
  return JSON.stringify(manifest, null, 2) + '\n';
}

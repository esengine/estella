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
import { deriveManifestRevision, type AddressableManifest, type AddressableManifestAsset } from '../../../sdk/src/asset/AddressableManifest';
import { textureImportSettingsFrom } from '../../../sdk/src/asset/textureImportSettings';
import { spineManifestContractFrom } from '../../../sdk/src/asset/spineImportSettings';
import type { FlatCookEntry } from './cookAssets';

export const LOADER_TYPE_OF_META_TYPE: Readonly<Record<string, string>> = Object.freeze({
  imageSource: 'texture',
  soundSource: 'audio',
  musicSource: 'audio',
  animclip: 'anim-clip',
  animation: 'timeline',
  bitmapfont: 'font',
  shader: 'material-shader',
  scene: 'json',
  inputmap: 'json',
  'terrain-tiles': 'json',
  'terrain-layer-info': 'json',
  'physical-material': 'json',
  // The Groom plugin fetches a groom as text, by path; the curves it names are bytes (unloaded, below).
  groom: 'json',
});

export const UNLOADED_TYPE = 'binary';

export const UNLOADED_META_TYPES: ReadonlySet<string> = new Set([
  'video', 'dragonbones',
  'model', 'panorama', 'layered', 'animated', 'materialgraph', 'modeling', 'land', 'rig', 'curves',
]);

export const addrType = (metaType: string): string =>
  UNLOADED_META_TYPES.has(metaType) ? UNLOADED_TYPE : LOADER_TYPE_OF_META_TYPE[metaType] ?? metaType;

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
  const flat = JSON.parse(await readFile(path.join(absOut, 'assets.manifest.json'), 'utf8')) as { entries: FlatCookEntry[] };
  const groups: AddressableManifest['groups'] = {};
  // Every spelling this build knows an asset by → its key. A spine contract
  // names the atlas it was promised against however the author's metadata
  // spelled it; what ships is this build's key for that asset.
  const keyOfRef = new Map<string, string>();
  for (const e of flat.entries) {
    const key = e.uuid.toLowerCase();
    for (const spelling of [e.uuid, e.uuid.toLowerCase(), `@uuid:${e.uuid}`,
                            `@uuid:${e.uuid.toLowerCase()}`, e.path, e.sourcePath]) {
      if (spelling) keyOfRef.set(spelling, key);
    }
  }
  for (const e of flat.entries) {
    let size = e.size ?? 0;
    if (e.size == null) {
      try {
        size = (await stat(path.join(absOut, e.path))).size;
      } catch { /* missing → 0 */ }
    }
    const groupName = e.group ?? 'main';
    const group = (groups[groupName] ??= {
      bundleMode: bundleModeFor(groupName, e.groupMode), labels: [], assets: {},
    });
    const entry: AddressableManifestAsset = { path: e.path, type: addrType(e.type), size, labels: [] };
    if (e.contentHash) entry.contentHash = e.contentHash;
    // Which GPU formats the texture was encoded for. The runtime reads this off
    // the addressable manifest — the flat one it came from is a build-time
    // intermediate that no longer ships.
    if (e.compressedFormats?.length) entry.compressedFormats = e.compressedFormats;
    if (e.streamTail) entry.streamTail = e.streamTail;
    // Parsed here, not shipped raw: the runtime needs how the texture is sampled
    // and sliced, never the cook's own knobs (maxSize, compression format). This
    // is the ONLY channel a packaged build has for the `.meta` — without it a
    // 9-sliced frame stretches in the shipped game while looking right in the
    // editor.
    const textureImport = textureImportSettingsFrom(e.importer);
    if (textureImport) entry.textureImport = textureImport;
    // Same channel and the same reason: without it a shipped game poses every
    // skeleton every frame while the editor honoured the author's promise.
    const spineImport = spineManifestContractFrom(e.importer, (ref) => keyOfRef.get(ref));
    if (spineImport) entry.spineImport = spineImport;
    // The logical source path rides as the asset's address: path-style refs
    // resolve through it. Only meaningful when staging renamed the file.
    if (e.sourcePath && e.sourcePath !== e.path) entry.address = e.sourcePath;
    if (e.pack) entry.pack = e.pack;
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
  const manifest: AddressableManifest = { version: '2.0', groups };
  manifest.revision = deriveManifestRevision(manifest);
  return JSON.stringify(manifest, null, 2) + '\n';
}

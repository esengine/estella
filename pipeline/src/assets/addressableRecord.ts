// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AddressableManifestAsset } from '../../../sdk/src/asset/AddressableManifest';
import { textureImportSettingsFrom } from '../../../sdk/src/asset/textureImportSettings';
import { spineManifestContractFrom } from '../../../sdk/src/asset/spineImportSettings';
import { extractUuid } from '../../../sdk/src/asset/AssetRegistry';
import { resolveMeshGI } from '../../../sdk/src/gi/meshGIAssets';

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
  'model', 'panorama', 'layered', 'animated', 'materialgraph', 'modeling', 'land', 'proc', 'rig', 'curves',
]);

export const addrType = (metaType: string): string =>
  UNLOADED_META_TYPES.has(metaType) ? UNLOADED_TYPE : LOADER_TYPE_OF_META_TYPE[metaType] ?? metaType;

interface RecordSource {
  uuid: string;
  path: string;
  sourcePath?: string;
  type: string;
  labels?: string[];
  importer?: Record<string, unknown>;
}

type AddressableKey = { key: string; type?: string };

/** Index authored and staged spellings before resolving cross-asset importer settings. */
export function addressableKeys(sources: Iterable<Pick<RecordSource, 'uuid' | 'path' | 'sourcePath'> & { type?: string }>): Map<string, AddressableKey> {
  const keys = new Map<string, AddressableKey>();
  for (const { uuid, path, sourcePath, type } of sources) {
    const entry = { key: uuid.toLowerCase(), type };
    for (const ref of [uuid, entry.key, `@uuid:${uuid}`, `@uuid:${entry.key}`, path, sourcePath]) if (ref) keys.set(ref, entry);
  }
  return keys;
}

/** The authored runtime fields shared by editor Play, packaged builds and embedded playables. */
export function addressableRecord(source: RecordSource, size: number, keys: ReadonlyMap<string, AddressableKey>): AddressableManifestAsset {
  const entry: AddressableManifestAsset = { path: source.path, type: addrType(source.type), size, labels: source.labels ?? [] };
  if (source.sourcePath && source.sourcePath !== source.path) entry.address = source.sourcePath;
  const texture = textureImportSettingsFrom(source.importer);
  if (texture) entry.textureImport = texture;
  const lookup = (ref: string) => keys.get(extractUuid(ref) ?? ref);
  const spine = spineManifestContractFrom(source.importer, ref => lookup(ref)?.key);
  if (spine) entry.spineImport = spine;
  if (source.type === 'mesh' && source.importer?.meshGI !== undefined) {
    entry.meshGI = resolveMeshGI(source.sourcePath ?? source.path, source.importer.meshGI, (ref, type) => {
      const dep = lookup(ref);
      return dep?.type === type ? dep.key : undefined;
    }) ?? false;
  }
  return entry;
}

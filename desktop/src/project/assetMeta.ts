// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  assetMeta.ts
 * @brief Asset-type derivation shared by the Content Browser and the unified
 *        Details inspector (so selecting an asset resolves the same type/badge
 *        everywhere). Type is inferred from the file extension.
 */
import type { AssetType } from '@/types';

export const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

/** Asset type from a file name's extension. */
export function assetTypeOf(name: string): AssetType {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_RE.test(name)) return ext === 'png' || ext === 'webp' ? 'texture' : 'sprite';
  if (ext === 'esscene') return 'scene';
  if (ext === 'ogg' || ext === 'mp3' || ext === 'wav') return 'audio';
  if (ext === 'ts' || ext === 'js') return 'script';
  if (ext === 'atlas' || ext === 'skel') return 'spine';
  if (ext === 'esprefab') return 'prefab';
  if (ext === 'esmat') return 'material';
  // Unified animation clip (.esanim) + legacy multi-track timeline (.estimeline).
  if (ext === 'esanim' || ext === 'estimeline') return 'animation';
  if (ext === 'estileset') return 'tileset';
  if (ext === 'estilemap') return 'tilemap';
  return 'file';
}

/** Short uppercase code shown in a tile's corner badge / detail tag, per type. */
export const TYPE_CODE: Record<AssetType, string> = {
  folder: '',
  file: '',
  scene: 'SCN',
  prefab: 'PFB',
  texture: 'TEX',
  sprite: 'IMG',
  material: 'MAT',
  spine: 'SPN',
  audio: 'AUD',
  script: 'TS',
  animation: 'ANM',
  tileset: 'TST',
  tilemap: 'TMP',
};

export const baseName = (p: string) => (p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p);

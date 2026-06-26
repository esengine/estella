// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  assetTypes.ts
 * @brief The single declarative registry of editor asset types. One entry per
 *        type carries its file extensions, content-browser badge, and icon/tint;
 *        `assetTypeOf` (extension lookup), the `TYPE_CODE` badges, and the
 *        `AssetIcon`/`assetTint` glyphs all derive from it. Adding an asset type
 *        is this table + the `AssetType` union in types.ts (the `Record` keeps
 *        them in sync — a missing entry is a compile error). Double-click open
 *        actions live in assetOpen.ts, co-located with their editors to avoid
 *        import cycles.
 */
import {
  Folder, Film, Image, FileImage, PersonStanding, Music,
  Component, Blend, FileCode2, Clapperboard, Grid3x3, File, Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { AssetType } from '@/types';

export interface AssetTypeDef {
  /** Extensions (lower-case, no dot) that resolve to this type. Omitted for the
   *  virtual `folder`/`file` types, which aren't extension-derived. */
  extensions?: readonly string[];
  /** Short uppercase code shown in a tile's corner badge ('' = no badge). */
  badge: string;
  icon: LucideIcon;
  tint: string;
}

// Desaturated tints (vs candy colors) so the content browser stays scannable by
// type but reads as a professional tool.
export const ASSET_TYPES: Record<AssetType, AssetTypeDef> = {
  folder: { badge: '', icon: Folder, tint: 'var(--star)' },
  scene: { extensions: ['esscene'], badge: 'SCN', icon: Film, tint: '#c98a93' },
  texture: { extensions: ['png', 'webp'], badge: 'TEX', icon: FileImage, tint: '#7fa6c4' },
  sprite: { extensions: ['jpg', 'jpeg', 'gif'], badge: 'IMG', icon: Image, tint: '#7fa6c4' },
  spine: { extensions: ['atlas', 'skel'], badge: 'SPN', icon: PersonStanding, tint: '#9b8fc0' },
  audio: { extensions: ['ogg', 'mp3', 'wav'], badge: 'AUD', icon: Music, tint: '#7faf9c' },
  prefab: { extensions: ['esprefab'], badge: 'PFB', icon: Component, tint: '#c2a274' },
  // .esmaterial is the real extension (the SDK MaterialAssetLoader only loads it);
  // .esmat is tolerated as a legacy alias (cf. electron/importAssets.ts).
  material: { extensions: ['esmaterial', 'esmat'], badge: 'MAT', icon: Blend, tint: '#c0917a' },
  materialgraph: { extensions: ['esmatgraph'], badge: 'MGR', icon: Workflow, tint: '#c0917a' },
  script: { extensions: ['ts', 'js'], badge: 'TS', icon: FileCode2, tint: '#93a3bf' },
  // Unified animation clip (.esanim) + legacy multi-track timeline (.estimeline).
  animation: { extensions: ['esanim', 'estimeline'], badge: 'ANM', icon: Clapperboard, tint: '#9bb39a' },
  tileset: { extensions: ['estileset'], badge: 'TST', icon: Grid3x3, tint: '#9b8fc0' },
  tilemap: { extensions: ['estilemap'], badge: 'TMP', icon: Grid3x3, tint: '#7fa6c4' },
  file: { badge: '', icon: File, tint: 'var(--text-dim)' },
};

const byExt = new Map<string, AssetType>();
for (const [type, def] of Object.entries(ASSET_TYPES) as [AssetType, AssetTypeDef][]) {
  for (const ext of def.extensions ?? []) byExt.set(ext, type);
}

/** Asset type from a file name's extension; unknown extensions fall back to `file`. */
export function assetTypeOf(name: string): AssetType {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return byExt.get(ext) ?? 'file';
}

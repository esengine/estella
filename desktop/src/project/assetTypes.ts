// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  assetTypes.ts
 * @brief The single declarative registry of editor asset types. One entry per
 *        type carries its file extensions, content-browser badge, and icon/tint;
 *        `assetTypeOf` (extension lookup), the `TYPE_CODE` badges, and the
 *        `AssetIcon`/`assetTint` glyphs all derive from it. Adding an asset type
 *        is this table + the `BuiltinAssetType` union in types.ts (the `Record` keeps
 *        them in sync — a missing entry is a compile error). Double-click open
 *        actions live in assetOpen.ts, co-located with their editors to avoid
 *        import cycles.
 *
 * A CONTRIBUTED type is registered at runtime instead, and carries its open/create
 * actions on the same object (a plugin has no import-cycle problem to design
 * around). Lookups go through {@link assetTypeDef} / {@link assetTypeOf} so both
 * kinds resolve identically; the built-in table keeps its exhaustiveness guard.
 */
import {
  Folder, Film, Image, FileImage, PersonStanding, Music,
  Component, Blend, FileCode2, Clapperboard, Grid3x3, File, Workflow, Gamepad2, GitBranch, ListTree, Languages, Images, Video, Waypoints, Sparkles, Plug, Type,
  type LucideIcon,
} from 'lucide-react';
import { ContributionRegistry, type Disposable, type Owner } from '@/contrib/ContributionRegistry';
import type { AssetType, BuiltinAssetType } from '@/types';

export interface AssetTypeDef {
  /** Extensions (lower-case, no dot) that resolve to this type. Omitted for the
   *  virtual `folder`/`file` types, which aren't extension-derived. */
  extensions?: readonly string[];
  /**
   * Full lower-case name endings that resolve to this type, matched BEFORE
   * extensions because they are the more specific claim. For formats whose files
   * are told apart by a name convention rather than a suffix — DragonBones ships
   * `_ske.json` beside `_tex.json`, and an extension alone cannot see that.
   */
  suffixes?: readonly string[];
  /** Short uppercase code shown in a tile's corner badge ('' = no badge). */
  badge: string;
  icon: LucideIcon;
  tint: string;
  /**
   * External program slot that opens this type when the editor has no editor of
   * its own for it (see project/externalPrograms.ts). Declared here for the same
   * reason the icon is: it is a property of the type, not of the program.
   */
  externalProgram?: string;
}

// Desaturated tints (vs candy colors) so the content browser stays scannable by
// type but reads as a professional tool.
export const ASSET_TYPES: Record<BuiltinAssetType, AssetTypeDef> = {
  folder: { badge: '', icon: Folder, tint: 'var(--star)' },
  scene: { extensions: ['esscene'], badge: 'SCN', icon: Film, tint: '#c98a93' },
  texture: { extensions: ['png', 'webp'], badge: 'TEX', icon: FileImage, tint: '#7fa6c4', externalProgram: 'image' },
  sprite: { extensions: ['jpg', 'jpeg', 'gif'], badge: 'IMG', icon: Image, tint: '#7fa6c4', externalProgram: 'image' },
  spine: { extensions: ['atlas', 'skel'], badge: 'SPN', icon: PersonStanding, tint: '#9b8fc0' },
  // Both halves are one type, as Spine's .skel and .atlas are: which file plays
  // which role is the component's business, not the content browser's.
  dragonbones: {
    extensions: ['dbbin'],
    suffixes: ['_ske.json', '_tex.json'],
    badge: 'DB', icon: PersonStanding, tint: '#a89b6b',
  },
  audio: { extensions: ['ogg', 'mp3', 'wav', 'aac', 'flac', 'm4a', 'webm'], badge: 'AUD', icon: Music, tint: '#7faf9c' },
  // Outline fonts a project ships (Text.font). Bitmap fonts (.fnt/.bmfont) are a
  // different asset — a baked page + metrics for BitmapText — and stay separate.
  font: { extensions: ['ttf', 'otf', 'woff', 'woff2'], badge: 'FNT', icon: Type, tint: '#9a9fc4' },
  video: { extensions: ['mp4', 'm4v', 'mov'], badge: 'VID', icon: Video, tint: '#c08fb5' },
  prefab: { extensions: ['esprefab'], badge: 'PFB', icon: Component, tint: '#c2a274' },
  // .esmaterial is the real extension (the SDK MaterialAssetLoader only loads it);
  // .esmat is tolerated as a legacy alias (cf. electron/importAssets.ts).
  material: { extensions: ['esmaterial', 'esmat'], badge: 'MAT', icon: Blend, tint: '#c0917a' },
  materialgraph: { extensions: ['esmatgraph'], badge: 'MGR', icon: Workflow, tint: '#c0917a' },
  // A `.esshader` is the fragment-shader source (with #pragma param declarations) a material
  // references; recognizable here so it never reads as a mystery "file" next to its material.
  shader: { extensions: ['esshader'], badge: 'SHD', icon: Sparkles, tint: '#c9a26a', externalProgram: 'script' },
  script: { extensions: ['ts', 'js'], badge: 'TS', icon: FileCode2, tint: '#93a3bf', externalProgram: 'script' },
  // Two animation documents, two editors: .estimeline is the Sequencer's
  // multi-track timeline; .esanim is the sprite flipbook (Flipbook editor).
  animation: { extensions: ['estimeline'], badge: 'SEQ', icon: Clapperboard, tint: '#9bb39a' },
  animclip: { extensions: ['esanim'], badge: 'CLP', icon: Images, tint: '#9bb39a' },
  tileset: { extensions: ['estileset'], badge: 'TST', icon: Grid3x3, tint: '#9b8fc0' },
  tilemap: { extensions: ['estilemap'], badge: 'TMP', icon: Grid3x3, tint: '#7fa6c4' },
  inputmap: { extensions: ['inputmap'], badge: 'INP', icon: Gamepad2, tint: '#a0b88f' },
  statemachine: { extensions: ['esfsm'], badge: 'FSM', icon: GitBranch, tint: '#8fb0a0' },
  animatorcontroller: { extensions: ['esanimator'], badge: 'ANC', icon: Waypoints, tint: '#c0a08f' },
  behaviortree: { extensions: ['esbt'], badge: 'BT', icon: ListTree, tint: '#8fa0c4' },
  locale: { extensions: ['eslocale'], badge: 'LOC', icon: Languages, tint: '#b8a98a' },
  file: { badge: '', icon: File, tint: 'var(--text-dim)' },
};

const byExt = new Map<string, AssetType>();
for (const [type, def] of Object.entries(ASSET_TYPES) as [AssetType, AssetTypeDef][]) {
  for (const ext of def.extensions ?? []) byExt.set(ext, type);
}

// — Contributed asset types ————————————————————————————————————————————————————

/** A plugin-registered asset type: display data plus its own open/create actions. */
export interface ContributedAssetType extends AssetTypeDef {
  id: string;
  open?: (path: string) => void;
  create?: { label: string; run: (dir: string) => Promise<string | void> | string | void };
}

const contributed = new ContributionRegistry<ContributedAssetType>('asset type');

export const assetTypeRegistry = {
  register(owner: Owner, type: ContributedAssetType): Disposable {
    return contributed.register(owner, type);
  },
  disposeOwner: (owner: Owner): void => contributed.disposeOwner(owner),
  all: (): readonly ContributedAssetType[] => contributed.all(),
  get: (id: string): ContributedAssetType | undefined => contributed.get(id),
  subscribe: (fn: () => void): (() => void) => contributed.subscribe(fn),
  getRevision: (): number => contributed.getRevision(),
};

/** Display data for any asset type — built-in or contributed. Unknown ⇒ the generic file look. */
export function assetTypeDef(type: AssetType): AssetTypeDef {
  return (ASSET_TYPES as Record<string, AssetTypeDef>)[type] ?? contributed.get(type) ?? ASSET_TYPES.file;
}

/**
 * Asset type from a file name's extension; unknown extensions fall back to `file`.
 * Built-ins are matched first, so a plugin cannot re-map `.png`.
 */
export function assetTypeOf(name: string): AssetType {
  const lower = name.toLowerCase();
  // Suffixes first: `foo_ske.json` is a DragonBones skeleton, and letting the
  // extension answer would call it whatever `.json` maps to.
  for (const [type, def] of Object.entries(ASSET_TYPES) as [AssetType, AssetTypeDef][]) {
    if (def.suffixes?.some((s) => lower.endsWith(s))) return type;
  }
  for (const type of contributed.all()) {
    if (type.suffixes?.some((s) => lower.endsWith(s))) return type.id;
  }

  const ext = lower.split('.').pop() ?? '';
  const builtin = byExt.get(ext);
  if (builtin) return builtin;
  for (const type of contributed.all()) {
    if (type.extensions?.includes(ext)) return type.id;
  }
  return 'file';
}

/** Icon assigned to a contributed type — one generic glyph, so a plugin needn't
 *  ship an icon and the editor needn't bundle all of lucide to resolve a name. */
export const CONTRIBUTED_ASSET_ICON: LucideIcon = Plug;

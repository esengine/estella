import {
  Camera,
  Image,
  PersonStanding,
  Boxes,
  Square,
  LayoutPanelTop,
  Volume2,
  Lightbulb,
  CircleDot,
  Folder,
  Film,
  FileImage,
  Music,
  Component,
  Blend,
  FileCode2,
  File,
  type LucideIcon,
} from 'lucide-react';
import type { NodeKind, AssetType } from '@/types';

// Scene-node kind → glyph. Keeps the outliner legible at a glance.
const NODE_ICON: Record<NodeKind, LucideIcon> = {
  camera: Camera,
  sprite: Image,
  spine: PersonStanding,
  physics: Square,
  ui: LayoutPanelTop,
  audio: Volume2,
  group: Boxes,
  light: Lightbulb,
  empty: CircleDot,
};

export function NodeIcon({ kind, size = 14 }: { kind: NodeKind; size?: number }) {
  const Glyph = NODE_ICON[kind];
  return <Glyph size={size} strokeWidth={1.75} />;
}

// Asset type → glyph + accent tint, so the content browser is scannable by color.
const ASSET_ICON: Record<AssetType, { icon: LucideIcon; tint: string }> = {
  folder: { icon: Folder, tint: 'var(--star)' },
  scene: { icon: Film, tint: '#ff8fa3' },
  sprite: { icon: Image, tint: '#6fd3ff' },
  texture: { icon: FileImage, tint: '#6fd3ff' },
  spine: { icon: PersonStanding, tint: '#b69bff' },
  audio: { icon: Music, tint: '#43d39e' },
  prefab: { icon: Component, tint: '#ffb454' },
  material: { icon: Blend, tint: '#ff9d6f' },
  script: { icon: FileCode2, tint: '#9fb2d6' },
  file: { icon: File, tint: 'var(--text-dim)' },
};

export function AssetIcon({ type, size = 22 }: { type: AssetType; size?: number }) {
  const { icon: Glyph, tint } = ASSET_ICON[type];
  return <Glyph size={size} strokeWidth={1.5} color={tint} />;
}

export function assetTint(type: AssetType): string {
  return ASSET_ICON[type].tint;
}

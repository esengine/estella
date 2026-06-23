// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
  Clapperboard,
  FileImage,
  Music,
  Component,
  Blend,
  FileCode2,
  File,
  Type,
  Grid3x3,
  Sparkles,
  Box,
  Hexagon,
  Link2,
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

// Asset type → glyph + muted type tint. Desaturated (vs candy colors) so the
// content browser stays scannable by type but reads as a professional tool.
const ASSET_ICON: Record<AssetType, { icon: LucideIcon; tint: string }> = {
  folder: { icon: Folder, tint: 'var(--star)' },
  scene: { icon: Film, tint: '#c98a93' },
  sprite: { icon: Image, tint: '#7fa6c4' },
  texture: { icon: FileImage, tint: '#7fa6c4' },
  spine: { icon: PersonStanding, tint: '#9b8fc0' },
  audio: { icon: Music, tint: '#7faf9c' },
  prefab: { icon: Component, tint: '#c2a274' },
  material: { icon: Blend, tint: '#c0917a' },
  script: { icon: FileCode2, tint: '#93a3bf' },
  animation: { icon: Clapperboard, tint: '#9bb39a' },
  file: { icon: File, tint: 'var(--text-dim)' },
};

export function AssetIcon({ type, size = 22 }: { type: AssetType; size?: number }) {
  const { icon: Glyph, tint } = ASSET_ICON[type];
  return <Glyph size={size} strokeWidth={1.5} color={tint} />;
}

export function assetTint(type: AssetType): string {
  return ASSET_ICON[type].tint;
}

// Component (by registry name) → glyph, for the Add-Component picker. Known
// builtins are mapped; the rest fall back by name heuristic, then a generic
// component glyph. Inherits currentColor so callers control the tint.
const COMPONENT_ICON: Record<string, LucideIcon> = {
  Camera,
  Sprite: Image,
  ShapeRenderer: Square,
  BitmapText: Type,
  TilemapLayer: Grid3x3,
  ParticleEmitter: Sparkles,
  Canvas: LayoutPanelTop,
  SpineAnimation: PersonStanding,
  RigidBody: Box,
};

function componentGlyph(name: string): LucideIcon {
  const hit = COMPONENT_ICON[name];
  if (hit) return hit;
  if (/Collider$/.test(name)) return Hexagon;
  if (/Joint$/.test(name)) return Link2;
  if (/Audio|Sound/.test(name)) return Volume2;
  if (/Light/.test(name)) return Lightbulb;
  if (/Particle|Emitter|Trail/.test(name)) return Sparkles;
  if (/Text|Font|Label/.test(name)) return Type;
  return Component;
}

export function ComponentIcon({ name, size = 14 }: { name: string; size?: number }) {
  const Glyph = componentGlyph(name);
  return <Glyph size={size} strokeWidth={1.75} />;
}

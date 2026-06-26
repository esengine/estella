// SPDX-License-Identifier: Apache-2.0
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
  Component,
  Type,
  Grid3x3,
  Sparkles,
  Box,
  Hexagon,
  Link2,
  type LucideIcon,
} from 'lucide-react';
import type { NodeKind, AssetType } from '@/types';
import { ASSET_TYPES } from '@/project/assetTypes';

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

export function AssetIcon({ type, size = 22 }: { type: AssetType; size?: number }) {
  const { icon: Glyph, tint } = ASSET_TYPES[type];
  return <Glyph size={size} strokeWidth={1.5} color={tint} />;
}

export function assetTint(type: AssetType): string {
  return ASSET_TYPES[type].tint;
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

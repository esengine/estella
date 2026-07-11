// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    tileThumb.tsx
 * @brief   Shared tile-thumbnail crop + animation preview — used by both the
 *          Tileset editor and the Tilemap painter's palette, which each need to
 *          show a single tile out of the atlas and loop an animated tile's frames.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import type { TilesetAnimFrame } from 'esengine';

/** The atlas layout a tile is cropped from (a parsed `.estileset`'s grid). */
export interface TileAtlas {
  url: string;
  naturalW: number;
  naturalH: number;
  cols: number;
  tileW: number;
  tileH: number;
  margin: number;
  spacing: number;
}

/**
 * A CSS `background` that crops the 1-based `tile` out of `atlas`, scaled so one
 * cell renders at `size` px. Returns `{}` for an absent atlas or an out-of-range
 * tile so the caller can spread it unconditionally.
 */
export function tileThumbStyle(atlas: TileAtlas | null, tile: number, size: number): CSSProperties {
  if (!atlas || tile < 1) return {};
  const c = (tile - 1) % atlas.cols;
  const r = Math.floor((tile - 1) / atlas.cols);
  const s = size / atlas.tileW;
  return {
    backgroundImage: `url(${atlas.url})`,
    backgroundPosition: `${-(atlas.margin + c * (atlas.tileW + atlas.spacing)) * s}px ${-(atlas.margin + r * (atlas.tileH + atlas.spacing)) * s}px`,
    backgroundSize: `${atlas.naturalW * s}px ${atlas.naturalH * s}px`,
  };
}

/**
 * Loops an animated tile's frame strip, each frame shown for its own duration;
 * falls back to `fallback` when there are no frames. `thumb` maps a tile id to
 * its crop style (bind it to the atlas + size at the call site).
 */
export function AnimPreview({
  frames,
  fallback,
  thumb,
  className,
}: {
  frames: TilesetAnimFrame[];
  fallback: number;
  thumb: (tile: number) => CSSProperties;
  className?: string;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
    if (frames.length < 2) return;
    let idx = 0;
    let live = true;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (!live) return;
      idx = (idx + 1) % frames.length;
      setI(idx);
      t = setTimeout(tick, frames[idx].durationMs || 120);
    };
    t = setTimeout(tick, frames[0].durationMs || 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [frames]);
  const tile = frames.length ? frames[Math.min(i, frames.length - 1)].tile : fallback;
  return <span className={className} style={thumb(tile)} title="Preview" />;
}

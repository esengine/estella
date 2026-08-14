// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  convert.ts — an LDtk project as Tiled maps, which the engine reads natively.
 *
 * Pure: JSON in, files out. The editor half only reads and writes.
 */

/** The parts of an `.ldtk` file this reads. Everything else is ignored. */
export interface LdtkProject {
  defs?: { tilesets?: LdtkTileset[] };
  levels?: LdtkLevel[];
}

export interface LdtkTileset {
  uid: number;
  identifier: string;
  /** Image path, relative to the `.ldtk` file. Absent for an internal icon set. */
  relPath?: string | null;
  pxWid: number;
  pxHei: number;
  tileGridSize: number;
  spacing?: number;
  padding?: number;
}

export interface LdtkLevel {
  identifier: string;
  layerInstances?: LdtkLayer[] | null;
}

export interface LdtkLayer {
  __identifier: string;
  __type: string;
  __gridSize: number;
  __cWid: number;
  __cHei: number;
  __tilesetDefUid?: number | null;
  __opacity?: number;
  visible?: boolean;
  gridTiles?: LdtkTile[];
  autoLayerTiles?: LdtkTile[];
}

export interface LdtkTile {
  /** Pixel position in the layer. */
  px: [number, number];
  /** Tile id within its tileset. */
  t: number;
  /** Flip bits: 1 = X, 2 = Y. */
  f?: number;
}

/** One file the importer should write, project-relative. */
export interface ConvertedFile {
  path: string;
  text: string;
}

// Tiled's flip flags live in the high bits of a gid; the engine's parser reads
// exactly these three.
const FLIP_H = 0x80000000;
const FLIP_V = 0x40000000;

const dirOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const stemOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot < 0 ? base : base.slice(0, dot);
};

/** Resolve `rel` against `from` (a directory), collapsing `.` and `..`. */
function resolveRel(from: string, rel: string): string {
  const out = from === '' ? [] : from.split('/');
  for (const part of rel.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** `to` expressed relative to the directory `from`. */
function relativeTo(from: string, to: string): string {
  const a = from === '' ? [] : from.split('/');
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

/** Whether a layer carries tiles at all — an IntGrid used as pure data has none,
 *  and an empty tile layer in Tiled is a layer that draws nothing. */
const tilesOf = (layer: LdtkLayer): LdtkTile[] => [...(layer.gridTiles ?? []), ...(layer.autoLayerTiles ?? [])];

/**
 * Every level of `project` as a Tiled map, written under a folder named after the
 * source file so a reimport overwrites its own output and nothing else.
 *
 * `sourcePath` is the `.ldtk` file's project-relative path — tileset images are
 * declared relative to it, and Tiled declares them relative to the map.
 */
export function tiledFromLdtk(project: LdtkProject, sourcePath: string): ConvertedFile[] {
  const srcDir = dirOf(sourcePath);
  const outDir = srcDir === '' ? stemOf(sourcePath) : `${srcDir}/${stemOf(sourcePath)}`;

  // One gid space per map, assigned in tileset order. A tileset with no image is
  // skipped: it cannot be drawn, and giving it a gid range would shift every
  // tileset after it.
  const usable = (project.defs?.tilesets ?? []).filter((t) => !!t.relPath);
  let nextGid = 1;
  const tilesets = usable.map((ts) => {
    const columns = Math.max(1, Math.floor((ts.pxWid - (ts.padding ?? 0) * 2 + (ts.spacing ?? 0))
      / (ts.tileGridSize + (ts.spacing ?? 0))));
    const rows = Math.max(1, Math.floor((ts.pxHei - (ts.padding ?? 0) * 2 + (ts.spacing ?? 0))
      / (ts.tileGridSize + (ts.spacing ?? 0))));
    const firstgid = nextGid;
    nextGid += columns * rows;
    return {
      uid: ts.uid,
      firstgid,
      json: {
        firstgid,
        name: ts.identifier,
        image: relativeTo(outDir, resolveRel(srcDir, ts.relPath!)),
        imagewidth: ts.pxWid,
        imageheight: ts.pxHei,
        tilewidth: ts.tileGridSize,
        tileheight: ts.tileGridSize,
        margin: ts.padding ?? 0,
        spacing: ts.spacing ?? 0,
        columns,
        tilecount: columns * rows,
      },
    };
  });
  const gidOf = new Map(tilesets.map((t) => [t.uid, t.firstgid]));

  return (project.levels ?? []).map((level) => {
    const drawn = (level.layerInstances ?? []).filter((l) => tilesOf(l).length > 0);
    // LDtk lists layers top-first; Tiled draws its array in order, so the first
    // entry is the BOTTOM one. Reversing is what keeps a background behind.
    const ordered = [...drawn].reverse();
    const first = ordered[0];
    const tileSize = first?.__gridSize ?? 16;
    const width = Math.max(...ordered.map((l) => l.__cWid), 0);
    const height = Math.max(...ordered.map((l) => l.__cHei), 0);

    const layers = ordered.map((layer) => {
      const firstgid = gidOf.get(layer.__tilesetDefUid ?? -1) ?? 1;
      const data = new Array<number>(layer.__cWid * layer.__cHei).fill(0);
      for (const tile of tilesOf(layer)) {
        const cx = Math.floor(tile.px[0] / layer.__gridSize);
        const cy = Math.floor(tile.px[1] / layer.__gridSize);
        if (cx < 0 || cy < 0 || cx >= layer.__cWid || cy >= layer.__cHei) continue;
        const flip = ((tile.f ?? 0) & 1 ? FLIP_H : 0) | ((tile.f ?? 0) & 2 ? FLIP_V : 0);
        // A later tile in the same cell is the one drawn on top, and a Tiled tile
        // layer holds one per cell — so it wins, rather than the first winning.
        data[cy * layer.__cWid + cx] = (firstgid + tile.t) | flip;
      }
      return {
        type: 'tilelayer',
        name: layer.__identifier,
        width: layer.__cWid,
        height: layer.__cHei,
        x: 0,
        y: 0,
        opacity: layer.__opacity ?? 1,
        visible: layer.visible !== false,
        data,
      };
    });

    const map = {
      type: 'map',
      version: '1.10',
      tiledversion: 'estella-plugin-ldtk',
      orientation: 'orthogonal',
      renderorder: 'right-down',
      infinite: false,
      width,
      height,
      tilewidth: tileSize,
      tileheight: tileSize,
      tilesets: tilesets.map((t) => t.json),
      layers,
    };
    return { path: `${outDir}/${level.identifier}.tmj`, text: `${JSON.stringify(map, null, 2)}\n` };
  });
}

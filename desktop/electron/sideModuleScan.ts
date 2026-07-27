// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  sideModuleScan.ts — the export-time half of side-module gating. The
 *        runtime self-gates physics/spine off a scene scan (runtimeLoader +
 *        SpineManager); for the INLINED targets (playable single-file) the
 *        exporter must run the SAME scan so it embeds exactly the modules the
 *        scene needs and no more (playables are size-capped). The constant lists
 *        below mirror the SDK's so the two halves agree; keep them in sync.
 */

/** Component types whose presence means the scene needs physics.
 *  Mirrors sdk/src/runtimeLoader.ts PHYSICS_COMPONENT_TYPES. */
const PHYSICS_COMPONENT_TYPES = new Set([
  'RigidBody', 'BoxCollider', 'CircleCollider', 'CapsuleCollider',
  'SegmentCollider', 'PolygonCollider', 'ChainCollider',
]);

interface SceneLike {
  entities?: Array<{ components?: Array<{ type?: string; data?: unknown }> }>;
}

/** True if any entity carries a physics component, or a TilemapLayer that bakes
 *  collidable tiles (which spawn colliders at runtime). Mirrors runtimeLoader.sceneUsesPhysics. */
export function sceneUsesPhysics(scene: SceneLike): boolean {
  for (const entity of scene.entities ?? []) {
    for (const comp of entity.components ?? []) {
      if (comp.type && PHYSICS_COMPONENT_TYPES.has(comp.type)) return true;
      if (comp.type === 'TilemapLayer') {
        const ids = (comp.data as Record<string, unknown> | undefined)?.collidableTileIds;
        if (Array.isArray(ids) && ids.length > 0) return true;
      }
    }
  }
  return false;
}

/** True if any entity carries a Video component — the wasm video decoder is
 *  WeChat's only video path, so any Video means the module must ship. */
export function sceneUsesVideo(scene: SceneLike): boolean {
  for (const entity of scene.entities ?? []) {
    for (const comp of entity.components ?? []) {
      if (comp.type === 'Video') return true;
    }
  }
  return false;
}

export type SpineVersion = '3.8' | '4.1' | '4.2' | '4.3';

/**
 * Which runtime reads a skeleton's reported version, newest prefix first — the same
 * table SpineManager keeps, because a cook that ships one module and a runtime that
 * asks for another is the one mismatch nothing downstream can recover from.
 */
const VERSION_PREFIXES: ReadonlyArray<readonly [string, SpineVersion]> = [
  ['4.3', '4.3'],
  ['4.2', '4.2'],
  ['4.1', '4.1'],
  ['3.', '3.8'],
];

function runtimeFor(reported: string): SpineVersion | null {
  for (const [prefix, version] of VERSION_PREFIXES) {
    if (reported.startsWith(prefix)) return version;
  }
  return null;
}

/** id → artifact base name. Mirrors sdk/src/sideModules/registry.ts SIDE_MODULES. */
export const SIDE_MODULE_FILE: Record<string, string> = {
  physics: 'physics',
  basis: 'basis',
  videodec: 'videodec',
  'spine:3.8': 'spine38',
  'spine:4.1': 'spine41',
  'spine:4.2': 'spine42',
  'spine:4.3': 'spine43',
};

/** id → the `build-tools/cli.js build -t <target>` that produces its WeChat artifacts. */
export const WECHAT_MODULE_BUILD_TARGET: Record<string, string> = {
  physics: 'physics-wechat',
  basis: 'basis-wechat',
  videodec: 'videodec-wechat',
  'spine:3.8': 'spine-wechat',
  'spine:4.1': 'spine-wechat',
  'spine:4.2': 'spine-wechat',
  'spine:4.3': 'spine-wechat',
};

export function spineModuleId(version: SpineVersion): string {
  return `spine:${version}`;
}

// --- Spine skeleton version detection (mirrors SpineManager.detectVersion[Json]) ---

export function detectSpineVersionJson(json: string): SpineVersion | null {
  const m = json.match(/"spine"\s*:\s*"(\d+\.\d+)/);
  return m ? runtimeFor(m[1]) : null;
}

export function detectSpineVersion(data: Uint8Array): SpineVersion | null {
  return tryRead4xVersion(data) ?? tryRead3xVersion(data);
}

function readVarint(data: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let value = 0, shift = 0, bytesRead = 0;
  do {
    const b = data[offset + bytesRead++];
    value |= (b & 0x7f) << shift;
    shift += 7;
    if (!(b & 0x80)) break;
  } while (shift < 35);
  return { value, bytesRead };
}

function tryRead4xVersion(data: Uint8Array): SpineVersion | null {
  if (data.length < 10) return null;
  let pos = 8;
  const { value: len, bytesRead } = readVarint(data, pos);
  pos += bytesRead;
  if (len <= 1 || pos + len - 1 > data.length) return null;
  const ver = new TextDecoder().decode(data.subarray(pos, pos + len - 1));
  return ver.startsWith('4.') ? runtimeFor(ver) : null;
}

function tryRead3xVersion(data: Uint8Array): SpineVersion | null {
  if (data.length < 4) return null;
  let pos = 0;
  const { value: hashLen, bytesRead: hb } = readVarint(data, pos);
  pos += hb;
  if (hashLen > 0) pos += hashLen - 1;
  if (pos >= data.length) return null;
  const { value: verLen, bytesRead: vb } = readVarint(data, pos);
  pos += vb;
  if (verLen <= 1 || pos + verLen - 1 > data.length) return null;
  const ver = new TextDecoder().decode(data.subarray(pos, pos + verLen - 1));
  return ver.startsWith('3.') ? runtimeFor(ver) : null;
}

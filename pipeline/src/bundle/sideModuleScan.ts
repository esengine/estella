// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  sideModuleScan.ts — which optional modules the content a package ships
 *        can ask for. Every rule here is the export-time half of a runtime
 *        gate, and calls the runtime's own predicate where one exists.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  SIDE_MODULES, spineModuleId, getEditorType,
  sceneUsesPhysics, sceneUses3DPhysics,
  type SideModuleId, type SpineVersion,
} from 'esengine';

export type { SpineVersion };
export { SIDE_MODULES, spineModuleId };

/** id → the `build-tools/cli.js build -t <target>` producing its WeChat artifacts. */
export const WECHAT_MODULE_BUILD_TARGET: Record<string, string> = {
  physics: 'physics-wechat',
  basis: 'basis-wechat',
  videodec: 'videodec-wechat',
  dragonbones: 'dragonbones-wechat',
  'spine:2.1': 'spine-wechat',
  'spine:3.8': 'spine-wechat',
  'spine:4.1': 'spine-wechat',
  'spine:4.2': 'spine-wechat',
  'spine:4.3': 'spine-wechat',
};

interface CookEntryLike {
  path: string;
  sourcePath?: string;
  type?: string;
}

export interface SideModuleScanInput {
  /** Project root — the authored documents are read from here. */
  root: string;
  /** Project-relative paths the cook reached; scenes and prefabs are scanned. */
  includedPaths: readonly string[];
  /** Entries the cook staged, naming what the package physically carries. */
  cookEntries: readonly CookEntryLike[];
  /** Absolute dir `cookEntries[].path` resolve against. */
  stagedDir: string;
  /** Project Settings → Physics enabled. */
  physicsEnabled: boolean;
}

const VERSION_PREFIXES: ReadonlyArray<readonly [string, SpineVersion]> = [
  ['4.3', '4.3'],
  ['4.2', '4.2'],
  ['4.1', '4.1'],
  ['3.', '3.8'],
  ['2.1', '2.1'],
];

function runtimeFor(reported: string): SpineVersion | null {
  for (const [prefix, version] of VERSION_PREFIXES) {
    if (reported.startsWith(prefix)) return version;
  }
  return null;
}

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
  return (ver.startsWith('3.') || ver.startsWith('2.')) ? runtimeFor(ver) : null;
}

async function readDocuments(root: string, includedPaths: readonly string[]): Promise<unknown[]> {
  const docs: unknown[] = [];
  for (const rel of includedPaths) {
    const ext = path.extname(rel).toLowerCase();
    if (ext !== '.esscene' && ext !== '.esprefab') continue;
    try {
      docs.push(JSON.parse(await readFile(path.join(root, rel), 'utf8')));
    } catch { /* unreadable or not JSON — the cook already warned */ }
  }
  return docs;
}

/**
 * The union of optional modules any shipped document can ask for. A dynamically
 * switched scene and a prefab spawned from script both have to find their module
 * present, so this is a union over everything the package carries, not over the
 * entry scene.
 */
export async function scanSideModuleIds(input: SideModuleScanInput): Promise<Set<SideModuleId>> {
  const ids = new Set<SideModuleId>();
  const docs = await readDocuments(input.root, input.includedPaths);

  // The project's own declaration counts as a use: a game that spawns bodies from
  // script has none in any document, and shipping the flag without the binary
  // fails at the first spawn instead of at build time.
  if (input.physicsEnabled || docs.some((d) => sceneUsesPhysics(d as never))) ids.add('physics');
  // Never implied by the 2D flag — that declares the solver 2D scenes use, and
  // this is a different module.
  if (docs.some((d) => sceneUses3DPhysics(d as never))) ids.add('physics3d');

  for (const e of input.cookEntries) {
    const lower = e.path.toLowerCase();
    if (/\.ktx2(\.bin)?$/.test(lower)) ids.add('basis');
    // Script-driven playback references cooked videos no component names.
    if (/\.esv(\.bin)?$/.test(lower)) ids.add('videodec');
    const editorType = getEditorType(e.sourcePath ?? e.path);
    if (editorType === 'dragonbones-skeleton' || editorType === 'dragonbones-atlas') ids.add('dragonbones');
    if (e.type !== 'spine') continue;
    const ext = path.extname(e.sourcePath ?? e.path).toLowerCase();
    try {
      let v: SpineVersion | null = null;
      if (ext === '.skel') {
        v = detectSpineVersion(new Uint8Array(await readFile(path.join(input.stagedDir, e.path))));
      } else if (ext === '.json') {
        v = detectSpineVersionJson(await readFile(path.join(input.stagedDir, e.path), 'utf8'));
      }
      if (v) ids.add(spineModuleId(v));
    } catch { /* unreadable cook entry — cookAssets already warned */ }
  }
  return ids;
}

/**
 * A `cp` filter over the engine's wasm dir keeping only the side modules in
 * `needed`. Anything that is not a known side-module artifact ships untouched:
 * the only files this can prove unnecessary are the ones the scan answered for.
 */
export function shipsSideModule(needed: readonly string[]): (src: string) => boolean {
  const keep = new Set(needed);
  const droppable = new Set<string>();
  for (const descriptor of Object.values(SIDE_MODULES)) {
    if (!keep.has(descriptor.file)) droppable.add(descriptor.file);
  }
  return (src: string) => {
    const base = path.basename(src);
    const dot = base.indexOf('.');
    if (dot < 0) return true;
    const stem = base.slice(0, dot);
    const ext = base.slice(dot).toLowerCase();
    if (ext !== '.js' && ext !== '.wasm') return true;
    return !droppable.has(stem);
  };
}

/**
 * The artifact base names `ids` resolve to. An id with no entry in the engine's
 * table is reported rather than skipped: a module the scan asks for and the
 * package does not carry is a 404 the moment the content needs it.
 */
export function sideModuleFiles(
  ids: Iterable<SideModuleId>,
): { files: Array<{ id: SideModuleId; file: string }>; unknown: SideModuleId[] } {
  const files: Array<{ id: SideModuleId; file: string }> = [];
  const unknown: SideModuleId[] = [];
  for (const id of ids) {
    const descriptor = SIDE_MODULES[id as keyof typeof SIDE_MODULES];
    if (descriptor) files.push({ id, file: descriptor.file });
    else unknown.push(id);
  }
  return { files, unknown };
}

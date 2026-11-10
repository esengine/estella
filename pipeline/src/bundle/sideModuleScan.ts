// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  sideModuleScan.ts — which optional modules the content a package ships
 *        can ask for. Every rule here is the export-time half of a runtime
 *        gate, and calls the runtime's own predicate where one exists.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { statSync } from 'node:fs';
import { spineChoiceKey, type ModuleChoice } from '../project/format';
import {
  SIDE_MODULES, SPINE_VERSIONS, spineModuleId, physics3dModuleId, getEditorType,
  sceneUsesPhysics, sceneUses3DPhysics,
  type SideModuleId, type SpineVersion, type Physics3DBackend,
} from 'esengine';

export type { SpineVersion };
export { SIDE_MODULES, spineModuleId };

/** The module that reads a KTX2 — named once, because two things ask about it. */
const BASIS = 'basis';

/** id → the `build-tools/cli.js build -t <target>` producing its WeChat artifacts. */
export const WECHAT_MODULE_BUILD_TARGET: Record<string, string> = {
  physics: 'physics-wechat',
  [BASIS]: 'basis-wechat',
  videodec: 'videodec-wechat',
  dragonbones: 'dragonbones-wechat',
  'spine:2.1': 'spine-wechat',
  'spine:3.8': 'spine-wechat',
  'spine:4.1': 'spine-wechat',
  'spine:4.2': 'spine-wechat',
  'spine:4.3': 'spine-wechat',
};

export interface CookEntryLike {
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
  /**
   * Module ids the project forced in (`features.modules` → `include`), from
   * `forcedSideModules`. A module only a script reaches leaves no trace for this
   * scan either, so the project's word is the evidence.
   */
  forced?: readonly string[];
  /** The project's 3D backend: which module answers for the 3D world. Absent ⇒ Jolt. */
  physics3dBackend?: Physics3DBackend;
  /** What the project said per module, from `moduleChoices` — read here for the
   *  Spine runtimes (`esengine/spine@<version>`, see resolveSpineRuntimes). */
  choices?: Readonly<Record<string, ModuleChoice>>;
}

/** Why one Spine runtime is in a package or not, for the export to report. */
export interface SpineRuntimeDecision {
  version: SpineVersion;
  ships: boolean;
  /** `detected`: a shipped skeleton was exported from it. `included`/`excluded`:
   *  the project said so. `unused`: nothing needs it and nothing asked. */
  why: 'detected' | 'included' | 'excluded' | 'unused';
  /** The shipped skeletons exported from it (authored paths). */
  skeletons: readonly string[];
}

/** The Spine runtimes a package carries, decided once for every target. */
export interface SpineRuntimePlan {
  versions: readonly SpineVersion[];
  decisions: readonly SpineRuntimeDecision[];
  /** Runtimes the project excluded that shipped skeletons need: the export fails,
   *  since the alternative is a package whose skeletons silently do not play. */
  refused: ReadonlyArray<{ version: SpineVersion; skeletons: readonly string[] }>;
}

/**
 * Which Spine runtimes a package carries: the ones its skeletons were exported
 * from, plus what the project included, minus what it excluded. Every target
 * asks this one function — web and playable side modules, a mini-game's
 * per-version wasm, Android's per-release libraries — so a runtime cannot ship on
 * one and be missing on another. Detection reads the skeleton files themselves;
 * `include` is for skeletons only code loads (a path built at run time, content
 * fetched later), `exclude` for one detection collected that never plays.
 */
export function resolveSpineRuntimes(
  skeletons: ReadonlyMap<string, readonly string[]>,
  choices: Readonly<Record<string, ModuleChoice>> = {},
): SpineRuntimePlan {
  const moduleExcluded = choices['esengine/spine'] === 'exclude';
  const decisions: SpineRuntimeDecision[] = [];
  const refused: Array<{ version: SpineVersion; skeletons: readonly string[] }> = [];
  for (const version of SPINE_VERSIONS) {
    const used = skeletons.get(version) ?? [];
    const choice = moduleExcluded ? 'exclude' : (choices[spineChoiceKey(version)] ?? 'auto');
    if (choice === 'exclude') {
      decisions.push({ version, ships: false, why: 'excluded', skeletons: used });
      // The whole-module refusal is engineInstalls'; this names the runtime.
      if (used.length && !moduleExcluded) refused.push({ version, skeletons: used });
    } else if (choice === 'include') {
      decisions.push({ version, ships: true, why: used.length ? 'detected' : 'included', skeletons: used });
    } else {
      decisions.push({ version, ships: used.length > 0, why: used.length ? 'detected' : 'unused', skeletons: used });
    }
  }
  return { versions: decisions.filter((d) => d.ships).map((d) => d.version), decisions, refused };
}

/** A refused runtime, said the way the other module refusals are. */
export function spineRefusalMessage(r: { version: string; skeletons: readonly string[] }): string {
  const named = r.skeletons.slice(0, 3).join(', ') + (r.skeletons.length > 3 ? `, and ${r.skeletons.length - 3} more` : '');
  return `${spineChoiceKey(r.version)} is excluded in Project Settings, and this build ships `
    + `${r.skeletons.length} skeleton${r.skeletons.length === 1 ? '' : 's'} exported from Spine ${r.version} `
    + `(${named}). Set it to Auto or Include, or export those skeletons from a runtime the package carries.`;
}

/** What a package carries, with the Spine part spelled out. */
export interface SideModulePlan {
  ids: Set<SideModuleId>;
  spine: SpineRuntimePlan;
  /** Every shipped skeleton by the runtime it was exported from. */
  skeletons: ReadonlyMap<SpineVersion, readonly string[]>;
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
  return (await planSideModules(input)).ids;
}

/** {@link scanSideModuleIds}, with the Spine decision and its evidence: what an
 *  export reports, and refuses on. */
export async function planSideModules(input: SideModuleScanInput): Promise<SideModulePlan> {
  const ids = new Set<SideModuleId>();
  const docs = await readDocuments(input.root, input.includedPaths);

  // The project's own declaration counts as a use: a game that spawns bodies from
  // script has none in any document, and shipping the flag without the binary
  // fails at the first spawn instead of at build time.
  for (const id of input.forced ?? []) ids.add(id as SideModuleId);
  if (docs.some((d) => sceneUsesPhysics(d as never))) ids.add('physics');
  // Never implied by the 2D flag — that declares the solver 2D scenes use, and
  // this is a different module.
  if (docs.some((d) => sceneUses3DPhysics(d as never))) ids.add('physics3d');
  // The 3D world is one module whichever solver runs it; the project's backend
  // picks the artifact, so a PhysX project never carries Jolt and the reverse.
  if (ids.delete('physics3d')) ids.add(physics3dModuleId(input.physics3dBackend));

  for (const e of input.cookEntries) {
    const lower = e.path.toLowerCase();
    if (/\.ktx2(\.bin)?$/.test(lower)) ids.add(BASIS);
    // Script-driven playback references cooked videos no component names.
    if (/\.esv(\.bin)?$/.test(lower)) ids.add('videodec');
    const editorType = getEditorType(e.sourcePath ?? e.path);
    if (editorType === 'dragonbones-skeleton' || editorType === 'dragonbones-atlas') ids.add('dragonbones');
  }
  const skeletons = await scanSpineSkeletons(input.cookEntries, input.stagedDir);
  const spine = resolveSpineRuntimes(skeletons, input.choices);
  for (const v of spine.versions) ids.add(spineModuleId(v));
  return { ids, spine, skeletons };
}

/**
 * The Spine runtime one skeleton file was exported from, read from its bytes —
 * null for an atlas, an unreadable file, or a version no runtime reads. `named`
 * is the path whose extension says which format it is (a cooked copy may carry
 * a `.bin` suffix). Shared with the settings page, so it attributes skeletons
 * to runtimes exactly as the export does.
 */
export async function spineSkeletonVersion(file: string, named: string = file): Promise<SpineVersion | null> {
  const ext = path.extname(named).toLowerCase();
  try {
    if (ext === '.skel') return detectSpineVersion(new Uint8Array(await readFile(file)));
    if (ext === '.json') return detectSpineVersionJson(await readFile(file, 'utf8'));
  } catch { /* unreadable — cookAssets already warned */ }
  return null;
}

/**
 * Each staged skeleton by the Spine runtime it was exported for, read from the
 * file itself (paths are the authored ones). The web carries a side module per
 * version; a native host links ONE runtime, so this is also what an export holds
 * a native template against.
 */
export async function scanSpineSkeletons(
  cookEntries: readonly CookEntryLike[], stagedDir: string,
): Promise<Map<SpineVersion, string[]>> {
  const byVersion = new Map<SpineVersion, string[]>();
  for (const e of cookEntries) {
    if (e.type !== 'spine') continue;
    const v = await spineSkeletonVersion(path.join(stagedDir, e.path), e.sourcePath ?? e.path);
    if (!v) continue;
    const list = byVersion.get(v) ?? [];
    list.push(e.sourcePath ?? e.path);
    byVersion.set(v, list);
  }
  return byVersion;
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

/**
 * What a package pays to READ a KTX2 here: the transcoder's bytes, or undefined
 * where the wasm dir has none to weigh. The cook asks whether the art it is
 * about to encode could ever be worth that much — compressing cannot save more
 * than the art weighs, and one KTX2 obliges the package to carry this.
 */
export function textureDecoderBytes(wasmDir: string): number | undefined {
  const descriptor = SIDE_MODULES[BASIS as keyof typeof SIDE_MODULES];
  if (!descriptor) return undefined;
  try {
    return statSync(path.join(wasmDir, `${descriptor.file}.wasm`)).size;
  } catch {
    return undefined;
  }
}

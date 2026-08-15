// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  runtimeConfig.ts — what a RUNTIME has to be told about the project, once.
 *
 * A project setting is never one fact in one file. "This layer resolves by depth"
 * is a manifest field, a parse branch, something the edit viewport applies, a
 * field in the play payload, and a field a shipped build is written with. Each of
 * those used to be spelled out by hand at its own site, and a setting is only as
 * real as its least-remembered site: the 2.5D depth mask reached the play realm
 * and NEITHER the editor nor any exported build, because the export re-derives
 * the settings from the manifest in the main process and simply never mentioned
 * it. It looked right in Play and shipped wrong — the worst shape a bug can take.
 *
 * So the derivation happens once, as a pure function over a parsed manifest, and
 * both processes call it: the renderer to build the play payload, the main
 * process to build an export (it cannot import ProjectStore — that lives in the
 * window — but it can import this).
 *
 * The values are EFFECTIVE ones, defaults folded in, because "what will the game
 * run with" is the question every caller is asking. Each consumer still decides
 * what to omit from its own wire format (absence = default is how the manifest,
 * the play payload and game.config.json all express a default).
 *
 * Adding a setting means adding it here. `tools/check-project-settings.mjs`
 * fails the build when a field in this shape is not carried by every consumer —
 * or is not listed there as a declared, reasoned gap.
 */
import type { AudioProjectConfig, PackagedGameConfig, PhysicsPluginConfig } from 'esengine';
import { resolveScreenFit, SORTING_LAYER_COUNT, type ProjectManifest } from './format';

/** The project's camera fit as a runtime takes it (`scaleMode < 0` ⇒ off). */
export interface RuntimeScreenFit {
  designWidth: number;
  designHeight: number;
  scaleMode: number;
  matchWidthOrHeight: number;
}

/**
 * Every project setting a runtime is told about, with defaults applied.
 *
 * One shape for the play realm and for a shipped build, because the whole point
 * is that Play is a rehearsal of shipping: a field only one of them carries is a
 * field that makes the rehearsal lie.
 */
export interface RuntimeProjectConfig {
  /** The achievement ids the project declares — the set the runtime refuses an
   *  unlock outside of. Empty ⇒ nothing is checked. */
  achievements: string[];
  /** The Steam application id, when the desktop build ships to Steam. 0 ⇒ it does
   *  not, and no runtime tries to bring a client up. */
  steamAppId: number;
  /** Install physics even when the static scene shows no bodies (runtime-spawned). */
  physicsEnabled: boolean;
  /** World solver + collision matrix (Project Settings → Physics). */
  physicsConfig: PhysicsPluginConfig;
  /** Mixer state: bus volumes, custom buses, effects, duck rules. */
  audioConfig: AudioProjectConfig;
  /** Built-in widget theme; 'dark' is the default. */
  uiTheme: 'dark' | 'light';
  /** Theme colour overrides (role → #rrggbbaa), possibly empty. */
  uiThemeColors: Record<string, string>;
  /** Bitmask of sorting layers (0..31) that y-sort within the layer. */
  ySortLayers: number;
  /** Bitmask of sorting layers (0..31) that resolve by depth — the 2.5D opt-in. */
  depthLayers: number;
  /** Render colour space; 'gamma' is the default. Boot-fixed (shaders compile against it). */
  colorSpace: 'gamma' | 'linear';
  /** GPU backend the build asks for; 'webgl2' is the default. Boot-fixed, and a
   *  request for 'webgpu' still falls back where the machine has none. */
  renderBackend: 'webgl2' | 'webgpu';
  /** Main-camera fit of the design resolution; `scaleMode < 0` = off. */
  screenFit: RuntimeScreenFit;
}

/** Bit i set ⇒ sorting layer i is in `list`. Layers outside 0..31 have no bit. */
function layerMask(list: readonly number[] | undefined): number {
  let mask = 0;
  for (const i of list ?? []) {
    if (Number.isInteger(i) && i >= 0 && i < SORTING_LAYER_COUNT) mask |= 1 << i;
  }
  return mask >>> 0;
}

/** Pad/truncate collision-layer names to the 16 Box2D filter bits (layer 0 = Default). */
export function normalizeCollisionLayers(layers?: string[]): string[] {
  return Array.from({ length: 16 }, (_, i) => layers?.[i] ?? (i === 0 ? 'Default' : ''));
}

/** Pad/truncate the collision matrix to 16 rows; absent rows default to all-collide. */
export function normalizeCollisionLayerMasks(masks?: number[]): number[] {
  return Array.from({ length: 16 }, (_, i) => (typeof masks?.[i] === 'number' ? masks[i] & 0xffff : 0xffff));
}

/**
 * The physics world config a runtime installs, defaults folded in. The solver
 * defaults mirror the engine's own fallbacks, so Project Settings shows the
 * effective values rather than blanks.
 *
 * The collision matrix rides along ONLY when it actually restricts a pair: an
 * all-collide matrix would otherwise override each single-layer collider's own
 * maskBits for nothing.
 */
function physicsConfigOf(features: ProjectManifest['features']): PhysicsPluginConfig {
  const p = features?.physics;
  const config: PhysicsPluginConfig = {
    gravity: p?.gravity ?? { x: 0, y: -9.81 },
    fixedTimestep: p?.fixedTimestep ?? 1 / 60,
    subStepCount: p?.subStepCount ?? 4,
    contactHertz: p?.contactHertz ?? 120,
    contactDampingRatio: p?.contactDampingRatio ?? 10,
    contactSpeed: p?.contactSpeed ?? 10,
    enableSleep: p?.enableSleep ?? true,
    enableContinuous: p?.enableContinuous ?? true,
  };
  const masks = normalizeCollisionLayerMasks(p?.collisionLayerMasks);
  if (masks.some((m) => (m & 0xffff) !== 0xffff)) config.collisionLayerMasks = masks;
  return config;
}

/**
 * The project's effective runtime settings. Takes the parsed manifest shape both
 * processes have — the editor's live project state satisfies it structurally.
 */
export function runtimeConfigOf(
  manifest: Pick<ProjectManifest, 'designResolution' | 'features' | 'packaging'>,
): RuntimeProjectConfig {
  const f = manifest.features;
  return {
    achievements: manifest.packaging?.achievements ?? [],
    // Only when the channel is actually Steam: an app id left behind by a project
    // that has since gone back to a standalone build must not make the runtime
    // hunt for a client.
    steamAppId: manifest.packaging?.platforms?.desktop?.channel === 'steam'
      ? (manifest.packaging?.platforms?.desktop?.steam?.appId ?? 0) : 0,
    physicsEnabled: f?.physics?.enabled ?? false,
    physicsConfig: physicsConfigOf(f),
    audioConfig: f?.audio ?? {},
    uiTheme: f?.ui?.theme === 'light' ? 'light' : 'dark',
    uiThemeColors: f?.ui?.colors ?? {},
    ySortLayers: layerMask(f?.rendering?.ySortLayers),
    depthLayers: layerMask(f?.rendering?.depthLayers),
    colorSpace: f?.rendering?.colorSpace === 'linear' ? 'linear' : 'gamma',
    renderBackend: f?.rendering?.backend === 'webgpu' ? 'webgpu' : 'webgl2',
    screenFit: resolveScreenFit(manifest),
  };
}

/** The settings a shipped build carries, as `game.config.json` spells them. */
export type PackagedRuntimeFields = Pick<
  PackagedGameConfig,
  'ySortLayers' | 'depthLayers' | 'colorSpace' | 'renderBackend' | 'screenFit' | 'uiTheme' | 'uiThemeColors'
  | 'physicsEnabled' | 'physicsConfig' | 'audioConfig' | 'achievements' | 'steamAppId'
>;

/**
 * The shipped-build slice of the config, with defaults OMITTED — absence is how
 * `game.config.json` and the generated mini-game / playable boots all express a
 * default, so an untouched project ships the same bytes it always did.
 *
 * Every packaged target goes through this one function rather than restating the
 * list, which is what makes "the export forgot a setting" impossible to write
 * rather than merely unlikely.
 */
export function packagedRuntimeFields(rc: RuntimeProjectConfig): PackagedRuntimeFields {
  return {
    ...(rc.ySortLayers ? { ySortLayers: rc.ySortLayers } : {}),
    ...(rc.depthLayers ? { depthLayers: rc.depthLayers } : {}),
    ...(rc.colorSpace === 'linear' ? { colorSpace: rc.colorSpace } : {}),
    ...(rc.renderBackend === 'webgpu' ? { renderBackend: rc.renderBackend } : {}),
    // ALWAYS, even with the fit off (`scaleMode < 0`): it carries the design
    // resolution, which is what a desktop window opens at. One representation, or
    // the window grows a second one that drifts.
    screenFit: rc.screenFit,
    ...(rc.uiTheme === 'light' ? { uiTheme: rc.uiTheme } : {}),
    ...(Object.keys(rc.uiThemeColors).length > 0 ? { uiThemeColors: rc.uiThemeColors } : {}),
    // Physics and the mixer ride along only when the project actually declared
    // something: a build whose settings are all defaults keeps the config it has
    // always had, byte for byte, and the runtime falls back to the same values
    // this would have spelled out.
    ...(rc.physicsEnabled ? { physicsEnabled: true } : {}),
    ...(isDefaultPhysics(rc.physicsConfig) ? {} : { physicsConfig: rc.physicsConfig }),
    ...(rc.audioConfig.buses?.length ? { audioConfig: rc.audioConfig } : {}),
    ...(rc.achievements.length ? { achievements: rc.achievements } : {}),
    ...(rc.steamAppId > 0 ? { steamAppId: rc.steamAppId } : {}),
  };
}

/** Whether the world config is exactly what a runtime would default to anyway. */
function isDefaultPhysics(config: PhysicsPluginConfig): boolean {
  return JSON.stringify(config) === JSON.stringify(DEFAULT_PHYSICS_CONFIG);
}

/** What the cook does to a project's assets, as three flags it takes. */
export interface CookOptions {
  compressTextures: boolean;
  compressAudio: boolean;
  atlasTextures: boolean;
}

/**
 * The cook flags a project's `assetCompression` means. One derivation for the
 * same reason {@link runtimeConfigOf} is one: the Build dialog derived these
 * itself and the headless export passed none of them, so every automated
 * package shipped raw — verifying a build configuration no user ships.
 */
export function cookOptionsOf(manifest: Pick<ProjectManifest, 'packaging'>): CookOptions {
  const on = (manifest.packaging?.assetCompression ?? 'auto') === 'auto';
  return { compressTextures: on, compressAudio: on, atlasTextures: on };
}

/** The effective settings of a project with nothing declared — every default. */
export const DEFAULT_RUNTIME_CONFIG: RuntimeProjectConfig = runtimeConfigOf({});

/** The physics world an undeclared project runs, for "is this worth shipping". */
const DEFAULT_PHYSICS_CONFIG: PhysicsPluginConfig = DEFAULT_RUNTIME_CONFIG.physicsConfig;

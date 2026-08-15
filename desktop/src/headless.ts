// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    headless.ts
 * @brief   Headless boot entry for the editor's render host.
 *          Loaded by a show:false
 *          Electron window; boots the engine with no React UI and publishes
 *          EditorControlSurface on `window` so a driver — the main process via
 *          executeJavaScript today, the editor MCP server later — can open a
 *          scene, advance frames deterministically, and read the rendered pixels
 *          back for reproducible verification.
 */
import { EngineHost } from './engine/EngineHost';
import {
  DeviceStatus, getDeviceStatus, getDeviceLostReport, recoverDevice, finishDeviceRecovery,
  getContextLossGuardInfo, Assets,
} from 'esengine';
// From EditorSession: importing it constructs the default session (which wires the
// Reconciler + SceneStore to the model) before the engine boots below.
import { EditorControlSurface, type EditorControlSurfaceT } from './engine/EditorSession';

declare global {
  interface Window {
    /** Headless driving surface — present only in the headless render host. */
    __estellaHeadless?: {
      /** Resolves once the engine is booted and ready to load a scene. */
      ready: Promise<void>;
      api: EditorControlSurfaceT;
      /** Device-loss driving surface: lets a verifier take the GPU away for real. */
      device: {
        status(): number;
        report(): string;
        recover(): boolean;
        finishRecovery(): void;
        recoverFull(): Promise<boolean>;
        /** The engine's own list of textures still on the placeholder. */
        awaiting(): string[];
        glTables(): Record<string, number>;
        lose(): boolean;
        contextLost(): boolean | null;
        guard(): { target: string; lostEventsSeen: number };
        restore(): boolean;
      };
      /** Freezes the scene's inline mesh geometry onto the GPU; returns how many. */
      makeMeshesResident: () => number;
    };
  }
}

// Viewport size is driver-controlled via the query string (?w=&h=) so captures
// are a known resolution; default to a common 16:9 frame. ?backend=webgpu
// boots the WebGPU backend instead of WebGL2 — the same scene assertions then
// verify both backends.
const params = new URLSearchParams(location.search);
const width = Number(params.get('w')) || 1280;
const height = Number(params.get('h')) || 720;
const backend = params.get('backend') === 'webgpu' ? 'webgpu' : 'webgl2';
const colorSpace = params.get('colorSpace') === 'linear' ? 'linear' : undefined;
// A seed makes the run reproduce — a scene with particles has nothing constant
// to assert without one.
const seedParam = params.get('seed');
const randomSeed = seedParam !== null && Number.isFinite(Number(seedParam)) ? Number(seedParam) : undefined;
// A depth-layer mask, so the harness can exercise the 2.5D path the same way a
// project setting would — the engine takes a mask, not a checkbox list.
const depthLayers = Number(params.get('depthLayers')) || undefined;

// Taking the context away FOR REAL, through the extension the browser provides
// for exactly this. Simulating a loss by calling notifyDeviceLost would only
// test the bookkeeping; the point is to make the GPU objects actually die.
//
// Held from before the loss: getExtension on an already-lost context is not
// required to hand the object back, and restoreContext has to be called on the
// same one that took the context away.
let cachedLoseExt: { loseContext(): void; restoreContext(): void } | null = null;
function loseContextExtension(): { loseContext(): void; restoreContext(): void } | null {
  if (cachedLoseExt) return cachedLoseExt;
  // The host's canvas, not a query: on WebGL2 it is never attached to the
  // document, so document.querySelector finds nothing.
  const gl = EngineHost.canvas?.getContext('webgl2') as WebGL2RenderingContext | null;
  cachedLoseExt = gl?.getExtension('WEBGL_lose_context') ?? null;
  return cachedLoseExt;
}

window.__estellaHeadless = {
  ready: EngineHost.bootHeadless({ width, height, backend, colorSpace, depthLayers, randomSeed }),
  api: EditorControlSurface,
  device: {
    status: () => getDeviceStatus(),
    report: () => getDeviceLostReport(),
    recover: () => recoverDevice(),
    finishRecovery: () => finishDeviceRecovery(),
    recoverFull: async () => {
      const assets = EngineHost.getResource(Assets);
      if (!assets) return false;
      return assets.recoverFromDeviceLoss();
    },
    // The engine's list, not a count: which textures did not come back is the
    // answer a failing recovery needs, and a number cannot give it.
    awaiting: () => (EngineHost.getResource(Assets)?.texturesAwaitingReupload() ?? [])
      .map((t) => `${t.handle}|${t.path}`),
    // EXPERIMENT: emscripten's GL object tables are the suspected blocker —
    // they hold wrappers minted against the dead context. Counting them says
    // whether a rebuild refilled them or merely added to the stale ones.
    glTables: () => {
      const GL = (EngineHost.module as unknown as { GL?: Record<string, unknown> } | null)?.GL;
      const count = (name: string): number => {
        const t = GL?.[name] as unknown[] | undefined;
        if (!t) return -1;
        let n = 0;
        for (const e of t) if (e) n++;
        return n;
      };
      return {
        programs: count('programs'), shaders: count('shaders'), buffers: count('buffers'),
        textures: count('textures'), vaos: count('vaos'), framebuffers: count('framebuffers'),
      };
    },
    guard: () => getContextLossGuardInfo(),
    contextLost: () => {
      const gl = EngineHost.canvas?.getContext('webgl2') as WebGL2RenderingContext | null;
      return gl ? gl.isContextLost() : null;
    },
    lose: () => {
      const ext = loseContextExtension();
      if (ext) {
        ext.loseContext();
        return true;
      }
      // WebGPU has no lose-context extension. Destroying the device is the one
      // loss a page can cause, and it reaches the engine as any other would.
      const m = EngineHost.module as unknown as {
        currentWebGPUDevice?: { destroy?(): void };
        preinitializedWebGPUDevice?: { destroy?(): void };
      } | null;
      // The device in use, not the one booted with: after a recovery those differ,
      // and destroying the dead one again is not a loss.
      const gpu = m?.currentWebGPUDevice ?? m?.preinitializedWebGPUDevice;
      if (!gpu?.destroy) return false;
      gpu.destroy();
      return true;
    },
    restore: () => {
      const ext = loseContextExtension();
      if (!ext) return false;
      ext.restoreContext();
      return true;
    },
  },
  // Every Mesh2D in the scene, frozen onto the GPU. The point of driving it from
  // here is that nothing about the geometry changes — same entity, same vertices,
  // the other path — so the frame afterwards has to be the same frame.
  makeMeshesResident: () => {
    const m = EngineHost.module as unknown as {
      mesh2d_makeAllResident?(registry: unknown): number;
    } | null;
    const registry = EngineHost.mutableWorld()?.getCppRegistry();
    if (!m?.mesh2d_makeAllResident || !registry) return 0;
    return m.mesh2d_makeAllResident(registry);
  },
};

// Referenced so the unused-import check sees it; DeviceStatus is the vocabulary
// a driver compares status() against.
export const DEVICE_STATUS_VOCAB = DeviceStatus;

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
  getContextLossGuardInfo,
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
        lose(): boolean;
        contextLost(): boolean | null;
        guard(): { target: string; lostEventsSeen: number };
        restore(): boolean;
      };
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
  ready: EngineHost.bootHeadless({ width, height, backend, colorSpace, depthLayers }),
  api: EditorControlSurface,
  device: {
    status: () => getDeviceStatus(),
    report: () => getDeviceLostReport(),
    recover: () => recoverDevice(),
    finishRecovery: () => finishDeviceRecovery(),
    guard: () => getContextLossGuardInfo(),
    contextLost: () => {
      const gl = EngineHost.canvas?.getContext('webgl2') as WebGL2RenderingContext | null;
      return gl ? gl.isContextLost() : null;
    },
    lose: () => {
      const ext = loseContextExtension();
      if (!ext) return false;
      ext.loseContext();
      return true;
    },
    restore: () => {
      const ext = loseContextExtension();
      if (!ext) return false;
      ext.restoreContext();
      return true;
    },
  },
};

// Referenced so the unused-import check sees it; DeviceStatus is the vocabulary
// a driver compares status() against.
export const DEVICE_STATUS_VOCAB = DeviceStatus;

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

window.__estellaHeadless = {
  ready: EngineHost.bootHeadless({ width, height, backend, colorSpace }),
  api: EditorControlSurface,
};

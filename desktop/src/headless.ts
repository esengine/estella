/**
 * @file    headless.ts
 * @brief   Headless boot entry for the editor's render host
 *          (docs/REARCH_EDITOR_AUTOMATION.md P1). Loaded by a show:false
 *          Electron window; boots the engine with no React UI and publishes
 *          EditorControlSurface on `window` so a driver — the main process via
 *          executeJavaScript today, the editor MCP server later — can open a
 *          scene, advance frames deterministically, and read the rendered pixels
 *          back for reproducible verification.
 */
import { EngineHost } from './engine/EngineHost';
import { EditorControlSurface, type EditorControlSurfaceT } from './engine/EditorControlSurface';

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
// are a known resolution; default to a common 16:9 frame.
const params = new URLSearchParams(location.search);
const width = Number(params.get('w')) || 1280;
const height = Number(params.get('h')) || 720;

window.__estellaHeadless = {
  ready: EngineHost.bootHeadless({ width, height }),
  api: EditorControlSurface,
};

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    immersive.ts
 * @brief   An immersive VR session on the web: entering it, driving the game's frames from it, and leaving it.
 *
 * @details WebXR gives an immersive session three things the page does not otherwise have: frames of its own (the headset's
 *          rate, and the only frames it shows), a framebuffer of its own (an `XRWebGLLayer`'s, both eyes side by side), and
 *          a pose for each eye every frame. Entering hands all three to the engine: the App's loop is driven by the session's
 *          frames (`App.setFrameSource`), the screen's frames are drawn into the layer (`Renderer.setScreenTarget`), and each
 *          frame's eyes are published for the render system to draw (xrPresentation.ts). Leaving, by the player, by the
 *          headset or by `exitVR`, gives all three back.
 *
 *          The layer is a WebGL one, so VR needs the WebGL2 renderer on the page's own thread: a WebGPU build or a threaded
 *          one has no context here to give the session, and `enterVR` says so instead of presenting nothing.
 *
 *          A frame is shown only if it is drawn inside the session's frame callback. The App draws in the same task as the
 *          callback when its systems answer at once; one that awaits something slower makes that frame late, and it is
 *          counted (`missedFrames`) rather than shown.
 */
import type { App } from '../app/app';
import { Renderer } from '../render/renderer';
import { log } from '../util/logger';
import { setXRPresentation, xrPresentation, type XREyeView, type XRPresentationState } from './xrPresentation';

// The slice of WebXR used here: the DOM library TypeScript ships does not declare it.
interface XRRigidTransformLike {
    position: { x: number; y: number; z: number };
    orientation: { x: number; y: number; z: number; w: number };
}
interface XRViewLike { eye: 'left' | 'right' | 'none'; projectionMatrix: Float32Array; transform: XRRigidTransformLike }
interface XRViewerPoseLike { transform: XRRigidTransformLike; views: readonly XRViewLike[] }
interface XRFrameLike { getViewerPose(space: unknown): XRViewerPoseLike | null }
interface XRWebGLLayerLike {
    framebuffer: WebGLFramebuffer | null;
    framebufferWidth: number;
    framebufferHeight: number;
    getViewport(view: XRViewLike): { x: number; y: number; width: number; height: number } | null;
}
interface XRSessionLike {
    requestAnimationFrame(cb: (time: number, frame: XRFrameLike) => void): number;
    cancelAnimationFrame(handle: number): void;
    updateRenderState(state: { baseLayer?: XRWebGLLayerLike; depthNear?: number; depthFar?: number }): void;
    requestReferenceSpace(type: string): Promise<unknown>;
    end(): Promise<void>;
    addEventListener(type: 'end', cb: () => void): void;
}
interface XRSystemLike {
    isSessionSupported(mode: string): Promise<boolean>;
    requestSession(mode: string, init?: { optionalFeatures?: string[]; requiredFeatures?: string[] }): Promise<XRSessionLike>;
}
type XRWebGLLayerCtor = new (session: XRSessionLike, gl: WebGL2RenderingContext,
    init?: { antialias?: boolean; depth?: boolean; stencil?: boolean; alpha?: boolean }) => XRWebGLLayerLike;

function xrSystem(): XRSystemLike | null {
    const nav = typeof navigator !== 'undefined' ? (navigator as { xr?: XRSystemLike }) : null;
    return nav?.xr ?? null;
}

/** Whether this browser can present immersive VR at all (a headset, or an emulator standing in for one). */
export async function vrSupported(): Promise<boolean> {
    const xr = xrSystem();
    if (!xr || typeof xr.isSessionSupported !== 'function') return false;
    try {
        return await xr.isSessionSupported('immersive-vr');
    } catch {
        return false;
    }
}

/** The page's WebGL2 context the engine draws with, or null under WebGPU or a threaded renderer. */
function engineGL(app: App): WebGL2RenderingContext | null {
    const gl = app.wasmModule?.GL?.currentContext?.GLctx;
    if (!gl || typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) return null;
    return gl;
}

interface Running {
    session: XRSessionLike;
    state: XRPresentationState;
    end(): void;
}
const running = new WeakMap<App, Running>();

/** What `enterVR` may be told. */
export interface EnterVROptions {
    /**
     * Where the session's origin is. `local` (the default) puts it where the head was when the session began, so the
     * player's eyes start where the game's camera stands. `local-floor` puts it on the floor under them, for a camera placed
     * on the ground the player stands on.
     */
    referenceSpace?: 'local' | 'local-floor';
}

/**
 * Presents the app in a VR headset until the player leaves (or {@link exitVR}). Must be called from a user gesture (a click),
 * as the browser asks. Throws, having changed nothing, when the browser has no immersive VR or the renderer cannot draw into
 * a headset (WebGPU, threaded).
 */
export async function enterVR(app: App, options: EnterVROptions = {}): Promise<void> {
    if (running.has(app)) return;
    const xr = xrSystem();
    if (!xr) throw new Error('This browser has no WebXR: VR needs a headset browser, or a desktop one with a headset or an emulator.');
    const gl = engineGL(app);
    if (!gl) throw new Error('VR needs the WebGL2 renderer on the page\'s own thread: a WebGPU or threaded build cannot draw into a headset yet.');
    const module = app.wasmModule!;
    const glTable = module.GL;
    if (!glTable.framebuffers) throw new Error('internal: this engine build does not expose its framebuffer table, so a headset\'s framebuffer cannot be drawn into.');

    const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    let fbId = 0;
    try {
        // A context made before the headset was known may sit on another GPU; this moves it, or resolves at once.
        await (gl as WebGL2RenderingContext & { makeXRCompatible?(): Promise<void> }).makeXRCompatible?.();
        const Layer = (globalThis as { XRWebGLLayer?: XRWebGLLayerCtor }).XRWebGLLayer;
        if (!Layer) throw new Error('This browser has WebXR but no XRWebGLLayer.');
        const layer = new Layer(session, gl, { antialias: true, depth: true, stencil: true, alpha: false });
        session.updateRenderState({ baseLayer: layer });
        const space = await session.requestReferenceSpace(options.referenceSpace ?? 'local');
        if (!layer.framebuffer) throw new Error('The headset\'s layer has no framebuffer to draw into.');
        fbId = glTable.getNewId(glTable.framebuffers);
        glTable.framebuffers[fbId] = layer.framebuffer;
        if (!Renderer.setScreenTarget(fbId)) throw new Error('This renderer cannot draw into a headset\'s framebuffer.');

        const state: XRPresentationState = {
            views: [], framebufferWidth: layer.framebufferWidth, framebufferHeight: layer.framebufferHeight,
            headPosition: { x: 0, y: 0, z: 0 }, headOrientation: { x: 0, y: 0, z: 0, w: 1 },
            depthNear: 0.1, depthFar: 1000, wantNear: 0.1, wantFar: 1000,
            frameActive: false, drawnFrames: 0, missedFrames: 0,
        };
        const onFrame = (frame: XRFrameLike): void => {
            state.frameActive = true;
            // The window closes with the task: whatever draws after it draws a frame nobody sees.
            setTimeout(() => { state.frameActive = false; }, 0);
            // The clip planes the rig camera asked for last frame: the session builds the next projections for them.
            if (state.wantNear !== state.depthNear || state.wantFar !== state.depthFar) {
                session.updateRenderState({ depthNear: state.wantNear, depthFar: state.wantFar });
                state.depthNear = state.wantNear;
                state.depthFar = state.wantFar;
            }
            state.framebufferWidth = layer.framebufferWidth;
            state.framebufferHeight = layer.framebufferHeight;
            const pose = frame.getViewerPose(space);
            if (!pose) { state.views = []; return; }
            state.headPosition = { ...pose.transform.position };
            state.headOrientation = { ...pose.transform.orientation };
            const views: XREyeView[] = [];
            for (const view of pose.views) {
                const vp = layer.getViewport(view);
                if (!vp) continue;
                views.push({
                    eye: view.eye,
                    projection: Float32Array.from(view.projectionMatrix),
                    position: { ...view.transform.position },
                    orientation: { ...view.transform.orientation },
                    viewport: { x: vp.x, y: vp.y, w: vp.width, h: vp.height },
                });
            }
            state.views = views;
        };

        let ended = false;
        const end = (): void => {
            if (ended) return;
            ended = true;
            running.delete(app);
            setXRPresentation(app, null);
            app.setFrameSource(null);
            Renderer.setScreenTarget(0);
            delete glTable.framebuffers![fbId];
            log.info('xr', `left VR: ${state.drawnFrames} frame(s) shown, ${state.missedFrames} drawn too late to be`);
        };
        session.addEventListener('end', end);
        running.set(app, { session, state, end });
        setXRPresentation(app, state);
        app.setFrameSource({
            request: (step) => session.requestAnimationFrame((time, frame) => { onFrame(frame); step(time); }),
            cancel: (handle) => session.cancelAnimationFrame(handle),
        });
        log.info('xr', `entered VR: ${layer.framebufferWidth}x${layer.framebufferHeight} framebuffer`);
    } catch (e) {
        if (fbId) {
            Renderer.setScreenTarget(0);
            delete glTable.framebuffers[fbId];
        }
        await session.end().catch(() => {});
        throw e;
    }
}

/** Leaves VR, if the app presents in a headset; the page's own frames take over again. */
export async function exitVR(app: App): Promise<void> {
    const r = running.get(app);
    if (!r) return;
    try {
        await r.session.end();
    } finally {
        // The session's `end` event does this too; whichever comes first, once.
        r.end();
    }
}

/** Whether the app presents in a headset now. */
export function inVR(app: App): boolean {
    return xrPresentation(app) !== null;
}

/**
 * A button that enters VR, and leaves it while presenting, shown only where the browser can present (`vrSupported`).
 * Placed in `parent` (the page's body by default), bottom right; answers what takes it away again.
 */
export function mountVRButton(app: App, parent?: HTMLElement): () => void {
    if (typeof document === 'undefined') return () => {};
    const host = parent ?? document.body;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Enter VR';
    button.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:10;padding:8px 14px;font:14px system-ui,sans-serif;'
        + 'color:#fff;background:#2c2c2c;border:1px solid #555;border-radius:4px;cursor:pointer;display:none';
    let busy = false;
    const sync = (): void => { button.textContent = inVR(app) ? 'Exit VR' : 'Enter VR'; };
    button.addEventListener('click', () => {
        if (busy) return;
        busy = true;
        const step = inVR(app) ? exitVR(app) : enterVR(app);
        step.catch((e: unknown) => log.error('xr', 'could not enter VR', e)).finally(() => { busy = false; sync(); });
    });
    host.appendChild(button);
    let gone = false;
    void vrSupported().then((ok) => { if (ok && !gone) button.style.display = ''; });
    const timer = setInterval(sync, 500);
    return () => {
        gone = true;
        clearInterval(timer);
        button.remove();
    };
}

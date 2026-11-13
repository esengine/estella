// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  shaderWarmup.ts
 * @brief Letting the shaders a scene draws with finish compiling before it is shown.
 *
 * With `quality.asyncShaderCompile` a draw whose shader the browser is still compiling is left out, so a scene that opens straight onto its first
 * frame fills in as its shaders are ready. {@link warmShaders} is the other choice: draw the scene's frames out of sight until nothing is
 * compiling any more (behind a loading screen), and open on a complete picture.
 */
import type { App } from '../app/app';
import type { ESEngineModule } from '../wasm';

/** What a warm-up did. */
export interface ShaderWarmup {
    /** Frames drawn out of sight. */
    frames: number;
    /** Milliseconds it took. */
    ms: number;
    /** Shaders still compiling when it stopped: 0 unless it gave up. */
    pending: number;
    /** It stopped because the time was up, not because everything was ready. */
    timedOut: boolean;
}

/** @experimental */
export interface ShaderWarmupOptions {
    /** How long to wait for the compiles before giving up and opening anyway. Default 30000. */
    timeoutMs?: number;
    /** Consecutive frames in which nothing was compiling before it counts as done: a frame can ask for a shader the one before did not. Default 3. */
    settleFrames?: number;
    /** Called after each frame with how many shaders are still compiling, and how much the scene's holds say is still to be made. */
    onProgress?: (pending: number, making: number) => void;
}

const holds = new WeakMap<App, Set<() => boolean | number>>();

/**
 * Tells {@link warmShaders} that part of the scene is still being made while `busy` answers true: a ground whose pages are being painted, a field
 * whose cells are being grown. What is made later draws with shaders nothing has asked for yet, and a warm-up that stopped at the first quiet
 * frames opened on a scene that then filled in. A number is how much is left to make (pages, cells: whatever the maker counts in), which
 * a loading screen can show going down; true is one thing of no size. Returns what takes the hold away.
 * @experimental
 */
export function holdShaderWarmup(app: App, busy: () => boolean | number): () => void {
    let set = holds.get(app);
    if (!set) holds.set(app, set = new Set());
    set.add(busy);
    return () => { set.delete(busy); };
}

/** How much the holds say is still being made: 0 when nothing is. */
function making(app: App): number {
    const set = holds.get(app);
    if (!set) return 0;
    let left = 0;
    for (const busy of set) {
        try {
            const n = busy();
            left += n === true ? 1 : typeof n === 'number' && n > 0 ? n : 0;
        } catch { /* a probe that throws holds nothing */ }
    }
    return left;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * How many shaders are still compiling in the background (0 when shaders are not compiled that way).
 * @experimental
 */
export function pendingShaders(source: App | ESEngineModule | null): number {
    const module = source && 'wasmModule' in source ? (source as App).wasmModule : (source as ESEngineModule | null);
    return module?.renderer_getPendingShaders?.() ?? 0;
}

/**
 * Waits until no shader is compiling. For a host that asked the engine to ready programs (a scene being prepared) and wants "ready" to be true.
 * @experimental
 */
export async function shadersCompiled(module: ESEngineModule | null, timeoutMs = 30000): Promise<boolean> {
    const start = now();
    while (pendingShaders(module) > 0) {
        if (now() - start > timeoutMs) return false;
        await sleep(8);
    }
    return true;
}

/**
 * Draws the app's frames out of sight until its shaders have finished compiling, so what is shown first is complete.
 *
 * The frames advance the world by a tenth of a millisecond each: they exist to make the renderer ask for the shaders the scene needs (a variant is
 * only asked for when something first draws with it), not to play the game. Meant for a loading screen, before the first visible frame.
 * It also waits for what {@link holdShaderWarmup} says is still being made.
 * @experimental
 */
export async function warmShaders(app: App, options: ShaderWarmupOptions = {}): Promise<ShaderWarmup> {
    const timeoutMs = options.timeoutMs ?? 30000;
    const settle = Math.max(options.settleFrames ?? 3, 1);
    const module = app.wasmModule;
    const start = now();
    let frames = 0;
    let quiet = 0;
    let pending = 0;
    // A core that does not compile this way has nothing to wait for.
    if (!module?.renderer_getPendingShaders) return { frames, ms: 0, pending: 0, timedOut: false };
    while (quiet < settle) {
        if (now() - start > timeoutMs) return { frames, ms: now() - start, pending, timedOut: true };
        await app.stepFrames(1, 1e-4);
        ++frames;
        pending = module.renderer_getPendingShaders?.() ?? 0;
        const left = making(app);
        options.onProgress?.(pending, left);
        // Quiet is nothing compiling AND nothing still being made that will ask for more.
        quiet = pending === 0 && left === 0 ? quiet + 1 : 0;
        // The browser compiles between tasks: give it one.
        await sleep(8);
    }
    return { frames, ms: now() - start, pending: 0, timedOut: false };
}

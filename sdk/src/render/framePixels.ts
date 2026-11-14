// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Asking the engine what it drew.
 *
 *        One answer for both backends, from the side that holds the pixels — a
 *        host that reads the page instead gets the DISPLAY's answer, colour
 *        managed on a wide-gamut machine, so a frame painting rgb(0,255,0) reads
 *        back as rgb(58,254,32) with nothing rendered wrong.
 *
 *        GL reads what is on the canvas now, at once. WebGPU books the copy for the
 *        end of its own frame, so the caller has to let a frame happen: that is what
 *        `advance` is for, and it is the whole difference between the backends. A
 *        render target's read ({@link captureTargetPixels}) lands later on both.
 */
import { awaitReadback, READBACK_READY } from './readback';
import { withScratch } from '../wasm/wasmScratch';
import type { ESEngineModule } from '../wasm';

/** Pixels as every capture consumer expects them: RGBA, rows bottom-up. */
export interface FramePixels {
    rgba: Uint8Array;
    width: number;
    height: number;
}

type CaptureModule = ESEngineModule & {
    renderer_captureFrame?(w: number, h: number): number;
    renderer_pollFrameCapture?(handle: number): number;
    renderer_takeFrameCapture?(handle: number, dest: number, destSize: number): boolean;
    renderer_captureTarget?(target: number, w: number, h: number): number;
    renderer_takeTargetCapture?(handle: number, dest: number, destSize: number): boolean;
};

/** Whether this build can return its own pixels — an older wasm cannot. */
export function canCaptureFramePixels(module: ESEngineModule): boolean {
    const m = module as CaptureModule;
    return typeof m.renderer_captureFrame === 'function'
        && typeof m.renderer_pollFrameCapture === 'function'
        && typeof m.renderer_takeFrameCapture === 'function';
}

/**
 * The next completed frame, read from the engine.
 *
 * `advance` runs one frame — a driver's own step, or waiting a rAF under a live
 * loop. Null when the build cannot capture, when the request is refused (a
 * WebGPU surface configured without readback), or when the readback never lands.
 *
 * @beta
 */
export async function captureFramePixels(
    module: ESEngineModule,
    width: number,
    height: number,
    advance?: () => void | Promise<void>,
): Promise<FramePixels | null> {
    const m = module as CaptureModule;
    if (!canCaptureFramePixels(module) || width <= 0 || height <= 0) return null;

    const handle = m.renderer_captureFrame!(width, height);
    if (!handle) return null;

    if (advance) await advance();
    return landPixels(m, handle, width, height, m.renderer_takeFrameCapture!);
}

/** Whether this build can read a render target back — an older wasm cannot. */
export function canCaptureTargetPixels(module: ESEngineModule): boolean {
    const m = module as CaptureModule;
    return typeof m.renderer_captureTarget === 'function'
        && typeof m.renderer_pollFrameCapture === 'function'
        && typeof m.renderer_takeTargetCapture === 'function';
}

/**
 * What a render target holds, read from the engine once the GPU has drawn it (rows bottom-up, as a frame).
 *
 * The draw happened before this is called; nothing here waits for it on the page's thread. Null when the build cannot
 * capture a target, the target is gone, or the readback never lands.
 *
 * @beta
 */
export async function captureTargetPixels(
    module: ESEngineModule,
    target: number,
    width: number,
    height: number,
): Promise<FramePixels | null> {
    const m = module as CaptureModule;
    if (!canCaptureTargetPixels(module) || width <= 0 || height <= 0) return null;
    const handle = m.renderer_captureTarget!(target, width, height);
    if (!handle) return null;
    return landPixels(m, handle, width, height, m.renderer_takeTargetCapture!);
}

/** Waits for a booked readback and copies it out of the engine. */
async function landPixels(
    m: CaptureModule, handle: number, width: number, height: number,
    take: (handle: number, dest: number, destSize: number) => boolean,
): Promise<FramePixels | null> {
    if (await awaitReadback(() => m.renderer_pollFrameCapture!(handle)) !== READBACK_READY) return null;
    const size = width * height * 4;
    const rgba = new Uint8Array(size);
    const ok = withScratch(m, (alloc) => {
        const ptr = alloc(size);
        if (!ptr) return false;
        if (!take(handle, ptr, size)) return false;
        rgba.set(m.HEAPU8.subarray(ptr, ptr + size));
        return true;
    });
    return ok ? { rgba, width, height } : null;
}

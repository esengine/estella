// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/screen.ts
 * @brief   The rectangle a root UI node aligns to (Cocos's "visible rect"), and the window it sits in.
 *
 * A widget on a node whose parent has no rectangle of its own (the canvas, or anything straight under the scene) aligns to the
 * visible area of the screen, which in the engine is centred on the world origin, so the rectangle is a width and a height about it. The frame loop sets it from the UI camera every frame
 * (see pass.ts); until it does, it is the size of a typical design resolution so a scene still lays out.
 */

import type { UICameraData } from '../../ui/core/ui-camera-info';
import type { ScreenLayoutData } from '../../ui/core/screen-layout';
import type { World } from '../../ecs/world';

let uiCamera: UICameraData | null = null;
let width = 960;
let height = 640;
let generation = 0;
let safeLeft = 0;
let safeRight = 0;
let safeTop = 0;
let safeBottom = 0;
let windowW = 960;
let windowH = 640;
const listeners: Array<(kind: 'visible' | 'window') => void> = [];

let projectDesign: { width: number; height: number; scaleMode: number } | null = null;
/** @internal The project's own design resolution and fit (the engine's screen scaling), which a script that never set one reads. */
export function setProjectDesign(width: number, height: number, scaleMode: number): void { projectDesign = scaleMode >= 0 ? { width, height, scaleMode } : null; }
/** @internal */
export function getProjectDesign(): { width: number; height: number; scaleMode: number } | null { return projectDesign; }

let screenLayout: ScreenLayoutData | null = null;
/** @internal The layout the pass last saw, for an alignment a script asks for now. */
export function setScreenLayout(layout: ScreenLayoutData | null): void { screenLayout = layout; }
/** @internal */
export function getScreenLayoutOf(_world: World): ScreenLayoutData | null { return screenLayout; }

/** The visible area's size, in the canvas units scripts see. */
export function getVisibleSize(): { width: number; height: number } { return { width, height }; }

/** How far in from each edge of the visible area the safe area starts (a notch, a rounded corner, a home bar), in canvas units. */
export function getSafeInsets(): { left: number; right: number; top: number; bottom: number } {
    return { left: safeLeft, right: safeRight, top: safeTop, bottom: safeBottom };
}

export function setSafeInsets(left: number, right: number, top: number, bottom: number): void {
    if (left === safeLeft && right === safeRight && top === safeTop && bottom === safeBottom) return;
    safeLeft = left; safeRight = right; safeTop = top; safeBottom = bottom;
    generation++;
    for (const l of [...listeners]) l('visible');
}

/** Tell the layer the visible area changed; widgets set to follow the window re-align. */
export function setVisibleSize(w: number, h: number): void {
    if (w === width && h === height) return;
    width = w;
    height = h;
    generation++;
    for (const l of [...listeners]) l('visible');
}

/** Bumps whenever the visible size changes. */
export function visibleSizeGeneration(): number { return generation; }

/** The window (the drawing surface) in physical pixels. */
export function getWindowPixels(): { width: number; height: number } { return { width: windowW, height: windowH }; }

export function setWindowPixels(w: number, h: number): void {
    if (w === windowW && h === windowH) return;
    windowW = w;
    windowH = h;
    for (const l of [...listeners]) l('window');
}

/** Hear about a change to either size. Returns the way to stop hearing. */
export function onScreenChange(listener: (kind: 'visible' | 'window') => void): () => void {
    listeners.push(listener);
    return () => { const i = listeners.indexOf(listener); if (i >= 0) listeners.splice(i, 1); };
}

/** The UI camera's data as of the last frame (the live object the frame loop keeps current), for the conversions a camera offers. */
export function setUiCameraData(data: UICameraData | null): void { uiCamera = data; }
export function uiCameraData(): UICameraData | null { return uiCamera; }

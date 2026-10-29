// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/screen.ts
 * @brief   The rectangle a root UI node aligns to (Cocos's "visible rect"), and the window it sits in.
 *
 * A widget on a node whose parent has no rectangle of its own (the canvas, or anything straight under the scene) aligns to the
 * visible area of the screen. In an imported scene the engine's world and Cocos's are one space, with the visible area running from
 * the origin to its size, so the rectangle is just a width and a height. The frame loop sets it from the UI camera every frame
 * (see pass.ts); until it does, it is the size of a typical design resolution so a scene still lays out.
 */

let width = 960;
let height = 640;
let generation = 0;
let windowW = 960;
let windowH = 640;
const listeners: Array<(kind: 'visible' | 'window') => void> = [];

/** The visible area's size, in the canvas units scripts see. */
export function getVisibleSize(): { width: number; height: number } { return { width, height }; }

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

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/screen.ts
 * @brief   The rectangle a root UI node aligns to: Cocos's "visible rect".
 *
 * A widget on a node whose parent has no rectangle of its own (the canvas, or anything straight under the scene) aligns to the
 * visible area of the screen. In an imported scene the engine's world and Cocos's are one space, with the visible area running from
 * the origin to its size, so the rectangle is just a width and a height. The host sets it from the real viewport; until it does, it
 * is the size of a typical design resolution so a scene still lays out.
 */

let width = 960;
let height = 640;
let generation = 0;

/** The visible area's size, in the canvas units scripts see. */
export function getVisibleSize(): { width: number; height: number } { return { width, height }; }

/** Tell the layer the visible area changed; widgets set to follow the window re-align. */
export function setVisibleSize(w: number, h: number): void {
    if (w === width && h === height) return;
    width = w;
    height = h;
    generation++;
}

/** Bumps whenever the visible size changes. */
export function visibleSizeGeneration(): number { return generation; }

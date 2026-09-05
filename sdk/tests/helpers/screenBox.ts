// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The screen a UI test lays out on.
 *
 * One helper because the box UI lays out in has ONE authority (`ScreenLayout`):
 * a test that sets it some other way is testing a path the engine does not take.
 */
import type { App } from '../../src/app/app';
import { ScreenLayout, type ScreenLayoutData } from '../../src/ui/core/screen-layout';

/** A layout box, in layout pixels. One layout pixel is one device pixel here. */
export function screenBox(
    left: number, bottom: number, right: number, top: number,
): ScreenLayoutData {
    return {
        valid: true,
        left, bottom, right, top,
        safeLeft: left, safeBottom: bottom, safeRight: right, safeTop: top,
        scale: 1,
        viewportW: right - left,
        viewportH: top - bottom,
    };
}

/** Install it, whether or not the App already carries one. */
export function setScreenBox(
    app: App, left: number, bottom: number, right: number, top: number,
): void {
    const box = screenBox(left, bottom, right, top);
    if (app.hasResource(ScreenLayout)) Object.assign(app.getResource(ScreenLayout), box);
    else app.insertResource(ScreenLayout, box);
}

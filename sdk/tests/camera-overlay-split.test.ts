// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A full-frame camera that clears no colour is a layer over the main view, not a candidate to be it: a world camera and a UI camera that
 *        clears depth only are both drawn, the world's first.
 */
import { describe, expect, it } from 'vitest';
import { splitOnScreenCameras, type CameraPOV } from '../src/camera/CameraPlugin';

const full = { x: 0, y: 0, z: 1, w: 1 };
const pov = (entity: number, clearFlags: number, priority: number, viewport = full): CameraPOV => ({ entity, clearFlags, priority, viewport } as CameraPOV);

describe('splitOnScreenCameras', () => {
    it('keeps the camera that clears colour as the main view and lays the depth-only one over it', () => {
        const ui = pov(1, 2, 1 << 30), world = pov(2, 3, 0);
        const { fullFrame, overlays } = splitOnScreenCameras([ui, world]);
        expect(fullFrame).toEqual([world]);
        expect(overlays).toEqual([ui]);
    });

    it('leaves a lone depth-only camera as the main view, and two colour cameras as they were', () => {
        const only = pov(1, 2, 0);
        expect(splitOnScreenCameras([only]).fullFrame).toEqual([only]);
        const a = pov(1, 3, 0), b = pov(2, 3, 1);
        const { fullFrame, overlays } = splitOnScreenCameras([a, b]);
        expect(fullFrame).toEqual([a, b]);
        expect(overlays).toEqual([]);
    });

    it('draws sub-viewport cameras and layers over the main view in priority order', () => {
        const world = pov(1, 3, 0), mini = pov(2, 3, 5, { x: 0, y: 0, z: 0.3, w: 0.3 }), ui = pov(3, 2, 9);
        expect(splitOnScreenCameras([ui, mini, world]).overlays).toEqual([mini, ui]);
    });
});

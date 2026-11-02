// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  `renderer.scene.CameraProjection` has Cocos's numbers, and the same as `Camera.ProjectionType`, so a script that compares one with the other
 *        tells an orthographic camera from a perspective one.
 */
import { describe, expect, it } from 'vitest';
import { Camera, renderer } from '../../src/cocos';

describe('renderer.scene.CameraProjection', () => {
    it('is the numbering a Camera answers its projection in', () => {
        expect(renderer.scene.CameraProjection.ORTHO).toBe(Camera.ProjectionType.ORTHO);
        expect(renderer.scene.CameraProjection.PERSPECTIVE).toBe(Camera.ProjectionType.PERSPECTIVE);
        expect(renderer.scene.CameraProjection.ORTHO).not.toBe(renderer.scene.CameraProjection.PERSPECTIVE);
    });

    it('still answers a name it does not have, with a stand-in that does not throw', () => {
        expect(() => new renderer.scene.Camera()).not.toThrow();
    });
});

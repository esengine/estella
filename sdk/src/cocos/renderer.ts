// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/renderer.ts
 * @brief   `cc.renderer`: the render-scene namespace, of which scripts read the constants.
 *
 * A script asks `camera.projection == renderer.scene.CameraProjection.ORTHO` to tell the two kinds of camera apart, so the numbers must be
 * Cocos's: a stand-in there compares unequal to everything and sends an orthographic camera down the perspective path. The scene objects
 * of Cocos's own renderer (`renderer.scene.Camera`, `Model`) are not here, and say so by name when used.
 */
import { unsupported } from './unsupported';

/** An object that answers what it has and a named stand-in for the rest. */
function withStandIns<T extends object>(path: string, known: T): T {
    return new Proxy(known, {
        get(target, key, receiver) {
            if (typeof key === 'symbol' || key in target) return Reflect.get(target, key, receiver);
            return unsupported(`${path}.${key}`);
        },
    });
}

const CameraProjection = Object.freeze({ ORTHO: 0, PERSPECTIVE: 1 });

export const renderer = withStandIns('renderer', {
    scene: withStandIns('renderer.scene', { CameraProjection }),
});

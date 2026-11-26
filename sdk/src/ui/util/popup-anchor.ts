// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { Canvas, Transform } from '../../ecs/component';
import { worldEngineApi, type EngineApi } from '../../ecs/bridge/engineApi';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { spawnUIEntity } from '../core/compose';
import type { ScreenOverlayData } from '../core/screen-overlay';
import type { UICameraData } from '../core/ui-camera-info';
import { UIPointerEvents } from '../core/ui-node';
import { walkParentChain } from './helpers';
import { projectCameraPoint } from './math';
import { isScreenEntity, screenToUiLayout } from './ui-pick';

export interface PopupBounds { left: number; right: number; bottom: number; top: number }

/** Both a tooltip and an option list float above the trigger's clipping ancestors
 *  on its canvas layer. Only the children of an interactive popup receive input. */
export function createPopupCanvas(world: World, target: Entity, pointerEvents: UIPointerEvents): Entity {
    let owner = target;
    if (!world.has(owner, Canvas)) walkParentChain(world, target, ancestor => {
        if (!world.has(ancestor, Canvas)) return false;
        owner = ancestor;
        return true;
    });
    const root = spawnUIEntity({ world, node: { fill: true, pointerEvents } });
    world.insert(root, Canvas, structuredClone(world.has(owner, Canvas) ? world.get(owner, Canvas) : Canvas._default));
    return root;
}

/** The four rendered corners in screen-layout coordinates, including a world
 *  control's depth under a perspective camera. The scratch belongs to the reader. */
export function createPopupBoundsReader(world: World) {
    let engine: EngineApi | null = null, pointer = 0;
    function dispose(): void {
        if (pointer) engine?._free?.(pointer);
        engine = null;
        pointer = 0;
    }
    function read(e: Entity, camera: UICameraData, overlay: ScreenOverlayData): PopupBounds | null {
        const api = worldEngineApi(world), registry = world.getCppRegistry();
        if (!api || !registry || !world.has(e, Transform)) return null;
        const w = api.getUINodeComputedWidth?.(registry, e) ?? 0;
        const h = api.getUINodeComputedHeight?.(registry, e) ?? 0;
        if (!(w > 0 && h > 0)) return null;
        if (engine !== api) { dispose(); engine = api; }
        if (!pointer && api._malloc && api._free) pointer = api._malloc(64);
        if (!pointer || !api.transform_copyFlatRenderMatrix?.(registry, e, pointer) || !api.HEAPU8) return null;
        const heap = api.HEAPU8;
        const m = new Float32Array(heap.buffer, heap.byteOffset + pointer, 16);
        const screen = isScreenEntity(world, e);
        if (!screen && !camera.valid) return null;
        const box = { left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity };
        for (const x of [-w / 2, w / 2]) for (const y of [-h / 2, h / 2]) {
            let sx = m[0] * x + m[4] * y + m[12], sy = m[1] * x + m[5] * y + m[13];
            if (!screen) {
                const z = m[2] * x + m[6] * y + m[14];
                const pixel = projectCameraPoint(camera, sx, sy, z);
                if (!(pixel.clipW > 0)) return null;
                const layout = screenToUiLayout(overlay, pixel.x, pixel.y);
                sx = layout.x; sy = layout.y;
            }
            if (!Number.isFinite(sx) || !Number.isFinite(sy)) return null;
            box.left = Math.min(box.left, sx); box.right = Math.max(box.right, sx);
            box.bottom = Math.min(box.bottom, sy); box.top = Math.max(box.top, sy);
        }
        return box;
    }
    return { read, dispose };
}

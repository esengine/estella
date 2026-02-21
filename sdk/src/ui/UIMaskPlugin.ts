import type { App, Plugin } from '../app';
import type { ESEngineModule, CppRegistry } from '../wasm';
import type { MaskProcessorFn } from '../renderPipeline';
import type { Entity } from '../types';
import type { World } from '../world';
import { registerComponent, WorldTransform } from '../component';
import type { WorldTransformData } from '../component';
import { UIMask, type UIMaskData } from './UIMask';
import { UIRect, type UIRectData } from './UIRect';
import { intersectRects, quaternionToAngle2D, worldToScreen, type ScreenRect } from './uiMath';
import { getEffectiveWidth, getEffectiveHeight, walkParentChain } from './uiHelpers';

function computeMaskScreenRect(
    world: World, entity: Entity,
    vp: Float32Array, vpX: number, vpY: number, vpW: number, vpH: number
): ScreenRect | null {
    if (!world.has(entity, UIRect) || !world.has(entity, WorldTransform)) {
        return null;
    }
    const uiRect = world.get(entity, UIRect) as UIRectData;
    const wt = world.get(entity, WorldTransform) as WorldTransformData;
    const worldW = getEffectiveWidth(uiRect) * wt.scale.x;
    const worldH = getEffectiveHeight(uiRect) * wt.scale.y;
    const cx = wt.position.x;
    const cy = wt.position.y;
    const px = uiRect.pivot.x;
    const py = uiRect.pivot.y;

    const localLeft = -worldW * px;
    const localRight = worldW * (1 - px);
    const localBottom = -worldH * py;
    const localTop = worldH * (1 - py);

    const rz = wt.rotation.z;
    const rw = wt.rotation.w;
    const angle = quaternionToAngle2D(rz, rw);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const corners: [number, number][] = [
        [cx + localLeft * cos - localBottom * sin, cy + localLeft * sin + localBottom * cos],
        [cx + localRight * cos - localBottom * sin, cy + localRight * sin + localBottom * cos],
        [cx + localRight * cos - localTop * sin, cy + localRight * sin + localTop * cos],
        [cx + localLeft * cos - localTop * sin, cy + localLeft * sin + localTop * cos],
    ];

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [wx, wy] of corners) {
        const [sx, sy] = worldToScreen(wx, wy, vp, vpX, vpY, vpW, vpH);
        minX = Math.min(minX, sx);
        minY = Math.min(minY, sy);
        maxX = Math.max(maxX, sx);
        maxY = Math.max(maxY, sy);
    }

    return {
        x: Math.round(minX),
        y: Math.round(minY),
        w: Math.round(maxX - minX),
        h: Math.round(maxY - minY),
    };
}

export function createMaskProcessor(wasm: ESEngineModule, world: World): MaskProcessorFn {
    return (
        cppRegistry: CppRegistry,
        vp: Float32Array,
        vpX: number, vpY: number, vpW: number, vpH: number
    ) => {
        wasm.renderer_clearAllClipRects();
        wasm.renderer_clearAllStencilMasks();

        const maskEntities = world.getEntitiesWithComponents([UIMask]);
        if (maskEntities.length === 0) return;

        const scissorMasks: Entity[] = [];
        const stencilMasks: Entity[] = [];

        const maskSet = new Set<number>();
        const stencilMaskSet = new Set<number>();

        for (const e of maskEntities) {
            const mask = world.get(e, UIMask) as UIMaskData;
            if (!mask.enabled) continue;
            maskSet.add(e as number);
            if (mask.mode === 'stencil') {
                stencilMasks.push(e);
                stencilMaskSet.add(e as number);
            } else {
                scissorMasks.push(e);
            }
        }

        try {
            if (scissorMasks.length > 0) {
                processScissorMasks(wasm, world, cppRegistry, scissorMasks, maskSet, vp, vpX, vpY, vpW, vpH);
            }
            if (stencilMasks.length > 0) {
                processStencilMasks(wasm, world, cppRegistry, stencilMasks, stencilMaskSet, vp, vpX, vpY, vpW, vpH);
            }
        } catch (e) {
            console.error('Mask processing error:', e);
            wasm.renderer_clearAllClipRects();
            wasm.renderer_clearAllStencilMasks();
        }
    };
}

function processScissorMasks(
    wasm: ESEngineModule, world: World, cppRegistry: CppRegistry,
    scissorMasks: Entity[], maskSet: Set<number>,
    vp: Float32Array, vpX: number, vpY: number, vpW: number, vpH: number
): void {
    const rootMasks: Entity[] = [];
    for (const entity of scissorMasks) {
        let isRoot = true;
        walkParentChain(world, entity, (ancestor) => {
            if (maskSet.has(ancestor as number)) {
                const parentMask = world.get(ancestor, UIMask) as UIMaskData;
                if (parentMask.mode === 'scissor') {
                    isRoot = false;
                    return true;
                }
            }
            return false;
        });
        if (isRoot) rootMasks.push(entity);
    }

    function applyToDescendants(entity: Entity, clipRect: ScreenRect): void {
        const children = wasm.getChildEntities(cppRegistry, entity as number);
        for (const childId of children) {
            let childClip = clipRect;

            if (maskSet.has(childId)) {
                const childMask = world.get(childId as Entity, UIMask) as UIMaskData;
                if (childMask.mode === 'scissor') {
                    const childRect = computeMaskScreenRect(
                        world, childId as Entity,
                        vp, vpX, vpY, vpW, vpH
                    );
                    if (childRect) {
                        childClip = intersectRects(clipRect, childRect);
                    }
                }
            }

            wasm.renderer_setEntityClipRect(
                childId, childClip.x, childClip.y, childClip.w, childClip.h
            );
            applyToDescendants(childId as Entity, childClip);
        }
    }

    for (const entity of rootMasks) {
        const screenRect = computeMaskScreenRect(
            world, entity,
            vp, vpX, vpY, vpW, vpH
        );
        if (!screenRect) continue;
        applyToDescendants(entity, screenRect);
    }
}

function processStencilMasks(
    wasm: ESEngineModule, world: World, cppRegistry: CppRegistry,
    stencilMasks: Entity[], stencilMaskSet: Set<number>,
    _vp: Float32Array, _vpX: number, _vpY: number, _vpW: number, _vpH: number
): void {
    wasm.renderer_clearStencil();

    const rootMasks: Entity[] = [];
    for (const entity of stencilMasks) {
        let isRoot = true;
        walkParentChain(world, entity, (ancestor) => {
            if (stencilMaskSet.has(ancestor as number)) {
                isRoot = false;
                return true;
            }
            return false;
        });
        if (isRoot) rootMasks.push(entity);
    }

    let nextRef = 1;
    let overflowed = false;

    function allocStencilRef(): number | null {
        if (nextRef > 255) {
            if (!overflowed) console.warn('Stencil mask overflow');
            overflowed = true;
            return null;
        }
        return nextRef++;
    }

    function applyStencilHierarchy(entity: Entity, refValue: number): void {
        if (overflowed) return;
        wasm.renderer_setEntityStencilMask(entity as number, refValue);

        const children = wasm.getChildEntities(cppRegistry, entity as number);
        for (const childId of children) {
            if (stencilMaskSet.has(childId)) {
                const childRef = allocStencilRef();
                if (childRef === null) return;
                applyStencilHierarchy(childId as Entity, childRef);
            } else {
                wasm.renderer_setEntityStencilTest(childId, refValue);
                applyStencilDescendants(childId as Entity, refValue);
            }
        }
    }

    function applyStencilDescendants(entity: Entity, refValue: number): void {
        if (overflowed) return;
        const children = wasm.getChildEntities(cppRegistry, entity as number);
        for (const childId of children) {
            if (stencilMaskSet.has(childId)) {
                const childRef = allocStencilRef();
                if (childRef === null) return;
                applyStencilHierarchy(childId as Entity, childRef);
            } else {
                wasm.renderer_setEntityStencilTest(childId, refValue);
                applyStencilDescendants(childId as Entity, refValue);
            }
        }
    }

    for (const entity of rootMasks) {
        if (overflowed) break;
        const refValue = allocStencilRef();
        if (refValue === null) return;
        applyStencilHierarchy(entity, refValue);
    }
}

export class UIMaskPlugin implements Plugin {
    build(app: App): void {
        registerComponent('UIMask', UIMask);

        if (!app.wasmModule) return;
        const pipeline = app.pipeline;
        if (!pipeline) return;

        pipeline.setMaskProcessor(createMaskProcessor(app.wasmModule, app.world));
    }
}

export const uiMaskPlugin = new UIMaskPlugin();

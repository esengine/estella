import type { App, Plugin } from '../app';
import type { ESEngineModule, CppRegistry } from '../wasm';
import type { MaskProcessorFn } from '../renderPipeline';
import type { Entity } from '../types';
import type { World } from '../world';
import { registerComponent, WorldTransform, Parent } from '../component';
import type { WorldTransformData, ParentData } from '../component';
import { UIMask, type UIMaskData } from './UIMask';
import { UIRect, type UIRectData } from './UIRect';
import { worldRectToScreen, intersectRects, type ScreenRect } from './uiMath';

function computeMaskScreenRect(
    world: World, entity: Entity,
    vp: Float32Array, vpX: number, vpY: number, vpW: number, vpH: number
): ScreenRect | null {
    if (!world.has(entity, UIRect) || !world.has(entity, WorldTransform)) {
        return null;
    }
    const uiRect = world.get(entity, UIRect) as UIRectData;
    const wt = world.get(entity, WorldTransform) as WorldTransformData;
    const worldW = uiRect.size.x * wt.scale.x;
    const worldH = uiRect.size.y * wt.scale.y;
    return worldRectToScreen(
        wt.position.x, wt.position.y,
        worldW, worldH,
        uiRect.pivot.x, uiRect.pivot.y,
        vp, vpX, vpY, vpW, vpH
    );
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
        } catch (_) {
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
        let current = entity;
        while (world.has(current, Parent)) {
            const p = world.get(current, Parent) as ParentData;
            if (maskSet.has(p.entity as number)) {
                const parentMask = world.get(p.entity, UIMask) as UIMaskData;
                if (parentMask.mode === 'scissor') {
                    isRoot = false;
                    break;
                }
            }
            current = p.entity;
        }
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
        let current = entity;
        while (world.has(current, Parent)) {
            const p = world.get(current, Parent) as ParentData;
            if (stencilMaskSet.has(p.entity as number)) {
                isRoot = false;
                break;
            }
            current = p.entity;
        }
        if (isRoot) rootMasks.push(entity);
    }

    let nextRef = 1;

    function applyStencilHierarchy(entity: Entity, refValue: number): void {
        wasm.renderer_setEntityStencilMask(entity as number, refValue);

        const children = wasm.getChildEntities(cppRegistry, entity as number);
        for (const childId of children) {
            if (stencilMaskSet.has(childId)) {
                const childRef = nextRef++;
                applyStencilHierarchy(childId as Entity, childRef);
            } else {
                wasm.renderer_setEntityStencilTest(childId, refValue);
                applyStencilDescendants(childId as Entity, refValue);
            }
        }
    }

    function applyStencilDescendants(entity: Entity, refValue: number): void {
        const children = wasm.getChildEntities(cppRegistry, entity as number);
        for (const childId of children) {
            if (stencilMaskSet.has(childId)) {
                const childRef = nextRef++;
                applyStencilHierarchy(childId as Entity, childRef);
            } else {
                wasm.renderer_setEntityStencilTest(childId, refValue);
                applyStencilDescendants(childId as Entity, refValue);
            }
        }
    }

    for (const entity of rootMasks) {
        const refValue = nextRef++;
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

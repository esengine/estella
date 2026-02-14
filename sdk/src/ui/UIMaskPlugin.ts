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

        const maskEntities = world.getEntitiesWithComponents([UIMask]);
        if (maskEntities.length === 0) return;

        try {
            processMasks(wasm, world, cppRegistry, maskEntities, vp, vpX, vpY, vpW, vpH);
        } catch (_) {
            wasm.renderer_clearAllClipRects();
        }
    };
}

function processMasks(
    wasm: ESEngineModule, world: World, cppRegistry: CppRegistry,
    maskEntities: Entity[],
    vp: Float32Array, vpX: number, vpY: number, vpW: number, vpH: number
): void {
    const maskSet = new Set<number>();
    for (const e of maskEntities) {
        const mask = world.get(e, UIMask) as UIMaskData;
        if (mask.enabled) maskSet.add(e as number);
    }

    const rootMasks: Entity[] = [];
    for (const entity of maskEntities) {
        if (!maskSet.has(entity as number)) continue;
        let isRoot = true;
        let current = entity;
        while (world.has(current, Parent)) {
            const p = world.get(current, Parent) as ParentData;
            if (maskSet.has(p.entity as number)) {
                isRoot = false;
                break;
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
                const childRect = computeMaskScreenRect(
                    world, childId as Entity,
                    vp, vpX, vpY, vpW, vpH
                );
                if (childRect) {
                    childClip = intersectRects(clipRect, childRect);
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

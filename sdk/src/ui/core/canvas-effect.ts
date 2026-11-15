// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../../app/app';
import { defineComponent, type ComponentDef, Canvas } from '../../ecs/component';
import type { CanvasData } from '../../ecs/component';
import type { World } from '../../ecs/world';
import { defineSystem, GetWorld, Schedule } from '../../ecs/system';
import { Res } from '../../ecs/resource';
import { ScreenOverlay, type ScreenOverlayData } from './screen-overlay';

export interface CanvasEffectData {
    material: number;
}

export const CanvasEffect: ComponentDef<CanvasEffectData> = defineComponent<CanvasEffectData>('CanvasEffect', {
    material: 0,
}, {
    assetFields: [{ field: 'material', type: 'material' }],
    fields: {
        material: { tooltip: 'A material with a PostProcess shader. The screen UI on this Canvas\'s sorting layer is drawn into a picture of its own, and this material lays that picture (u_texture, colour weighted by its alpha) on the frame.' },
    },
});

export function publishCanvasEffects(world: World, overlay: ScreenOverlayData): void {
    const effects = overlay.effects;
    effects.length = 0;
    for (const entity of world.getEntitiesWithComponents([Canvas, CanvasEffect])) {
        const material = (world.get(entity, CanvasEffect) as CanvasEffectData).material;
        const layer = (world.get(entity, Canvas) as CanvasData).layer;
        if (!material || layer < 0 || layer > 31) continue;
        if (effects.some(effect => effect.layer === layer)) continue;
        effects.push({ layer, material });
    }
}

export class CanvasEffectPlugin implements Plugin {
    name = 'canvasEffect';
    build(app: App): void {
        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [GetWorld(), Res(ScreenOverlay)],
            (world: World, overlay: ScreenOverlayData) => publishCanvasEffects(world, overlay),
            { name: 'CanvasEffectSystem', touches: { reads: ['Canvas', 'CanvasEffect'] } },
        ));
    }
}

export const canvasEffectPlugin = new CanvasEffectPlugin();

import type { App, Plugin } from '../app';
import { registerComponent, Transform, Sprite } from '../component';
import type { TransformData, SpriteData } from '../component';
import { defineSystem, Schedule } from '../system';
import type { Entity } from '../types';
import type { World } from '../world';
import { UIRect } from './UIRect';
import type { UIRectData } from './UIRect';
import { ProgressBar } from './ProgressBar';
import type { ProgressBarData } from './ProgressBar';
import { applyDirectionalFill, getEffectiveWidth, getEffectiveHeight } from './uiHelpers';
import { computeUIRectLayout } from './uiLayout';

function syncFillLayout(
    world: World, fillEntity: Entity,
    parentW: number, parentH: number,
): void {
    if (!world.has(fillEntity, UIRect)) return;
    const fillRect = world.get(fillEntity, UIRect) as UIRectData;
    const halfW = parentW / 2;
    const halfH = parentH / 2;
    const parentRect = { left: -halfW, bottom: -halfH, right: halfW, top: halfH };
    const result = computeUIRectLayout(
        fillRect.anchorMin, fillRect.anchorMax,
        fillRect.offsetMin, fillRect.offsetMax,
        fillRect.size, parentRect, fillRect.pivot,
    );

    if (world.has(fillEntity, Sprite)) {
        const sprite = world.get(fillEntity, Sprite) as SpriteData;
        if (sprite.size.x !== result.width || sprite.size.y !== result.height) {
            sprite.size.x = result.width;
            sprite.size.y = result.height;
            world.insert(fillEntity, Sprite, sprite);
        }
    }

    if (world.has(fillEntity, Transform)) {
        const t = world.get(fillEntity, Transform) as TransformData;
        const curPos = t.position;
        if (curPos.x !== result.originX || curPos.y !== result.originY) {
            t.position = { x: result.originX, y: result.originY, z: curPos.z };
        }
    }
}

export class ProgressBarPlugin implements Plugin {
    build(app: App): void {
        registerComponent('ProgressBar', ProgressBar);

        const world = app.world;

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [],
            () => {
                const entities = world.getEntitiesWithComponents([ProgressBar, UIRect]);
                for (const entity of entities) {
                    const bar = world.get(entity, ProgressBar) as ProgressBarData;
                    if (!bar.fillEntity || !world.valid(bar.fillEntity)) continue;

                    const rect = world.get(entity, UIRect) as UIRectData;
                    const value = Math.max(0, Math.min(1, bar.value));
                    applyDirectionalFill(world, bar.fillEntity, bar.direction, value);
                    const sw = getEffectiveWidth(rect, entity);
                    const sh = getEffectiveHeight(rect, entity);
                    syncFillLayout(world, bar.fillEntity, sw, sh);
                }
            },
            { name: 'ProgressBarSystem' }
        ), { runAfter: ['UILayoutSystem'] });
    }
}

export const progressBarPlugin = new ProgressBarPlugin();

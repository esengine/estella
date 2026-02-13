import type { App, Plugin } from '../app';
import { LocalTransform, Children } from '../component';
import type { LocalTransformData, ChildrenData } from '../component';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { UIRect } from './UIRect';
import type { UIRectData } from './UIRect';
import { ScreenSpace } from './ScreenSpace';
import { UICameraInfo } from './UICameraInfo';
import type { UICameraData } from './UICameraInfo';
import type { Entity } from '../types';
import type { World } from '../world';
import { computeUIRectLayout, type LayoutRect } from './uiLayout';

function layoutEntity(
    world: World,
    entity: Entity,
    parentRect: LayoutRect,
    parentCenterX: number,
    parentCenterY: number,
    isRoot: boolean,
): void {
    if (!world.has(entity, UIRect)) return;

    const rect = world.get(entity, UIRect) as UIRectData;

    const result = computeUIRectLayout(
        rect.anchorMin, rect.anchorMax,
        rect.offsetMin, rect.offsetMax,
        rect.size, parentRect,
    );

    if (rect.anchorMin.x !== rect.anchorMax.x || rect.anchorMin.y !== rect.anchorMax.y) {
        rect.size.x = result.width;
        rect.size.y = result.height;
    }

    const transform = world.get(entity, LocalTransform) as LocalTransformData;
    if (isRoot) {
        transform.position.x = result.centerX;
        transform.position.y = result.centerY;
    } else {
        transform.position.x = result.centerX - parentCenterX;
        transform.position.y = result.centerY - parentCenterY;
    }
    world.insert(entity, LocalTransform, transform);

    if (!world.has(entity, Children)) return;

    const children = world.get(entity, Children) as ChildrenData;
    if (!children || !children.entities) return;

    for (const child of children.entities) {
        if (world.valid(child)) {
            layoutEntity(world, child, result.rect, result.centerX, result.centerY, false);
        }
    }
}

export class UILayoutPlugin implements Plugin {
    build(app: App): void {
        const world = app.world;

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(UICameraInfo)],
            (camera: UICameraData) => {
                if (!camera.valid) return;

                const cameraRect: LayoutRect = {
                    left: camera.worldLeft,
                    bottom: camera.worldBottom,
                    right: camera.worldRight,
                    top: camera.worldTop,
                };
                const cameraCenterX = (cameraRect.left + cameraRect.right) * 0.5;
                const cameraCenterY = (cameraRect.bottom + cameraRect.top) * 0.5;

                const roots = world.getEntitiesWithComponents([ScreenSpace, UIRect, LocalTransform]);
                for (const root of roots) {
                    layoutEntity(world, root, cameraRect, cameraCenterX, cameraCenterY, true);
                }
            },
            { name: 'UILayoutSystem' }
        ));
    }
}

export const uiLayoutPlugin = new UILayoutPlugin();

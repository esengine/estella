import type { App, Plugin } from '../app';
import { registerComponent, LocalTransform, Children, Parent } from '../component';
import type { LocalTransformData, ChildrenData, ParentData } from '../component';
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

interface RectSnapshot {
    anchorMinX: number;
    anchorMinY: number;
    anchorMaxX: number;
    anchorMaxY: number;
    offsetMinX: number;
    offsetMinY: number;
    offsetMaxX: number;
    offsetMaxY: number;
    sizeX: number;
    sizeY: number;
}

function takeRectSnapshot(rect: UIRectData): RectSnapshot {
    return {
        anchorMinX: rect.anchorMin.x,
        anchorMinY: rect.anchorMin.y,
        anchorMaxX: rect.anchorMax.x,
        anchorMaxY: rect.anchorMax.y,
        offsetMinX: rect.offsetMin.x,
        offsetMinY: rect.offsetMin.y,
        offsetMaxX: rect.offsetMax.x,
        offsetMaxY: rect.offsetMax.y,
        sizeX: rect.size.x,
        sizeY: rect.size.y,
    };
}

function rectChanged(snap: RectSnapshot, rect: UIRectData): boolean {
    return snap.anchorMinX !== rect.anchorMin.x
        || snap.anchorMinY !== rect.anchorMin.y
        || snap.anchorMaxX !== rect.anchorMax.x
        || snap.anchorMaxY !== rect.anchorMax.y
        || snap.offsetMinX !== rect.offsetMin.x
        || snap.offsetMinY !== rect.offsetMin.y
        || snap.offsetMaxX !== rect.offsetMax.x
        || snap.offsetMaxY !== rect.offsetMax.y
        || snap.sizeX !== rect.size.x
        || snap.sizeY !== rect.size.y;
}

function findRoot(world: World, entity: Entity): Entity | null {
    let current = entity;
    while (true) {
        if (world.has(current, ScreenSpace)) return current;
        if (!world.has(current, Parent)) return null;
        const parent = world.get(current, Parent) as ParentData;
        if (!world.valid(parent.entity)) return null;
        current = parent.entity;
    }
}

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
        registerComponent('UIRect', UIRect);

        const world = app.world;
        const snapshots = new Map<Entity, RectSnapshot>();
        let prevCameraLeft = NaN;
        let prevCameraBottom = NaN;
        let prevCameraRight = NaN;
        let prevCameraTop = NaN;

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

                const cameraChanged = prevCameraLeft !== camera.worldLeft
                    || prevCameraBottom !== camera.worldBottom
                    || prevCameraRight !== camera.worldRight
                    || prevCameraTop !== camera.worldTop;

                prevCameraLeft = camera.worldLeft;
                prevCameraBottom = camera.worldBottom;
                prevCameraRight = camera.worldRight;
                prevCameraTop = camera.worldTop;

                const dirtyRoots = new Set<Entity>();

                if (cameraChanged) {
                    const roots = world.getEntitiesWithComponents([ScreenSpace, UIRect, LocalTransform]);
                    for (const root of roots) {
                        dirtyRoots.add(root);
                    }
                }

                const allUIRectEntities = world.getEntitiesWithComponents([UIRect]);
                for (const entity of allUIRectEntities) {
                    const rect = world.get(entity, UIRect) as UIRectData;
                    const snap = snapshots.get(entity);

                    if (!snap || rectChanged(snap, rect)) {
                        const root = findRoot(world, entity);
                        if (root !== null) {
                            dirtyRoots.add(root);
                        }
                    }
                }

                for (const entity of snapshots.keys()) {
                    if (!world.valid(entity) || !world.has(entity, UIRect)) {
                        snapshots.delete(entity);
                        const root = findRoot(world, entity);
                        if (root !== null) {
                            dirtyRoots.add(root);
                        }
                    }
                }

                for (const root of dirtyRoots) {
                    layoutEntity(world, root, cameraRect, cameraCenterX, cameraCenterY, true);
                }

                for (const entity of allUIRectEntities) {
                    const rect = world.get(entity, UIRect) as UIRectData;
                    snapshots.set(entity, takeRectSnapshot(rect));
                }
            },
            { name: 'UILayoutSystem' }
        ));
    }
}

export const uiLayoutPlugin = new UILayoutPlugin();

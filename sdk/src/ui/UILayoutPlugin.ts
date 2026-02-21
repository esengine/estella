import type { App, Plugin } from '../app';
import { registerComponent, LocalTransform, Children, Parent, Sprite } from '../component';
import type { LocalTransformData, ChildrenData, ParentData, SpriteData } from '../component';
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
import { createSnapshotUtils, type Snapshot } from './uiSnapshot';

const rectSnapshot = createSnapshotUtils<UIRectData>({
    anchorMinX: r => r.anchorMin.x,
    anchorMinY: r => r.anchorMin.y,
    anchorMaxX: r => r.anchorMax.x,
    anchorMaxY: r => r.anchorMax.y,
    offsetMinX: r => r.offsetMin.x,
    offsetMinY: r => r.offsetMin.y,
    offsetMaxX: r => r.offsetMax.x,
    offsetMaxY: r => r.offsetMax.y,
    sizeX: r => r.size.x,
    sizeY: r => r.size.y,
});

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
    parentOriginX: number,
    parentOriginY: number,
    isRoot: boolean,
): void {
    if (!world.has(entity, UIRect)) return;

    const rect = world.get(entity, UIRect) as UIRectData;

    const result = computeUIRectLayout(
        rect.anchorMin, rect.anchorMax,
        rect.offsetMin, rect.offsetMax,
        rect.size, parentRect, rect.pivot,
    );

    const width = result.rect.right - result.rect.left;
    const height = result.rect.top - result.rect.bottom;
    rect._computedWidth = width;
    rect._computedHeight = height;

    if (world.has(entity, Sprite)) {
        const sprite = world.get(entity, Sprite) as SpriteData;
        if (sprite.size.x !== width || sprite.size.y !== height) {
            sprite.size.x = width;
            sprite.size.y = height;
            world.insert(entity, Sprite, sprite);
        }
    }

    if (!rect._layoutManaged) {
        const transform = world.get(entity, LocalTransform) as LocalTransformData;
        if (isRoot) {
            transform.position.x = result.originX;
            transform.position.y = result.originY;
        } else {
            transform.position.x = result.originX - parentOriginX;
            transform.position.y = result.originY - parentOriginY;
        }
        world.insert(entity, LocalTransform, transform);
    }

    if (!world.has(entity, Children)) return;

    const children = world.get(entity, Children) as ChildrenData;
    if (!children || !children.entities) return;

    for (const child of children.entities) {
        if (world.valid(child)) {
            layoutEntity(world, child, result.rect, result.originX, result.originY, false);
        }
    }
}

export class UILayoutPlugin implements Plugin {
    build(app: App): void {
        registerComponent('UIRect', UIRect);

        const world = app.world;
        const snapshots = new Map<Entity, Snapshot>();
        const rootCache = new Map<Entity, Entity | null>();
        let prevCameraLeft = NaN;
        let prevCameraBottom = NaN;
        let prevCameraRight = NaN;
        let prevCameraTop = NaN;

        function getCachedRoot(entity: Entity): Entity | null {
            let root = rootCache.get(entity);
            if (root !== undefined) return root;
            root = findRoot(world, entity);
            rootCache.set(entity, root);
            return root;
        }

        function clearSubtreeCache(entity: Entity): void {
            rootCache.delete(entity);
            if (!world.has(entity, Children)) return;
            const ch = world.get(entity, Children) as ChildrenData;
            if (!ch || !ch.entities) return;
            for (const child of ch.entities) {
                if (world.valid(child)) {
                    clearSubtreeCache(child);
                }
            }
        }

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
                const cameraOriginX = (cameraRect.left + cameraRect.right) * 0.5;
                const cameraOriginY = (cameraRect.bottom + cameraRect.top) * 0.5;

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
                    rootCache.clear();
                    const roots = world.getEntitiesWithComponents([ScreenSpace, UIRect, LocalTransform]);
                    for (const root of roots) {
                        dirtyRoots.add(root);
                    }
                }

                for (const entity of snapshots.keys()) {
                    if (!world.valid(entity) || !world.has(entity, UIRect)) {
                        snapshots.delete(entity);
                        rootCache.delete(entity);
                    }
                }

                const allUIRectEntities = world.getEntitiesWithComponents([UIRect]);
                for (const entity of allUIRectEntities) {
                    const rect = world.get(entity, UIRect) as UIRectData;
                    const snap = snapshots.get(entity);

                    if (rect._dirty || !snap || rectSnapshot.changed(snap, rect)) {
                        rect._dirty = false;
                        clearSubtreeCache(entity);
                        const root = getCachedRoot(entity);
                        if (root !== null) {
                            dirtyRoots.add(root);
                        }
                    }
                }

                for (const root of dirtyRoots) {
                    layoutEntity(world, root, cameraRect, cameraOriginX, cameraOriginY, true);
                }

                for (const entity of allUIRectEntities) {
                    const rect = world.get(entity, UIRect) as UIRectData;
                    const existing = snapshots.get(entity);
                    if (existing) {
                        rectSnapshot.update(existing, rect);
                    } else {
                        snapshots.set(entity, rectSnapshot.take(rect));
                    }
                }
            },
            { name: 'UILayoutSystem' }
        ));
    }
}

export const uiLayoutPlugin = new UILayoutPlugin();

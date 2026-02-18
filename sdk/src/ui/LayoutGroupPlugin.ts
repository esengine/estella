

import type { App, Plugin } from '../app';
import { registerComponent, Children, LocalTransform } from '../component';
import type { ChildrenData, LocalTransformData } from '../component';
import { defineSystem, Schedule } from '../system';
import { LayoutGroup, LayoutDirection, ChildAlignment } from './LayoutGroup';
import type { LayoutGroupData } from './LayoutGroup';
import { UIRect } from './UIRect';
import type { UIRectData } from './UIRect';
import type { Entity } from '../types';

export class LayoutGroupPlugin implements Plugin {
    build(app: App): void {
        registerComponent('LayoutGroup', LayoutGroup);

        const world = app.world;

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [],
            () => {
                const entities = world.getEntitiesWithComponents([LayoutGroup, UIRect, Children]);

                for (const entity of entities) {
                    const group = world.get(entity, LayoutGroup) as LayoutGroupData;
                    const parentRect = world.get(entity, UIRect) as UIRectData;
                    const children = world.get(entity, Children) as ChildrenData;
                    if (!children.entities || children.entities.length === 0) continue;

                    const validChildren: { entity: Entity; rect: UIRectData }[] = [];
                    for (const child of children.entities) {
                        if (world.valid(child) && world.has(child, UIRect) && world.has(child, LocalTransform)) {
                            validChildren.push({
                                entity: child,
                                rect: world.get(child, UIRect) as UIRectData,
                            });
                        }
                    }
                    if (validChildren.length === 0) continue;

                    if (group.reverseOrder) {
                        validChildren.reverse();
                    }

                    const pw = parentRect.size.x;
                    const ph = parentRect.size.y;
                    const pad = group.padding;
                    const contentW = pw - pad.left - pad.right;
                    const contentH = ph - pad.top - pad.bottom;

                    const isHorizontal = group.direction === LayoutDirection.Horizontal;
                    let cursor = 0;

                    for (const child of validChildren) {
                        const cw = child.rect.size.x;
                        const ch = child.rect.size.y;

                        let localX: number;
                        let localY: number;

                        if (isHorizontal) {
                            localX = -pw * 0.5 + pad.left + cursor + cw * 0.5;
                            if (group.childAlignment === ChildAlignment.Start) {
                                localY = ph * 0.5 - pad.top - ch * 0.5;
                            } else if (group.childAlignment === ChildAlignment.End) {
                                localY = -ph * 0.5 + pad.bottom + ch * 0.5;
                            } else {
                                localY = (pad.bottom - pad.top) * 0.5;
                            }
                            cursor += cw + group.spacing;
                        } else {
                            if (group.childAlignment === ChildAlignment.Start) {
                                localX = -pw * 0.5 + pad.left + cw * 0.5;
                            } else if (group.childAlignment === ChildAlignment.End) {
                                localX = pw * 0.5 - pad.right - cw * 0.5;
                            } else {
                                localX = (pad.left - pad.right) * 0.5;
                            }
                            localY = ph * 0.5 - pad.top - cursor - ch * 0.5;
                            cursor += ch + group.spacing;
                        }

                        child.rect.anchorMin.x = 0.5;
                        child.rect.anchorMin.y = 0.5;
                        child.rect.anchorMax.x = 0.5;
                        child.rect.anchorMax.y = 0.5;
                        child.rect.offsetMin.x = localX;
                        child.rect.offsetMin.y = localY;

                        const transform = world.get(child.entity, LocalTransform) as LocalTransformData;
                        transform.position.x = localX;
                        transform.position.y = localY;
                        world.insert(child.entity, LocalTransform, transform);
                    }
                }
            },
            { name: 'LayoutGroupSystem' }
        ), { runAfter: ['UILayoutSystem'] });
    }
}

export const layoutGroupPlugin = new LayoutGroupPlugin();

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

                    const pw = parentRect._computedWidth ?? parentRect.size.x;
                    const ph = parentRect._computedHeight ?? parentRect.size.y;
                    const pivotX = parentRect.pivot.x;
                    const pivotY = parentRect.pivot.y;
                    const pad = group.padding;

                    const isHorizontal = group.direction === LayoutDirection.Horizontal;
                    let cursor = 0;

                    for (let i = 0; i < validChildren.length; i++) {
                        const child = validChildren[i];
                        const cw = child.rect._computedWidth ?? child.rect.size.x;
                        const ch = child.rect._computedHeight ?? child.rect.size.y;
                        const cpx = child.rect.pivot.x;
                        const cpy = child.rect.pivot.y;

                        let localX: number;
                        let localY: number;

                        if (isHorizontal) {
                            localX = -pivotX * pw + pad.left + cursor + cpx * cw;
                            if (group.childAlignment === ChildAlignment.Start) {
                                localY = (1 - pivotY) * ph - pad.top - (1 - cpy) * ch;
                            } else if (group.childAlignment === ChildAlignment.End) {
                                localY = -pivotY * ph + pad.bottom + cpy * ch;
                            } else {
                                localY = (0.5 - pivotY) * ph + (pad.bottom - pad.top) * 0.5 + (cpy - 0.5) * ch;
                            }
                            cursor += cw;
                            if (i < validChildren.length - 1) cursor += group.spacing;
                        } else {
                            if (group.childAlignment === ChildAlignment.Start) {
                                localX = -pivotX * pw + pad.left + cpx * cw;
                            } else if (group.childAlignment === ChildAlignment.End) {
                                localX = (1 - pivotX) * pw - pad.right - (1 - cpx) * cw;
                            } else {
                                localX = (0.5 - pivotX) * pw + (pad.left - pad.right) * 0.5 + (cpx - 0.5) * cw;
                            }
                            localY = (1 - pivotY) * ph - pad.top - cursor - (1 - cpy) * ch;
                            cursor += ch;
                            if (i < validChildren.length - 1) cursor += group.spacing;
                        }

                        child.rect._layoutManaged = true;

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

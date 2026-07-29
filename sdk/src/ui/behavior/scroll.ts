// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    scroll.ts
 * @brief   Adopt scene-authored UIScroll nodes into live ScrollContainers.
 *
 * The ScrollView widget builds its parts and its behaviour together, in code.
 * A scene can only describe the parts — a clipped box with an oversized child —
 * so until now the behaviour had no way in, and a ScrollView placed in the
 * editor scrolled only if game code went looking for it. This system is the way
 * in: every entity carrying UIScroll gets a ScrollContainer wired to the same
 * input path the widget uses, and loses it when the component goes away.
 */
import { Schedule, defineSystem } from '../../ecs/system';
import { Query } from '../../ecs/query';
import type { Entity } from '../../types';
import type { World } from '../../ecs/world';
import type { CppRegistry } from '../../wasm';
import type { EngineApi } from '../../ecs/bridge/engineApi';
import { UINode, UIPositionType, type UINodeData } from '../core/ui-node';
import { UIScroll, ScrollMovement, type UIScrollData } from '../core/ui-scroll';
import { ScrollContainer } from '../collection/scroll-container';
import type { Vec2 } from '../../types';

/** What the plugin hands this system: the same registry the widget attaches to. */
export interface ScrollHost {
    attachScrollContainer(entity: Entity, container: ScrollContainer): void;
    detachScrollContainer(entity: Entity): void;
}

interface Attached {
    container: ScrollContainer;
    content: Entity;
    unsubscribe: () => void;
}

const px = (v: number) => ({ value: v, unit: 0 } as const);

function directionOf(scroll: UIScrollData): 'both' | 'vertical' | 'horizontal' {
    if (scroll.horizontal && scroll.vertical) return 'both';
    return scroll.horizontal ? 'horizontal' : 'vertical';
}

export function createScrollAdoptSystem(
    world: World,
    engine: EngineApi | null,
    registry: CppRegistry,
    host: ScrollHost,
) {
    const attached = new Map<Entity, Attached>();

    /** The resolved box the layout pass produced, not the authored dimension. */
    const size = (entity: Entity): Vec2 => ({
        x: engine?.uiNode_computedWidth?.(registry, entity) ?? 0,
        y: engine?.uiNode_computedHeight?.(registry, entity) ?? 0,
    });

    /**
     * The child that moves: the one named, else the first.
     *
     * The children list is a wasm vector, so it is read through its accessors
     * and then freed — one left alive leaks module memory, and this would be
     * asking every frame.
     */
    const contentOf = (entity: Entity, scroll: UIScrollData): Entity | null => {
        if (scroll.content) return scroll.content as Entity;
        if (!registry?.hasChildren?.(entity)) return null;
        const vec = registry.getChildren(entity).entities;
        try {
            return vec.size() > 0 ? (vec.get(0) as Entity) : null;
        } finally {
            vec.delete();
        }
    };

    const detach = (entity: Entity): void => {
        const a = attached.get(entity);
        if (!a) return;
        a.unsubscribe();
        host.detachScrollContainer(entity);
        attached.delete(entity);
    };

    const attach = (entity: Entity, scroll: UIScrollData): void => {
        const content = contentOf(entity, scroll);
        if (content == null) return; // nothing to move yet — try again next tick

        const container = new ScrollContainer({
            viewportSize: size(entity),
            contentSize: size(content),
            direction: directionOf(scroll),
            wheelSpeed: scroll.wheelSpeed,
            dragScroll: scroll.dragScroll,
            decelerationRate: scroll.movement === ScrollMovement.Elastic ? scroll.decelerationRate : 0,
        });
        // The offset moves the content by its insets, exactly as the widget does,
        // so both paths leave the same thing in the scene.
        const unsubscribe = container.onScroll((offset) => {
            const node = world.get(content, UINode) as UINodeData | undefined;
            if (!node) return;
            node.position = UIPositionType.Absolute;
            node.insetLeft = px(-offset.x);
            node.insetTop = px(-offset.y);
            world.insert(content, UINode, node);
        });
        host.attachScrollContainer(entity, container);
        attached.set(entity, { container, content, unsubscribe });
    };

    return defineSystem([Query(UIScroll)], (query) => {
        const live = new Set<Entity>();

        for (const [entity, scroll] of query) {
            const data = scroll as UIScrollData;
            if (!data.enabled) continue;
            live.add(entity);

            const a = attached.get(entity);
            if (!a) {
                attach(entity, data);
                continue;
            }
            // A content swap is a different container, not a resize. Only an
            // explicit ref is re-read each frame; the implicit "first child" is
            // trusted while it lives, so the steady state costs no wasm calls.
            const swapped = data.content
                ? (data.content as Entity) !== a.content
                : !world.valid(a.content);
            if (swapped) {
                detach(entity);
                attach(entity, data);
                continue;
            }
            const content = a.content;
            // Layout is free to change under us (a window resize, a list that
            // grew), and both setters early-out when nothing moved.
            a.container.setViewportSize(size(entity));
            a.container.setContentSize(size(content));
        }

        for (const entity of [...attached.keys()]) {
            if (!live.has(entity)) detach(entity);
        }
    }, { name: 'UIScrollAdoptSystem' });
}

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
import { UINode, UIPositionType } from '../core/ui-node';
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
    contentRef: number;
    settings: UIScrollData;
    unsubscribe: () => void;
}

const px = (v: number) => ({ value: v, unit: 0 } as const);

function directionOf(scroll: UIScrollData): 'both' | 'vertical' | 'horizontal' {
    if (scroll.horizontal && scroll.vertical) return 'both';
    return scroll.horizontal ? 'horizontal' : 'vertical';
}

function sameSettings(a: UIScrollData, b: UIScrollData): boolean {
    return a.horizontal === b.horizontal && a.vertical === b.vertical
        && a.wheelSpeed === b.wheelSpeed && a.dragScroll === b.dragScroll
        && a.movement === b.movement && a.decelerationRate === b.decelerationRate;
}

export function createScrollAdoptSystem(
    world: World,
    engine: EngineApi | null,
    registry: CppRegistry,
    host: ScrollHost,
) {
    const attached = new Map<Entity, Attached>();
    let lastWorldVersion = -1;

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

    const attach = (entity: Entity, scroll: UIScrollData, content = contentOf(entity, scroll), initialOffset?: Vec2): void => {
        if (content == null || !world.valid(content) || !world.has(content, UINode)) return;
        const node = world.get(content, UINode);
        const offset = initialOffset ?? {
            x: node.insetLeft.unit === 0 ? Math.max(0, -node.insetLeft.value) : 0,
            y: node.insetTop.unit === 0 ? Math.max(0, -node.insetTop.value) : 0,
        };
        const container = new ScrollContainer({
            viewportSize: size(entity),
            contentSize: size(content),
            direction: directionOf(scroll),
            wheelSpeed: scroll.wheelSpeed,
            dragScroll: scroll.dragScroll,
            decelerationRate: scroll.movement === ScrollMovement.Elastic ? scroll.decelerationRate : 0,
            elastic: scroll.movement === ScrollMovement.Elastic,
            initialOffset: offset,
        });
        // The offset moves the content by its insets, exactly as the widget does,
        // so both paths leave the same thing in the scene.
        // …and shows it pulled past an end by the overscroll, when the area is elastic.
        const applyOffset = (offset: Vec2): void => {
            const node = world.tryGet(content, UINode);
            if (!node) return;
            const over = container.getOverscroll();
            node.position = UIPositionType.Absolute;
            node.insetLeft = px(-(offset.x + over.x));
            node.insetTop = px(-(offset.y + over.y));
            world.insert(content, UINode, node);
        };
        const unsubscribeScroll = container.onScroll(applyOffset);
        const unsubscribeOver = container.onOverscroll((_over, offset) => applyOffset(offset));
        const unsubscribe = (): void => { unsubscribeScroll(); unsubscribeOver(); };
        const clamped = container.getOffset();
        if (clamped.x !== offset.x || clamped.y !== offset.y) applyOffset(clamped);
        host.attachScrollContainer(entity, container);
        attached.set(entity, { container, content, contentRef: scroll.content, settings: { ...scroll }, unsubscribe });
    };

    return defineSystem([Query(UIScroll)], (query) => {
        const version = world.getWorldVersion();
        const topologyChanged = version !== lastWorldVersion;
        lastWorldVersion = version;
        const live = new Set<Entity>();

        for (const [entity, scroll] of query) {
            const data = scroll as UIScrollData;
            if (!data.enabled || (!data.horizontal && !data.vertical)) continue;
            live.add(entity);
            // Hidden layout boxes collapse to zero; they are not a content resize.
            if (engine?.getUINodeHiddenInTree?.(registry, entity)) continue;

            const a = attached.get(entity);
            if (!a) {
                attach(entity, data);
                continue;
            }
            const usable = world.valid(a.content) && world.has(a.content, UINode);
            // Re-read implicit children only after structural edits or reference changes.
            const resolved = data.content !== 0 ? data.content as Entity
                : (topologyChanged || a.contentRef !== 0 || !usable) ? contentOf(entity, data) : a.content;
            const swapped = !usable || resolved !== a.content;
            if (swapped) {
                detach(entity);
                attach(entity, data, resolved);
                continue;
            }
            if (!sameSettings(a.settings, data)) {
                const offset = a.container.getOffset();
                detach(entity);
                attach(entity, data, resolved, offset);
                continue;
            }
            a.contentRef = data.content;
            const content = a.content;
            // Clamp against one complete layout, never mixed old/new extents.
            a.container.setSizes(size(entity), size(content));
        }

        for (const entity of [...attached.keys()]) {
            if (!live.has(entity)) detach(entity);
        }
    }, { name: 'UIScrollAdoptSystem' });
}

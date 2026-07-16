// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    scroll-view.ts
 * @brief   createScrollView — a clipped, scrollable panel for arbitrary content.
 *
 * The non-virtualized sibling of createListView: a Scissor-masked viewport
 * whose content frame is translated by a ScrollContainer (wheel + drag/touch
 * with kinetic fling, driven by the behavior plugin). Parent anything under
 * `content`; sizes are explicit because scroll math needs them up front.
 */
import type { Entity, Vec2 } from '../../types';
import type { World } from '../../world';

import { UINode, UIPositionType, type UINodeData } from '../core/ui-node';
import { px } from '../core/dimension';
import { UIMask, MaskMode } from '../core/ui-mask';
import { ScrollContainer } from '../collection/scroll-container';

import { spawnUIEntity, makeWidgetInteractable, type UINodeInit, type UIVisualInit } from './helpers';
import type { ListViewHost } from './list-view';

export interface ScrollViewOptions {
    world: World;
    /** The plugin that routes scroll input (`uiPlugin`). */
    host: ListViewHost;
    parent?: Entity;
    /** Pixel size of the visible window. */
    viewportSize: Vec2;
    /** Pixel size of the scrollable content frame. */
    contentSize: Vec2;
    /** Extra viewport UINode props (its size defaults to `viewportSize`). */
    node?: UINodeInit;
    /** Viewport background. Default: a transparent hit-target (so the wheel works). */
    background?: UIVisualInit;
    /** Scroll axis. Default 'vertical'. */
    direction?: 'vertical' | 'horizontal' | 'both';
    /** Wheel delta multiplier. Default 1. */
    wheelSpeed?: number;
    /** Drag/touch scrolling with a kinetic fling. Default true. */
    dragScroll?: boolean;
    /** Fling velocity fraction left after 1s of coasting. Default 0.135. */
    decelerationRate?: number;
    onScroll?: (offset: Vec2) => void;
}

export interface ScrollViewHandle {
    /** The viewport entity (the clipped window; add it to your UI tree). */
    readonly entity: Entity;
    /** The scrolling content frame — parent your content here. */
    readonly content: Entity;
    /** The scroll model (escape hatch: `scrollBy`, `onScroll`, …). */
    readonly scroll: ScrollContainer;
    scrollTo(offset: Vec2): void;
    /** Update the scroll range after content changes size. */
    setContentSize(size: Vec2): void;
    dispose(): void;
}

export function createScrollView(opts: ScrollViewOptions): ScrollViewHandle {
    const { world, host, viewportSize, contentSize } = opts;

    const viewport = spawnUIEntity({
        world,
        parent: opts.parent,
        node: { width: px(viewportSize.x), height: px(viewportSize.y), ...opts.node },
        visual: opts.background ?? { color: { r: 0, g: 0, b: 0, a: 0 } },
    });
    world.insert(viewport, UIMask, { enabled: true, mode: MaskMode.Scissor });
    makeWidgetInteractable(world, viewport, { focusable: false });

    const content = spawnUIEntity({
        world,
        parent: viewport,
        node: {
            position: UIPositionType.Absolute,
            insetLeft: px(0),
            insetTop: px(0),
            width: px(contentSize.x),
            height: px(contentSize.y),
        },
    });

    const scroll = new ScrollContainer({
        viewportSize,
        contentSize,
        direction: opts.direction ?? 'vertical',
        wheelSpeed: opts.wheelSpeed,
        dragScroll: opts.dragScroll,
        decelerationRate: opts.decelerationRate,
    });
    const offScroll = scroll.onScroll((offset) => {
        const n = world.get(content, UINode) as UINodeData;
        n.insetLeft = px(-offset.x);
        n.insetTop = px(-offset.y);
        world.insert(content, UINode, n);
        opts.onScroll?.(offset);
    });
    host.attachScrollContainer(viewport, scroll);

    let disposed = false;
    return {
        entity: viewport,
        content,
        scroll,
        scrollTo: (offset) => scroll.setOffset(offset),
        setContentSize: (size) => {
            const n = world.get(content, UINode) as UINodeData;
            n.width = px(size.x);
            n.height = px(size.y);
            world.insert(content, UINode, n);
            scroll.setContentSize(size);
        },
        dispose: () => {
            if (disposed) return;
            disposed = true;
            offScroll();
            host.detachScrollContainer(viewport);
            scroll.dispose();
            if (world.valid(viewport)) world.despawn(viewport);
        },
    };
}

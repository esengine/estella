// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    list-view.ts
 * @brief   createListView — the ergonomic widget factory over the collection core.
 *
 * A one-call, data-driven, virtualized list/grid that composes the existing
 * primitives (DataSource + LayoutProvider + ViewPool + ListView + ScrollContainer
 * + UIMask) — matching the createButton/createDialog factory-and-handle shape.
 *
 * Layout integration (REARCH_UI_LIST §3): items are positioned by UINode
 * Absolute inset (not Transform, which the UI layout owns); the content frame is
 * translated by the scroll offset; a Scissor UIMask on the viewport clips. Mouse
 * wheel is handled by the behavior plugin's ScrollWheelSystem once the viewport is
 * a hovered raycast target — drag/touch scrolling is not wired here (v1).
 */
import { Transform } from '../../component';
import type { Entity, Vec2 } from '../../types';
import type { World } from '../../world';

import { UINode, UIPositionType, type UINodeData } from '../core/ui-node';
import { px, auto } from '../core/dimension';
import { UIMask, MaskMode } from '../core/ui-mask';
import { Interactable, UIInteraction } from '../input/interactable';
import { uiPlugin } from '../ui-plugin';

import { spawnUIEntity, setUIVisible, type UINodeInit, type UIVisualInit } from './helpers';

import {
    type DataSource,
    ArrayDataSource,
} from '../collection/data-source';
import {
    type LayoutProvider,
    type Rect,
    LinearLayoutProvider,
    GridLayoutProvider,
} from '../collection/layout-provider';
import { ListView } from '../collection/list-view';
import { ScrollContainer } from '../collection/scroll-container';

/** A single item type: how to build the entity and how to bind data to it. */
export interface ListItemTemplate<T> {
    /** Create one item entity (use `spawnUIEntity` so it carries a UINode). */
    create: (world: World, parent: Entity) => Entity;
    /** Apply data to an item; called on every (re)bind, so keep it idempotent. */
    bind: (entity: Entity, data: T, index: number) => void;
}

/** Layout sugar. A column list, a row list, or a grid (`columns`). */
export type ListLayoutSpec =
    | { itemHeight: number; spacing?: number; direction?: 'column' }
    | { itemWidth: number; spacing?: number; direction: 'row' }
    | { columns: number; itemSize: Vec2; spacing?: Vec2 };

export interface CreateListViewOptions<T> {
    world: World;
    parent?: Entity;
    /** Pixel size of the visible window. Required — scroll math needs it up front. */
    viewportSize: Vec2;
    /** Extra viewport UINode props (its size defaults to `viewportSize`). */
    node?: UINodeInit;
    /** Viewport background. Default: a transparent hit-target (so the wheel works). */
    background?: UIVisualInit;
    /** Backing data — a `DataSource<T>` or a raw array (wrapped in an ArrayDataSource). */
    data: DataSource<T> | readonly T[];
    /** Layout sugar (`itemHeight` / `columns` …) or a full `LayoutProvider`. */
    layout: ListLayoutSpec | LayoutProvider;
    /** One template, or a map of item type → template for heterogeneous rows. */
    item: ListItemTemplate<T> | Record<string, ListItemTemplate<T>>;
    /** Scroll axis. Defaults from the layout (column→vertical, row→horizontal). */
    direction?: 'vertical' | 'horizontal' | 'both';
    /** Extra indices kept mounted on each side of the visible range. Default 2. */
    recycleBuffer?: number;
    /** Wheel delta multiplier. Default 1. */
    wheelSpeed?: number;
    /** Called after each item bind. */
    onItemBound?: (entity: Entity, data: T, index: number) => void;
}

export interface ListViewHandle<T> {
    /** The viewport entity (the clipped window; add it to your UI tree). */
    readonly entity: Entity;
    /** The scrolling content frame that items are parented to. */
    readonly content: Entity;
    /** The data source — mutate an `ArrayDataSource` here to update the list. */
    readonly data: DataSource<T>;
    /** The scroll model (escape hatch: `scroll.scrollBy`, `onScroll`, …). */
    readonly scroll: ScrollContainer;
    /** The virtualization driver (escape hatch). */
    readonly view: ListView<T>;
    /** Force a re-sync of mounted items on the next frame. */
    refresh(): void;
    /** Scroll so item `index` is at the top-left of the viewport. */
    scrollToIndex(index: number): void;
    /** Number of item entities currently mounted (for virtualization checks). */
    mountedCount(): number;
    /** Tear down: unregister, release items, drop scroll/data subscriptions. */
    dispose(): void;
}

function isDataSource<T>(d: DataSource<T> | readonly T[]): d is DataSource<T> {
    return !Array.isArray(d) && typeof (d as DataSource<T>).getCount === 'function';
}

function isLayoutProvider(l: ListLayoutSpec | LayoutProvider): l is LayoutProvider {
    return typeof (l as LayoutProvider).getItemRect === 'function';
}

function buildLayout(spec: ListLayoutSpec, viewport: Vec2): { layout: LayoutProvider; axis: 'vertical' | 'horizontal' } {
    if ('columns' in spec) {
        return {
            layout: new GridLayoutProvider({ columns: spec.columns, itemSize: spec.itemSize, spacing: spec.spacing }),
            axis: 'vertical',
        };
    }
    if ('itemWidth' in spec) {
        return {
            layout: new LinearLayoutProvider({ direction: 'row', itemSize: { x: spec.itemWidth, y: viewport.y }, spacing: spec.spacing }),
            axis: 'horizontal',
        };
    }
    return {
        layout: new LinearLayoutProvider({ direction: 'column', itemSize: { x: viewport.x, y: spec.itemHeight }, spacing: spec.spacing }),
        axis: 'vertical',
    };
}

/** Position an item within the content by its computed rect (Absolute inset). */
function placeByInset(world: World, entity: Entity, rect: Rect): void {
    if (!world.has(entity, UINode)) return;
    const n = world.get(entity, UINode) as UINodeData;
    n.position = UIPositionType.Absolute;
    n.insetLeft = px(rect.x);
    n.insetTop = px(rect.y);
    n.insetRight = auto();
    n.insetBottom = auto();
    n.width = px(rect.width);
    n.height = px(rect.height);
    world.insert(entity, UINode, n);
}

/**
 * Build a virtualized list (or grid) in one call. See REARCH_UI_LIST.md.
 *
 * @example
 * const list = createListView<Player>({
 *   world, parent, viewportSize: { x: 320, y: 480 },
 *   data: arrayDataSource(players),
 *   layout: { itemHeight: 56 },
 *   item: {
 *     create: (w, parent) => spawnUIEntity({ world: w, parent, node: { height: px(56) } }),
 *     bind: (e, p) => setText(e, p.name),
 *   },
 * });
 * list.data.append([newPlayer]);   // auto-refreshes
 */
export function createListView<T>(opts: CreateListViewOptions<T>): ListViewHandle<T> {
    const { world, viewportSize } = opts;

    // 1) Viewport: sized box + Scissor mask + a hovered hit-target (for the wheel).
    const viewport = spawnUIEntity({
        world,
        parent: opts.parent,
        node: { width: px(viewportSize.x), height: px(viewportSize.y), ...opts.node },
        visual: opts.background ?? { color: { r: 0, g: 0, b: 0, a: 0 } },
    });
    world.insert(viewport, UIMask, { enabled: true, mode: MaskMode.Scissor, maskTexture: 0, inverted: false });
    world.insert(viewport, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });
    world.insert(viewport, UIInteraction, { hovered: false, pressed: false, justPressed: false, justReleased: false });

    // 2) Content: an Absolute frame translated by the scroll offset; items live here.
    const content = spawnUIEntity({
        world,
        parent: viewport,
        node: { position: UIPositionType.Absolute, insetLeft: px(0), insetTop: px(0), width: px(viewportSize.x), height: px(viewportSize.y) },
    });

    // 3) Resolve data + layout.
    const data: DataSource<T> = isDataSource(opts.data) ? opts.data : new ArrayDataSource<T>(opts.data);
    const { layout, axis } = isLayoutProvider(opts.layout)
        ? { layout: opts.layout, axis: 'vertical' as const }
        : buildLayout(opts.layout, viewportSize);

    // 4) Item templates → ViewPool template shape ({ factory, binder }).
    const single = 'create' in opts.item && 'bind' in opts.item;
    const templateMap = (single ? { default: opts.item as ListItemTemplate<T> } : opts.item as Record<string, ListItemTemplate<T>>);
    const templates: Record<string, { factory: (w: World, p: Entity) => Entity; binder: (e: Entity, d: T, i: number) => void }> = {};
    for (const [type, tpl] of Object.entries(templateMap)) {
        templates[type] = { factory: tpl.create, binder: tpl.bind };
    }

    // 5) The virtualization driver, parented to the content frame.
    const view = new ListView<T>({
        world,
        parent: content,
        dataSource: data,
        layout,
        viewportSize,
        templates,
        recycleBuffer: opts.recycleBuffer,
        placeItem: (w, e, rect) => placeByInset(w, e, rect),
        setVisible: (w, e, v) => setUIVisible(w, e, v),
        onItemBound: opts.onItemBound,
    });
    uiPlugin.registerListView(view as ListView<unknown>);

    // 6) Scroll model: wheel-driven by the plugin; onScroll translates the content
    //    frame and pushes the offset into the driver.
    const scroll = new ScrollContainer({
        viewportSize,
        contentSize: layout.getContentSize(data.getCount()),
        direction: opts.direction ?? axis,
        wheelSpeed: opts.wheelSpeed,
    });
    const offScroll = scroll.onScroll((offset) => {
        const n = world.get(content, UINode) as UINodeData;
        n.insetLeft = px(-offset.x);
        n.insetTop = px(-offset.y);
        world.insert(content, UINode, n);
        view.setScrollOffset(offset);
    });
    uiPlugin.attachScrollContainer(viewport, scroll);

    // 7) Keep the scroll range in step with the data count.
    const offData = data.subscribe?.(() => {
        scroll.setContentSize(layout.getContentSize(data.getCount()));
    });

    let disposed = false;
    return {
        entity: viewport,
        content,
        data,
        scroll,
        view,
        refresh: () => view.refresh(),
        scrollToIndex: (index) => {
            const rect = layout.getItemRect(index);
            scroll.setOffset({ x: rect.x, y: rect.y });
        },
        mountedCount: () => view.getMountedCount(),
        dispose: () => {
            if (disposed) return;
            disposed = true;
            offScroll();
            offData?.();
            uiPlugin.unregisterListView(view as ListView<unknown>);
            uiPlugin.detachScrollContainer(viewport);
            scroll.dispose();
            view.dispose();
            if (world.valid(viewport)) world.despawn(viewport);
        },
    };
}

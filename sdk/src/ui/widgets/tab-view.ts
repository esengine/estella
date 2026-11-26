// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { spawnUIEntity, type UINodeInit } from '../core/compose';
import { px, percent } from '../core/dimension';
import { UITabView, type UITabViewData } from '../behavior/tab-view';
import { UIToggleGroup } from '../behavior/toggle';
import { createToggle } from './toggle';
import { themeColors } from '../theme/tokens';
import { markThemed } from '../theme/theme-style';
import { UIEventType, type UIEventQueue } from '../core/events';
import { UINode, UIDisplay } from '../core/ui-node';
import { Name } from '../../ecs/component';

/** Creation options for a composed tab view. @beta */
export interface TabViewOptions {
    world: World;
    events: UIEventQueue;
    parent?: Entity;
    node?: UINodeInit;
    labels: readonly string[];
    selectedIndex?: number;
    tabHeight?: number;
    onChange?: (index: number, page: Entity) => void;
}
/** A composed view and its editable children. @beta */
export interface TabViewHandle {
    readonly entity: Entity;
    readonly tabs: readonly Entity[];
    readonly pages: readonly Entity[];
    select(index: number): void;
    dispose(): void;
}

/** Ordinary editable Toggles and content entities, captured by the widget prefab generator. @beta */
export function createTabView(opts: TabViewOptions): TabViewHandle {
    const { world, events } = opts;
    const entity = spawnUIEntity({ world, parent: opts.parent,
        node: opts.node ?? { width: px(420), height: px(240) }, visual: { color: themeColors(world).surface } });
    markThemed(world, entity, { visual: 'surface' });
    world.insert(entity, UIToggleGroup, { allowSwitchOff: false });
    const tabs: Entity[] = [], pages: Entity[] = [], handles: Array<{ dispose(): void }> = [];
    const height = opts.tabHeight ?? 36;
    const selected = Math.max(0, Math.min(opts.selectedIndex ?? 0, opts.labels.length - 1));
    opts.labels.forEach((label, i) => {
        const toggle = createToggle({ world, events, parent: entity, isOn: i === selected,
            node: { position: 1, width: percent(100 / opts.labels.length), height: px(height), insetLeft: percent(i * 100 / opts.labels.length), insetTop: px(0) },
            check: { node: { position: 1, height: px(2), insetLeft: px(0), insetRight: px(0), insetBottom: px(0) } } });
        handles.push(toggle); tabs.push(toggle.entity);
        world.insert(toggle.entity, Name, { value: `${label} Tab` });
        const text = spawnUIEntity({ world, parent: toggle.entity, node: { fill: true },
            text: { content: label, color: themeColors(world).text } });
        markThemed(world, text, { text: 'text' });
        const page = spawnUIEntity({ world, parent: entity, node: {
            fill: true, insetTop: px(height + 12), insetLeft: px(12), insetRight: px(12), insetBottom: px(12),
        } });
        const node = world.get(page, UINode);
        world.insert(page, UINode, { ...node, display: i === selected ? UIDisplay.Flex : UIDisplay.None });
        pages.push(page);
        world.insert(page, Name, { value: `${label} Page` });
    });
    world.insert(entity, UITabView, { ...structuredClone(UITabView._default), selectedIndex: selected,
        labels: [...opts.labels], tabs, pages });
    const off = opts.onChange ? events.on(entity, UIEventType.Change, ev => {
        const { index, page } = ev.data as { index: number; page: Entity }; opts.onChange!(index, page);
    }) : undefined;
    return { entity, tabs, pages, select(index) {
        const d = world.get(entity, UITabView) as UITabViewData;
        world.insert(entity, UITabView, { ...d, selectedIndex: index });
    }, dispose() { off?.(); for (const h of handles) h.dispose(); if (world.valid(entity)) world.despawn(entity); } };
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/behavior/scrollbar.ts
 * @brief   Auto-fading overlay scrollbar thumbs for scroll containers.
 *
 * Every attached ScrollContainer (list views, scroll views) gets lazy thumb
 * entities per scrollable axis: they appear while the offset moves, then fade
 * out after a short idle — the modern overlay convention, no layout impact
 * (Absolute, out of flow) and no input surface (not interactable). Thumbs are
 * theme-tagged (`text` role, alpha preserved) so they re-skin live.
 */
import { defineSystem, type SystemDef } from '../../system';
import { Res, Time, type TimeData } from '../../resource';
import type { World } from '../../world';
import type { Entity, Vec2 } from '../../types';
import { px } from '../core/dimension';
import { spawnUIEntity } from '../core/compose';
import { UINode, UIPositionType, type UINodeData } from '../core/ui-node';
import { UIVisual, type UIVisualData } from '../core/ui-visual';
import { themeColors } from '../theme/tokens';
import { markThemed } from '../theme/theme-style';
import { EntityStateMap } from '../util/helpers';
import type { ScrollContainer, ScrollContainerRegistry } from '../collection/scroll-container';

const THUMB_THICKNESS = 4;
const THUMB_MARGIN = 2;
const THUMB_MIN_LENGTH = 20;
const THUMB_ALPHA = 0.35;
/** Seconds of stillness before the fade starts, and the fade's duration. */
const IDLE_DELAY = 0.8;
const FADE_TIME = 0.3;

interface BarState {
    v: Entity | null;
    h: Entity | null;
    last: Vec2;
    /** Seconds since the offset last moved. */
    idle: number;
}

function spawnThumb(world: World, viewport: Entity, axis: 'v' | 'h'): Entity {
    const thumb = spawnUIEntity({
        world,
        parent: viewport,
        node: axis === 'v'
            ? {
                  position: UIPositionType.Absolute,
                  insetRight: px(THUMB_MARGIN),
                  insetTop: px(0),
                  width: px(THUMB_THICKNESS),
                  height: px(THUMB_MIN_LENGTH),
              }
            : {
                  position: UIPositionType.Absolute,
                  insetBottom: px(THUMB_MARGIN),
                  insetLeft: px(0),
                  height: px(THUMB_THICKNESS),
                  width: px(THUMB_MIN_LENGTH),
              },
        visual: { color: { ...themeColors().text, a: 0 } },
    });
    markThemed(world, thumb, { visual: 'text' });
    return thumb;
}

function layoutThumb(
    world: World, thumb: Entity, axis: 'v' | 'h',
    offset: number, maxOffset: number, viewportLen: number, contentLen: number,
    alpha: number,
): void {
    if (!world.valid(thumb)) return;
    const len = Math.max(THUMB_MIN_LENGTH, (viewportLen / contentLen) * viewportLen);
    const range = Math.max(0, viewportLen - len);
    const along = maxOffset > 0 ? (offset / maxOffset) * range : 0;

    const n = world.get(thumb, UINode) as UINodeData;
    if (axis === 'v') {
        n.insetTop = px(along);
        n.height = px(len);
    } else {
        n.insetLeft = px(along);
        n.width = px(len);
    }
    world.insert(thumb, UINode, n);

    const vis = world.get(thumb, UIVisual) as UIVisualData;
    const a = THUMB_ALPHA * alpha;
    if (Math.abs(vis.color.a - a) > 0.001) {
        vis.color = { ...vis.color, a };
        world.insert(thumb, UIVisual, vis);
    }
}

/** Sync thumbs for every attached scroll container; fade after idle. */
export function createScrollbarSystem(
    world: World,
    containers: ScrollContainerRegistry,
): SystemDef {
    const bars = new EntityStateMap<BarState>();

    return defineSystem([Res(Time)], (time: TimeData) => {
        const seen = new Set<Entity>();
        for (const [entityNum, container] of containers.entries()) {
            const entity = entityNum as Entity;
            if (!world.valid(entity) || !(container as ScrollContainer).getShowScrollbar()) continue;
            seen.add(entity);

            const offset = container.getOffset();
            const viewport = container.getViewportSize();
            const content = container.getContentSize();
            const max = container.getMaxOffset();

            let bar = bars.get(entity);
            if (!bar) {
                bar = { v: null, h: null, last: offset, idle: IDLE_DELAY + FADE_TIME };
                bars.set(entity, bar);
            }

            if (offset.x !== bar.last.x || offset.y !== bar.last.y) {
                bar.last = offset;
                bar.idle = 0;
            } else {
                bar.idle += time.delta;
            }
            const alpha = bar.idle <= IDLE_DELAY
                ? 1
                : Math.max(0, 1 - (bar.idle - IDLE_DELAY) / FADE_TIME);

            if (max.y > 0 && bar.v === null && alpha > 0) bar.v = spawnThumb(world, entity, 'v');
            if (max.x > 0 && bar.h === null && alpha > 0) bar.h = spawnThumb(world, entity, 'h');
            if (bar.v !== null) {
                layoutThumb(world, bar.v, 'v', offset.y, max.y, viewport.y, content.y, max.y > 0 ? alpha : 0);
            }
            if (bar.h !== null) {
                layoutThumb(world, bar.h, 'h', offset.x, max.x, viewport.x, content.x, max.x > 0 ? alpha : 0);
            }
        }

        // Detached / despawned containers: drop the thumbs with them.
        for (const [entity, bar] of bars) {
            if (seen.has(entity)) continue;
            if (bar.v !== null && world.valid(bar.v)) world.despawn(bar.v);
            if (bar.h !== null && world.valid(bar.h)) world.despawn(bar.h);
            bars.delete(entity);
        }
    }, { name: 'UIScrollbarSystem' });
}

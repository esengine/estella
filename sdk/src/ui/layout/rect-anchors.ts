// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/layout/rect-anchors.ts
 * @brief   `RectAnchors` — a piece of world content pinned to the edges (or the centre) of its parent's rectangle, and the system that keeps it there.
 *
 * `UINode` is the engine's flexbox layout, for UI that is laid out. Content placed by its `Transform` and sized by a `ContentRect` (an
 * imported scene, a hand-built HUD) is not: its box does not depend on its siblings, but it often wants to follow its parent, or the screen.
 * This is that, as data: each axis is stretched (both edges pinned: the size follows the parent), pinned to one edge, or centred with an
 * offset, with margins in layout units or as a fraction of the parent.
 *
 * A node whose parent has no `ContentRect` aligns to the screen: the layout box of the UI camera's domain (`ScreenLayout`), which is
 * centred on the world origin. Parents are aligned before the children that depend on their size, in the editor's edit mode as well as in play, so a
 * scene shows laid out as it will run.
 *
 * How often it runs is `alignMode`: ONCE (the first time), ON_RESIZE (when it is enabled, when its own settings change, and whenever the screen
 * changes), ALWAYS (every frame). Changing a setting re-aligns it whatever the mode.
 */
import type { App, Plugin } from '../../app/app';
import { defineComponent, registerComponent, Transform } from '../../ecs/component';
import { Parent } from '../../ecs/component';
import { Res } from '../../ecs/resource';
import { SystemLabel } from '../../ecs/systemLabels';
import { defineSystem, Schedule } from '../../ecs/system';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { ContentRect } from '../core/content-rect';
import { ScreenLayout, type ScreenLayoutData } from '../core/screen-layout';
import { AnchorMode, anchoredRect, type Box, type RectAnchorsData } from './anchored-rect';

export { AnchorFlag, AnchorMode, anchoredRect, type RectAnchorsData } from './anchored-rect';

export const RectAnchors = defineComponent<RectAnchorsData>('RectAnchors', {
    alignFlags: 0,
    left: 0, right: 0, top: 0, bottom: 0,
    horizontalCenter: 0, verticalCenter: 0,
    isAbsLeft: true, isAbsRight: true, isAbsTop: true, isAbsBottom: true, isAbsHorizontalCenter: true, isAbsVerticalCenter: true,
    alignMode: AnchorMode.ON_RESIZE,
    enabled: true,
});

/** What the last alignment of one node saw: its settings, and the screen it was done on. */
interface Seen { signature: string; generation: number; once: boolean }
const seenByWorld = new WeakMap<World, Map<Entity, Seen>>();

const SETTINGS = ['alignFlags', 'left', 'right', 'top', 'bottom', 'horizontalCenter', 'verticalCenter', 'isAbsLeft', 'isAbsRight', 'isAbsTop', 'isAbsBottom', 'isAbsHorizontalCenter', 'isAbsVerticalCenter', 'alignMode'] as const;
const signatureOf = (a: RectAnchorsData): string => SETTINGS.map((k) => String(a[k])).join(',');

/** The screen box of a layout, as the box a root node aligns to. */
function screenBox(screen: ScreenLayoutData): Box { return { left: screen.left, right: screen.right, bottom: screen.bottom, top: screen.top }; }

function parentBox(world: World, entity: Entity, screen: ScreenLayoutData | null): Box | null {
    const parent = world.tryGet(entity, Parent)?.entity;
    const rect = parent ? world.tryGet(parent as Entity, ContentRect) : undefined;
    if (rect) {
        const left = -rect.pivot.x * rect.size.x;
        const bottom = -rect.pivot.y * rect.size.y;
        return { left, right: left + rect.size.x, bottom, top: bottom + rect.size.y };
    }
    return screen?.valid ? screenBox(screen) : null;
}

function depthOf(world: World, entity: Entity): number {
    let d = 0;
    for (let p = world.tryGet(entity, Parent)?.entity as Entity | undefined; p; p = world.tryGet(p, Parent)?.entity as Entity | undefined) d++;
    return d;
}

/** Align one node now, whatever its mode. Answers whether it had a box to align to. */
export function alignRectAnchorsNow(world: World, entity: Entity, screen: ScreenLayoutData | null): boolean {
    const a = world.tryGet(entity, RectAnchors);
    const t = world.tryGet(entity, Transform);
    if (!a || !t) return false;
    const box = parentBox(world, entity, screen);
    if (!box) return false;
    const rect = world.tryGet(entity, ContentRect);
    const out = anchoredRect(
        a, box,
        { width: rect?.size.x ?? 0, height: rect?.size.y ?? 0, pivotX: rect?.pivot.x ?? 0.5, pivotY: rect?.pivot.y ?? 0.5 },
        { x: t.scale.x, y: t.scale.y }, { x: t.position.x, y: t.position.y },
    );
    if (out.x !== t.position.x || out.y !== t.position.y) world.set(entity, Transform, { ...t, position: { x: out.x, y: out.y, z: t.position.z } });
    if (rect && (out.width !== rect.size.x || out.height !== rect.size.y)) world.set(entity, ContentRect, { ...rect, size: { x: out.width, y: out.height } });
    return true;
}

/**
 * Align every node that is due, parents first. @p generation changes whenever the screen does.
 */
export function alignAllRectAnchors(world: World, screen: ScreenLayoutData | null, generation: number): void {
    let seen = seenByWorld.get(world);
    if (!seen) { seen = new Map(); seenByWorld.set(world, seen); }
    const due: Array<{ entity: Entity; depth: number }> = [];
    for (const entity of world.getEntitiesWithComponents([RectAnchors, Transform])) {
        const a = world.get(entity, RectAnchors);
        if (!a.enabled || a.alignFlags === 0 || !world.isEntityActive(entity)) continue;
        const state = seen.get(entity);
        const signature = signatureOf(a);
        let isDue: boolean;
        if (a.alignMode === AnchorMode.ALWAYS) isDue = true;
        else if (!state || state.signature !== signature) isDue = true;
        else if (a.alignMode === AnchorMode.ONCE) isDue = false;
        else isDue = state.generation !== generation;
        if (isDue) due.push({ entity, depth: depthOf(world, entity) });
    }
    due.sort((x, y) => x.depth - y.depth);
    for (const { entity } of due) {
        if (alignRectAnchorsNow(world, entity, screen)) {
            seen.set(entity, { signature: signatureOf(world.get(entity, RectAnchors)), generation, once: true });
        }
    }
}

/** Forget what was aligned (a scene that is replaced; a test seam). */
export function forgetRectAnchors(world: World): void { seenByWorld.delete(world); }

let screenGeneration = 0;
let lastScreenKey = '';

let screenFallback: (() => ScreenLayoutData | null) | null = null;
/**
 * The screen to align to where the engine has published none yet (a host before its first frame, a test): a layer that knows the
 * size it was told supplies it here, so a root pinned to the screen still has a box.
 */
export function setRectAnchorsScreenFallback(fn: (() => ScreenLayoutData | null) | null): void { screenFallback = fn; }

function alignFrame(world: World, published: ScreenLayoutData | undefined): void {
    const screen = published?.valid ? published : screenFallback?.() ?? published ?? null;
    const key = screen?.valid ? `${screen.left},${screen.right},${screen.bottom},${screen.top}` : '';
    if (key !== lastScreenKey) { lastScreenKey = key; screenGeneration++; }
    alignAllRectAnchors(world, screen, screenGeneration);
}

/**
 * Two passes a frame, the way the engine's own layout has two: anchors place what is pinned, anything that arranges or resizes
 * content (a layout of another layer) runs between them by ordering itself after the first label and before the second, and the
 * second pass moves only the nodes set to follow every frame, since the rest were settled by the first.
 */
export class RectAnchorsPlugin implements Plugin {
    name = 'rectAnchors';

    build(app: App): void {
        registerComponent('RectAnchors', RectAnchors);
        const world = app.world;
        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [Res(ScreenLayout)],
            (screen: ScreenLayoutData) => alignFrame(world, screen),
            { name: SystemLabel.RectAnchors },
        ), { runBefore: [SystemLabel.UILayoutLate] });
        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [Res(ScreenLayout)],
            (screen: ScreenLayoutData) => alignFrame(world, screen),
            { name: SystemLabel.RectAnchorsLate },
        ), { runAfter: [SystemLabel.RectAnchors], runBefore: [SystemLabel.UIRenderOrder] });
    }
}

export const rectAnchorsPlugin = new RectAnchorsPlugin();

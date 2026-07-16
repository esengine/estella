// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/controller/gear-apply.ts
 * @brief   The systems that turn controller pages into applied field values.
 *
 * Two systems, both modelled on the proven StateVisualsApplySystem shape:
 *
 *   • InteractionControllerDriverSystem — writes the `$interaction` controller's
 *     `current` page from pointer state (reusing `driverStateFor`), so a button
 *     built from UIController + gears reproduces normal/hover/pressed/disabled
 *     with no bespoke StateMachine.
 *   • GearApplySystem — for every UIGear binding, resolves its controller's page,
 *     looks up the page's value, and writes it to the target field, snapping or
 *     tweening. It runs in edit mode too (not play-gated): setting a controller's
 *     `current` in the editor immediately previews that page, for free.
 *
 * The read/write/lerp helpers are pure and exported so unit tests (and a future
 * editor preview path) can exercise the value logic without a World.
 */
import { defineSystem, type SystemDef } from '../../system';
import { getComponent } from '../../component';
import { Res, Time, type TimeData } from '../../resource';
import { applyEasing } from '../../animation/Easing';
import { EntityStateMap } from '../util/helpers';
import { Interactable, UIInteraction, type InteractableData, type UIInteractionData } from '../input/interactable';
import { driverStateFor } from '../behavior/systems';
import type { Entity } from '../../types';
import type { World } from '../../world';
import {
    UIController,
    INTERACTION_CONTROLLER,
    getControllerPage,
    type UIControllerData,
} from './ui-controller';
import { UIGear, type GearValue, type UIGearData } from './ui-gear';

// ─── Pure field/value helpers ───────────────────────────────────────────────

/** Read the value at a dot-path (returns undefined if the path doesn't resolve). */
export function readFieldPath(data: Record<string, any>, path: string): unknown {
    const parts = path.split('.');
    let cur: any = data;
    for (const p of parts) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = cur[p];
    }
    return cur;
}

/**
 * Write `value` at a dot-path. Object values (Color/Vec) are shallow-cloned so a
 * shared authored value never becomes aliased across entities. Returns false
 * (writes nothing) when the path doesn't resolve to an existing leaf.
 */
export function writeFieldPath(data: Record<string, any>, path: string, value: unknown): boolean {
    const parts = path.split('.');
    let cur: any = data;
    for (let i = 0; i < parts.length - 1; i++) {
        cur = cur[parts[i]];
        if (cur == null || typeof cur !== 'object') return false;
    }
    const last = parts[parts.length - 1];
    if (cur == null || typeof cur !== 'object' || !(last in cur)) return false;
    cur[last] = (value !== null && typeof value === 'object') ? { ...(value as object) } : value;
    return true;
}

/** Numbers, colours (`r`…), and vectors (`x`…) interpolate; everything else snaps. */
export function isLerpable(v: unknown): boolean {
    if (typeof v === 'number') return true;
    if (v !== null && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        return typeof o.r === 'number' || typeof o.x === 'number';
    }
    return false;
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/**
 * Interpolate between two gear values at `t`. Handles number, Color (r/g/b/a),
 * and Vec2/Vec3 (x/y/z); any non-numeric or shape-mismatched pair falls through
 * to the target (a snap). Type is chosen from `to` (the authored destination).
 */
export function lerpGearValue(from: unknown, to: unknown, t: number): unknown {
    if (typeof to === 'number') {
        return typeof from === 'number' ? lerp(from, to, t) : to;
    }
    if (to !== null && typeof to === 'object' && from !== null && typeof from === 'object') {
        const f = from as Record<string, number>;
        const g = to as Record<string, number>;
        if (typeof g.r === 'number' && typeof f.r === 'number') {
            return {
                r: lerp(f.r, g.r, t), g: lerp(f.g, g.g, t),
                b: lerp(f.b, g.b, t), a: lerp(f.a ?? 1, g.a ?? 1, t),
            };
        }
        if (typeof g.x === 'number' && typeof f.x === 'number') {
            const out: Record<string, number> = { x: lerp(f.x, g.x, t), y: lerp(f.y, g.y, t) };
            if ('z' in g) out.z = lerp(f.z ?? 0, g.z ?? 0, t);
            return out;
        }
    }
    return to;
}

// ─── Systems ────────────────────────────────────────────────────────────────

/**
 * Writes the `$interaction` controller's page from Interactable + UIInteraction,
 * reusing the same pure derivation the legacy StateMachine driver uses. Only
 * touches entities that actually declare a `$interaction` controller, and only
 * to a page the controller lists — so a controller with a custom page set (say
 * no "disabled") is never forced into a page it doesn't have.
 */
export function createInteractionControllerDriverSystem(world: World): SystemDef {
    return defineSystem([], () => {
        for (const e of world.getEntitiesWithComponents([Interactable, UIController])) {
            const data = world.get(e, UIController) as UIControllerData;
            const ctrl = data.controllers.find(c => c.name === INTERACTION_CONTROLLER);
            if (!ctrl) continue;

            const inter = world.has(e, UIInteraction)
                ? (world.get(e, UIInteraction) as UIInteractionData)
                : null;
            const interactable = world.get(e, Interactable) as InteractableData;
            const next = driverStateFor(interactable.enabled, inter);
            if (next !== ctrl.current && ctrl.pages.includes(next)) {
                ctrl.current = next;
                world.insert(e, UIController, data);
            }
        }
    }, { name: 'InteractionControllerDriverSystem' });
}

/** Per-binding transition bookkeeping (kept out of the ECS, GC'd with the entity). */
interface BindingTx {
    /** Page this transition is heading to / settled at. */
    page: string;
    elapsed: number;
    /** Snapshot of the field value when the page changed (the tween's `from`). */
    from: unknown;
    /** Settled: value written, skip work until the page changes again. */
    done: boolean;
}

/**
 * Applies every UIGear binding from its controller's current page. Snaps when the
 * binding has no tween (or the value can't interpolate); otherwise eases from the
 * field's value at page-change time over `tween.duration`. Idle bindings settle
 * (stop writing) until their page changes, matching StateVisuals' write-once
 * behaviour so a static UI costs nothing per frame.
 */
export function createGearApplySystem(world: World): SystemDef {
    const tracker = new EntityStateMap<Array<BindingTx | null>>();

    return defineSystem([Res(Time)], (time: TimeData) => {
        const dt = time.delta;
        const seen = new Set<Entity>();

        for (const e of world.getEntitiesWithComponents([UIGear])) {
            seen.add(e);
            const gear = world.get(e, UIGear) as UIGearData;
            const bindings = gear.bindings;

            let txs = tracker.get(e);
            if (!txs || txs.length !== bindings.length) {
                txs = bindings.map(() => null);
                tracker.set(e, txs);
            }

            for (let i = 0; i < bindings.length; i++) {
                const b = bindings[i];
                const page = getControllerPage(world, e, b.controller);
                if (page === null) continue;

                const target = b.pages[page];
                if (target === undefined) continue; // page not authored → leave field alone

                const comp = getComponent(b.component);
                if (!comp || !world.has(e, comp)) continue;

                const fade = Math.max(0, b.tween?.duration ?? 0);
                const lerpable = fade > 0 && isLerpable(target);

                let tx = txs[i];
                if (!tx || tx.page !== page) {
                    const cur = readFieldPath(world.get(e, comp) as Record<string, any>, b.property);
                    tx = { page, elapsed: 0, from: lerpable ? cur : (target as GearValue), done: false };
                    txs[i] = tx;
                } else if (tx.done) {
                    continue;
                } else {
                    tx.elapsed += dt;
                }

                const t = lerpable ? Math.min(tx.elapsed / fade, 1) : 1;
                const value = (lerpable && t < 1)
                    ? lerpGearValue(tx.from, target, applyEasing(b.tween!.easing, t))
                    : target;

                const data = world.get(e, comp) as Record<string, any>;
                if (writeFieldPath(data, b.property, value)) {
                    world.insert(e, comp, data);
                }
                if (t >= 1) tx.done = true;
            }
        }

        // Purge trackers for entities that no longer carry UIGear (the query only
        // yields live UIGear entities, so anything unseen is gone or stripped).
        for (const [e] of tracker) {
            if (!seen.has(e)) tracker.delete(e);
        }
    }, { name: 'GearApplySystem' });
}

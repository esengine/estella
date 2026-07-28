// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    eventBinding.ts
 * @brief   EventBinding — an authored wire from an entity event to a named action.
 *
 * The data form of `events.on(entity, 'click', …)`: a serializable component
 * whose rows say "when THIS entity sees `click`, run the action named
 * `ui.setPage` on `target`". It is deliberately a *wire*, not a program — there
 * are no expressions, no branches, no scripts in the data. Anything with logic
 * in it points at an action name, and a name can resolve to a whole `.esfsm`
 * (via `fsm.fire`), which is where the engine already has a visual logic editor.
 *
 * Everything here reuses a seam that already exists rather than inventing a
 * parallel one:
 *   · the event side is the entity event channel widgets already emit into
 *     ({@link EntityEventQueue}) — bubbling included, so a row on a panel hears
 *     its buttons;
 *   · the action side is the SAME `aiRegistry` that `.esfsm` state hooks and
 *     `.esbt` leaves resolve against, so one `registerAction` shows up in all
 *     three places and the editor palettes need no new source;
 *   · the target side resolves by NAME, nearest-first (self → subtree →
 *     ancestors' subtrees), mirroring how `UIGear` finds its controller.
 *     Nearest-wins is what keeps two instances of the same prefab from wiring
 *     into each other.
 */
import { defineComponent, Children, Name, Parent } from './ecs/component';
import type { ChildrenData, NameData, ParentData } from './ecs/component';
import type { App, Plugin } from './app';
import type { Entity } from './types';
import type { World } from './ecs/world';
import { defineSystem, Schedule } from './ecs/system';
import { Commands, type CommandsInstance } from './ecs/commands';
import { Res, Time, type TimeData } from './ecs/resource';
import { playModeOnly } from './env';
import { log } from './logger';
import { ensureEntityEvents, EntityEventQueue, type EntityEvent, type Unsubscribe } from './ecs/entityEvents';
import { Blackboard } from './ai/fsm/Blackboard';
import { aiRegistry, type AiContext } from './ai/fsm/AiContext';
import { invokeAction, type AiParamValue } from './ai/fsm/registry';
import { AiFsm } from './ai/fsm/FsmPlugin';
import { ensureBuiltinAiRegistrations } from './ai/builtins';

/**
 * One authored wire. `event` is an open string (the widget vocabulary lives in
 * `UIEventType`, but any emitted name works); `action`/`guard` are
 * `aiRegistry` names; `arg` is the action's per-reference argument, exactly as
 * `.esfsm`/`.esbt` carry it.
 */
export interface EventBindingRow {
    /** Event type to listen for on this entity, e.g. `'click'`. */
    event: string;
    /**
     * Name of the entity the action runs on. Empty/omitted = the entity that
     * carries the binding. Resolution is nearest-first, so a name inside a
     * prefab instance finds that instance's copy.
     */
    target?: string;
    /** Registered action name (`aiRegistry`), e.g. `'ui.setPage'`. */
    action: string;
    /**
     * The action's argument in canonical string form, e.g. `'tabs:settings'`.
     * Rows authored before the action declared its parameters keep this and
     * still run — the registry projects between the two forms.
     */
    arg?: string;
    /**
     * The action's declared parameters by name, e.g. `{controller: 'tabs', page:
     * 'settings'}`. Present when the action declares parameters; wins over `arg`.
     */
    params?: Record<string, AiParamValue>;
    /** Registered condition name that must pass for the row to run. */
    guard?: string;
    /** Run at most once, then stay inert until the scene reloads. */
    once?: boolean;
    /** Authoring toggle — an unchecked row stays in the data but never fires. */
    enabled?: boolean;
}

export interface EventBindingData {
    rows: EventBindingRow[];
}

export const EventBinding = defineComponent<EventBindingData>('EventBinding', {
    rows: [],
});

/**
 * The entity named `name`, searched nearest-first from `from`: `from` itself,
 * then its subtree, then each ancestor's subtree (skipping the branch already
 * searched), and finally the world-wide name index as a fallback for scenes
 * with no shared root. Returns null when nothing matches.
 *
 * Exported for tests and for editor-side parity checks.
 */
export function resolveBindingTarget(world: World, from: Entity, name: string): Entity | null {
    if (!name) return from;

    let node: Entity | null = from;
    let skip: Entity | null = null;
    while (node !== null && world.valid(node)) {
        const hit = findInSubtree(world, node, name, skip);
        if (hit !== null) return hit;
        skip = node;
        node = parentOf(world, node);
    }
    return world.findEntityByName(name);
}

function parentOf(world: World, entity: Entity): Entity | null {
    if (!world.has(entity, Parent)) return null;
    const parent = (world.get(entity, Parent) as ParentData).entity;
    return world.valid(parent) ? parent : null;
}

function nameOf(world: World, entity: Entity): string {
    return world.has(entity, Name) ? (world.get(entity, Name) as NameData).value : '';
}

/** Depth-first search of `root`'s subtree (root included), skipping one branch. */
function findInSubtree(world: World, root: Entity, name: string, skip: Entity | null): Entity | null {
    if (root === skip || !world.valid(root)) return null;
    if (nameOf(world, root) === name) return root;
    if (!world.has(root, Children)) return null;
    for (const child of (world.get(root, Children) as ChildrenData).entities) {
        const hit = findInSubtree(world, child as Entity, name, skip);
        if (hit !== null) return hit;
    }
    return null;
}

/** What the dispatcher needs from its host — an App in production, fakes in tests. */
export interface EventBindingHost {
    world: World;
    events: EntityEventQueue;
    /** The blackboard actions read/write for `entity` (shared with the FSM layer). */
    blackboardOf(entity: Entity): Blackboard;
    /** Deferred structural ops for the action context; null outside a frame. */
    commands(): CommandsInstance | null;
    /** Current frame delta, for actions that care. */
    dt(): number;
}

export interface EventBindingRuntime {
    /** Re-subscribe to exactly the set of event types the scene now authors. */
    sync(): void;
    /** Drop every subscription and the `once` ledger. */
    dispose(): void;
}

/**
 * Runs authored rows when their event fires. Subscribes ONE global handler per
 * distinct authored event type rather than one per (entity, event): rows can
 * then be edited live — the editor rewrites the component and the next event
 * reads the new data — and bubbling still reaches an ancestor's rows, because a
 * bubbled event dispatches with `currentTarget` set to that ancestor.
 */
export function createEventBindingRuntime(host: EventBindingHost): EventBindingRuntime {
    const { world, events } = host;
    const subscriptions = new Map<string, Unsubscribe>();
    /** Entity:row pairs already spent, for `once`. */
    const fired = new Set<string>();

    const runRow = (self: Entity, row: EventBindingRow): void => {
        if (!aiRegistry.hasAction(row.action)) {
            log.warn('events', `EventBinding: unknown action "${row.action}"`);
            return;
        }
        const target = resolveBindingTarget(world, self, row.target ?? '');
        if (target === null || !world.valid(target)) {
            log.warn('events', `EventBinding: no entity named "${row.target}"`);
            return;
        }
        const bb = host.blackboardOf(target);
        const ctx: AiContext = {
            entity: target,
            dt: host.dt(),
            blackboard: bb,
            world,
            commands: host.commands() as CommandsInstance,
            get: (c) => world.get(target, c),
            set: (c, d) => world.set(target, c, d),
            has: (c) => world.has(target, c),
        };
        if (row.guard) {
            const guard = aiRegistry.getCondition(row.guard);
            if (!guard) {
                log.warn('events', `EventBinding: unknown condition "${row.guard}"`);
                return;
            }
            if (!guard(ctx, bb)) return;
        }
        // The same dispatch path the FSM and the behaviour tree take, so an
        // action sees identical input whichever authored surface reached it.
        invokeAction(aiRegistry, row.action, ctx, bb, { arg: row.arg, params: row.params });
    };

    const handle = (event: EntityEvent): void => {
        const self = event.currentTarget;
        if (!world.valid(self) || !world.has(self, EventBinding)) return;
        const data = world.get(self, EventBinding) as EventBindingData;
        // Index-keyed `once`: reordering rows re-arms them, which is the same
        // deal the rest of the authored-array surfaces (gears, tracks) offer.
        for (let i = 0; i < data.rows.length; i++) {
            const row = data.rows[i];
            if (row.event !== event.type || row.enabled === false || !row.action) continue;
            if (row.once) {
                const key = `${self as number}:${i}`;
                if (fired.has(key)) continue;
                fired.add(key);
            }
            runRow(self, row);
        }
    };

    return {
        // Keep the subscribed type set equal to the union of authored types.
        // Cheap (a set compare over a handful of components) and it makes rows
        // added at runtime — a spawned prefab, an editor edit — live next frame.
        sync(): void {
            const wanted = new Set<string>();
            for (const entity of world.getEntitiesWithComponents([EventBinding])) {
                const data = world.get(entity, EventBinding) as EventBindingData;
                for (const row of data.rows) {
                    if (row.event && row.action && row.enabled !== false) wanted.add(row.event);
                }
            }
            for (const [type, off] of subscriptions) {
                if (!wanted.has(type)) {
                    off();
                    subscriptions.delete(type);
                }
            }
            for (const type of wanted) {
                if (!subscriptions.has(type)) subscriptions.set(type, events.on(type, handle));
            }
        },
        dispose(): void {
            for (const off of subscriptions.values()) off();
            subscriptions.clear();
            fired.clear();
        },
    };
}

export class EventBindingPlugin implements Plugin {
    name = 'eventBinding';

    private runtime_: EventBindingRuntime | null = null;

    build(app: App): void {
        ensureBuiltinAiRegistrations();
        ensureEventBindingActions();

        const world = app.world;
        // The app's shared queue — binding works with UI absent too (a physics
        // trigger or game code can emit), so it must not depend on who built first.
        const events = ensureEntityEvents(app);

        // Blackboards are shared with the FSM layer when it is present, so a
        // `fsm.fire` from a click lands in the very blackboard the entity's
        // StateMachineAgent reads — the click → state-machine hand-off.
        const localBoards = new Map<Entity, Blackboard>();
        world.onDespawn((e: Entity) => localBoards.delete(e));

        let commands_: CommandsInstance | null = null;
        let dt_ = 0;

        const runtime = createEventBindingRuntime({
            world,
            events,
            blackboardOf: (entity) => {
                const fsm = app.hasResource(AiFsm) ? app.getResource(AiFsm) : null;
                if (fsm) return fsm.blackboard(entity);
                let bb = localBoards.get(entity);
                if (!bb) localBoards.set(entity, (bb = new Blackboard()));
                return bb;
            },
            commands: () => commands_,
            dt: () => dt_,
        });
        this.runtime_ = runtime;

        app.addSystemToSchedule(
            Schedule.PreUpdate,
            defineSystem(
                [Res(Time), Commands()],
                (time: TimeData, commands: CommandsInstance) => {
                    dt_ = time.delta;
                    commands_ = commands;
                    runtime.sync();
                },
                { name: 'EventBindingSystem' },
            ),
            { runIf: playModeOnly },
        );
    }

    cleanup(): void {
        this.runtime_?.dispose();
        this.runtime_ = null;
    }
}

/**
 * Actions that only make sense once events can drive them. Registered with the
 * same idempotent, game-wins policy as the other builtins.
 *
 * `fsm.fire` is the escape hatch that keeps the wire from growing into a
 * language: a click fires a trigger, and the entity's `.esfsm` — the actual
 * visual logic editor — decides what that means.
 */
export function ensureEventBindingActions(): void {
    if (!aiRegistry.hasAction('fsm.fire')) {
        aiRegistry.registerAction('fsm.fire', {
            params: [{ name: 'trigger', type: 'string' }],
            run: (_ctx, bb, _arg, params) => {
                const trigger = params?.trigger;
                if (typeof trigger === 'string' && trigger) bb.fire(trigger);
            },
        });
    }
    if (!aiRegistry.hasAction('blackboard.set')) {
        // `key=value`. The value keeps its JSON reading when it has one (`3`,
        // `true`), so both `lives=3` and `mode=hard` do the obvious thing.
        aiRegistry.registerAction('blackboard.set', {
            separator: '=',
            params: [{ name: 'key', type: 'string' }, { name: 'value', type: 'string' }],
            run: (_ctx, bb, _arg, params) => {
                const key = typeof params?.key === 'string' ? params.key.trim() : '';
                if (!key) return;
                const raw = params?.value;
                if (raw === undefined) return;
                let value: unknown = raw;
                if (typeof raw === 'string') {
                    try {
                        value = JSON.parse(raw.trim());
                    } catch {
                        value = raw.trim(); // a bare word is its own value
                    }
                }
                bb.set(key, value);
            },
        });
    }
}

export const eventBindingPlugin = new EventBindingPlugin();

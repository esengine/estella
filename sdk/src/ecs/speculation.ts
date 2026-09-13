// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    speculation.ts
 * @brief   A step of gameplay nobody has seen yet, and can take back
 *
 * Not a fifth deferral mechanism: a boundary the three the engine already has
 * agree on. Structural change goes to a `CommandsInstance` this scope owns and
 * flushes only on commit; events written inside it sit in each bus's write half
 * until the next swap, so a watermark un-writes them; component values are
 * copied on first touch — and the touch that counts is the HANDLE LEAVING, not
 * the write arriving, because script storage hands out the stored object itself
 * and by the time `set` is called the old value is already gone.
 *
 * `Transaction` in this directory is the EDITOR's undo/redo of an authoring
 * gesture, built from forward/reverse closure pairs. This is the runtime's, and
 * the two must not be confused: closures per mutation cannot be resimulated.
 */

import { Entity } from '../types';
import { AnyComponentDef } from './component';
import { CommandsInstance } from './commands';
import { EventRegistry } from './event';
import { defineResource, ResourceStorage } from './resource';
import { deepClone } from '../util/deepClone';
import type { World } from './world';

/** What the body decided. `abandon` must leave nothing a reader could see. */
export type SpeculationOutcome = 'commit' | 'abandon';

/** Everything the scope has to reach. Explicit rather than global: resources
 *  and the event registry belong to the app, and a kernel that guessed which
 *  one would be a second authority over both. */
export interface SpeculationScope {
    world: World;
    resources: ResourceStorage;
    /** Omit when the step writes no events — then there is no watermark to take. */
    events?: EventRegistry;
}

/** One component's value as it stood before the scope touched it; `absent`
 *  when the entity did not have it, so undoing means removing it again. */
interface Before {
    entity: Entity;
    component: AnyComponentDef;
    value: unknown | undefined;
}

/**
 * The undo log a World writes into while a speculation is open.
 *
 * First touch wins: a component written five times in one step still has one
 * pre-scope value, and restoring it is what "before" means.
 */
export class SpeculationLog {
    private readonly before_ = new Map<string, Before>();
    private restoring_ = false;
    private capturing_ = false;

    /** @internal Called by World wherever a handle leaves or a value lands. */
    record(world: World, entity: Entity, component: AnyComponentDef): void {
        // Reading the pre-image goes back through `tryGet`, which asks here.
        if (this.restoring_ || this.capturing_) return;
        const key = `${entity}:${String(component._id.description ?? component._id.toString())}`;
        if (this.before_.has(key)) return;
        this.capturing_ = true;
        try {
            const held = world.has(entity, component) ? world.tryGet(entity, component) : undefined;
            this.before_.set(key, {
                entity,
                component,
                value: held === undefined || held === null ? undefined : deepClone(held),
            });
        } finally {
            this.capturing_ = false;
        }
    }

    /** @internal Put every touched component back, without recording the undo. */
    undo(world: World): void {
        this.restoring_ = true;
        try {
            for (const { entity, component, value } of this.before_.values()) {
                if (value === undefined) {
                    if (world.has(entity, component)) world.remove(entity, component);
                } else {
                    world.set(entity, component, value as never);
                }
            }
        } finally {
            this.restoring_ = false;
            this.before_.clear();
        }
    }

    /** @internal */
    forget(): void {
        this.before_.clear();
    }

    /** @internal Where the step LEFT every component it touched. Read with the
     *  speculation already closed, so looking does not record. */
    postImage(world: World): string {
        const rows: string[] = [];
        for (const [key, { entity, component }] of this.before_) {
            const held = world.has(entity, component) ? world.tryGet(entity, component) : undefined;
            rows.push(`${key}=${held === undefined || held === null ? 'absent' : stableText(held)}`);
        }
        return rows.sort().join('|');
    }
}

/** Key order is not a difference a replay should report, so sort it away. */
function stableText(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
    if (Array.isArray(value)) return `[${value.map(stableText).join(',')}]`;
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec).sort().map((k) => `${k}:${stableText(rec[k])}`).join(',')}}`;
}

/** What one run of a step did, on the three surfaces the scope owns. */
interface Trace {
    outcome: SpeculationOutcome;
    values: string;
    commands: string;
    events: string;
}

/** Run the step and take it back, keeping an account of what it did. */
function trace(scope: SpeculationScope, body: (commands: CommandsInstance) => SpeculationOutcome): Trace {
    const { world, resources, events } = scope;
    const log = new SpeculationLog();
    const commands = new CommandsInstance(world, resources);
    const marks = events?.writeMarks();

    world.openSpeculation(log);
    let outcome: SpeculationOutcome;
    try {
        outcome = body(commands);
    } finally {
        world.closeSpeculation();
    }
    const taken: Trace = {
        outcome,
        values: log.postImage(world),
        commands: commands.describe(),
        events: marks && events ? events.writtenSince(marks) : '',
    };
    log.undo(world);
    if (marks && events) events.rewindWrites(marks);
    return taken;
}

/** Whether a step reached the same place twice, and what differed if not. */
export interface ReplayReport {
    stable: boolean;
    why: string;
}

/**
 * Run the same step twice from the same state, over the three surfaces this
 * scope aligns; both runs are taken back. A predicted step already promises to
 * depend "only on world state + actions + dt" (replication/client.ts), and
 * nothing held it to that — a clock or a random source reads green until desync.
 */
export function replay(
    scope: SpeculationScope,
    body: (commands: CommandsInstance) => SpeculationOutcome,
): ReplayReport {
    const first = trace(scope, body);
    const second = trace(scope, body);
    for (const surface of ['outcome', 'values', 'commands', 'events'] as const) {
        if (first[surface] !== second[surface]) {
            return {
                stable: false,
                why: `${surface} differed between runs: ${String(first[surface])} then ${String(second[surface])}`,
            };
        }
    }
    return { stable: true, why: '' };
}

/**
 * Run `body` as a step that has not happened yet.
 *
 * It gets the scope's own command queue, and that is what keeps an abandoned
 * step from consuming an identity: `EntityCommands` allocates none until the
 * queue is flushed. Spawning on the World itself throws inside the scope.
 */
export function speculate(
    scope: SpeculationScope,
    body: (commands: CommandsInstance) => SpeculationOutcome,
): SpeculationOutcome {
    const { world, resources, events } = scope;
    const log = new SpeculationLog();
    const commands = new CommandsInstance(world, resources);
    const marks = events?.writeMarks();

    world.openSpeculation(log);
    let outcome: SpeculationOutcome;
    try {
        outcome = body(commands);
    } catch (e) {
        world.closeSpeculation();
        log.undo(world);
        if (marks && events) events.rewindWrites(marks);
        throw e;
    }
    world.closeSpeculation();

    if (outcome === 'commit') {
        log.forget();
        commands.flush();
        return 'commit';
    }
    log.undo(world);
    if (marks && events) events.rewindWrites(marks);
    return 'abandon';
}

// =============================================================================
// As a service a system asks for
// =============================================================================

/**
 * The scope a system was handed. `run` is one step: the body mutates, then says
 * whether it happened.
 *
 * @experimental
 */
export class SpeculationInstance {
    private readonly world_: World;
    private readonly resources_: ResourceStorage;
    private readonly events_: EventRegistry | null;

    constructor(world: World, resources: ResourceStorage, events: EventRegistry | null) {
        this.world_ = world;
        this.resources_ = resources;
        this.events_ = events;
    }

    run(body: (commands: CommandsInstance) => SpeculationOutcome): SpeculationOutcome {
        return speculate(this.scope_(), body);
    }

    /** Ask whether the step is a function of the world alone. Takes both runs
     *  back, so asking costs the world nothing. */
    replay(body: (commands: CommandsInstance) => SpeculationOutcome): ReplayReport {
        return replay(this.scope_(), body);
    }

    private scope_(): SpeculationScope {
        return { world: this.world_, resources: this.resources_, events: this.events_ ?? undefined };
    }
}

/**
 * `Res(Speculation)` — the engine's existing way for a system to be handed a
 * service, which is what this is. The parameter vocabulary is a frozen public
 * type: a capability that grows it breaks that promise for every reader of
 * `SystemParam`, and a service does not need to.
 *
 * @experimental
 */
export const Speculation = defineResource<SpeculationInstance>(null!, 'Speculation');

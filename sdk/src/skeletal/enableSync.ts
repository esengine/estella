// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    skeletal/enableSync.ts
 * @brief   Making a skeletal component's `enabled` field mean what it says.
 *
 * @details Every other renderable is drawn straight from its component, so
 *          clearing `enabled` stops it: the renderer walks the World and the flag
 *          is right there. A skeleton is not. Its instance lives in a side
 *          module's heap, keyed by entity in a manager the renderer knows nothing
 *          about, and the manager submits from ITS table — so the World's copy of
 *          the flag was read by nobody. The editor's eye toggle, the inspector's
 *          checkbox and a gameplay `world.set(e, SpineAnimation, {enabled:false})`
 *          all wrote a value that changed nothing.
 *
 *          This is the one place that closes the loop, and it closes it for both
 *          runtimes: once a frame, each bound entity's flag is carried from the
 *          World into the manager that draws it.
 *
 *          EDGE-TRIGGERED, deliberately. A flag has two writers — the component
 *          (authoring, editor visibility, gameplay writes) and the manager's own
 *          `setEnabled` (the imperative API) — and a mirror that pushed every
 *          frame would make the second one useless, undoing it on the next tick.
 *          Pushing only when the component's value actually MOVES leaves both
 *          honest: writing the field wins at the moment it is written, and
 *          between writes the imperative switch is free to override. It also
 *          means an entity whose binding lands after the field was written still
 *          picks it up (the first sync it appears in has nothing memoised for it),
 *          so no writer of the field needs to know when a skeleton finished
 *          loading.
 */
import type { Entity } from '../types';
import type { AnyComponentDef, ComponentData } from '../ecs/component';

/** The slice of the World this reads: one component's data, or null if absent. */
export interface SkeletalEnableWorld {
    tryGet<C extends AnyComponentDef>(entity: Entity, component: C): ComponentData<C> | null;
}

/** A skeletal runtime's manager, seen as "which entities it holds, and the switch". */
export interface SkeletalEnableTarget {
    /** The entities this manager currently has an instance for. */
    boundEntities(): Iterable<Entity>;
    /** Take an entity out of / put it back into the frame. */
    setEnabled(entity: Entity, enabled: boolean): void;
}

/**
 * Carries `<component>.enabled` from the World into one skeletal manager, on the
 * edges of that field. Hold one per manager (the memo of what it last pushed is
 * what makes it edge-triggered) and call {@link sync} once per frame, before the
 * manager advances and submits.
 */
export class SkeletalEnableMirror {
    /** entity → the flag value this mirror last pushed for it. */
    private readonly mirrored_ = new Map<Entity, boolean>();

    constructor(private readonly component_: AnyComponentDef) {}

    sync(world: SkeletalEnableWorld, target: SkeletalEnableTarget): void {
        let bound = 0;
        for (const entity of target.boundEntities()) {
            bound++;
            const data = world.tryGet(entity, this.component_) as { enabled?: boolean } | null;
            // No component (an entity bound by something other than a scene —
            // a test, a tool) has no flag to obey, so it is left alone.
            if (!data) continue;
            const enabled = data.enabled !== false;
            if (this.mirrored_.get(entity) === enabled) continue;
            this.mirrored_.set(entity, enabled);
            target.setEnabled(entity, enabled);
        }
        // Entities have unbound (a despawn, a scene reload) — drop their memos, or
        // a long editor session accumulates one entry per skeleton it ever showed.
        if (this.mirrored_.size > bound) this.prune_(target);
    }

    private prune_(target: SkeletalEnableTarget): void {
        const live = new Set(target.boundEntities());
        for (const entity of this.mirrored_.keys()) {
            if (!live.has(entity)) this.mirrored_.delete(entity);
        }
    }
}

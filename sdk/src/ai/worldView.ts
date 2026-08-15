// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    worldView.ts
 * @brief   What the systems that run AUTHORED graphs actually touch.
 *
 * An FSM system's reach is not a property of the system — it is the union of the
 * leaves the loaded graphs name. That is unknowable when the system is defined
 * and perfectly knowable once the data is there, which is why the schedule reads
 * these through a function rather than a literal.
 *
 * One unknown leaf makes the whole claim opaque, and that is the point: a union
 * that quietly drops the leaf it could not read would be a claim the scheduler
 * trusts and the frame disproves.
 */

import type { AiRegistry, AiTouches, AiActionInput } from './fsm/registry';
import type { SystemTouches } from '../ecs/system';

/** Accumulates leaf claims into one system-level claim. */
export class TouchesBuilder {
    private readonly reads = new Set<string>();
    private readonly writes = new Set<string>();
    private unknown = false;

    /** A leaf that declared. `undefined` is a leaf that did not — see `opaque`. */
    add(touches: AiTouches | undefined): this {
        if (!touches) {
            this.unknown = true;
            return this;
        }
        for (const name of touches.reads ?? []) this.reads.add(name);
        for (const name of touches.writes ?? []) this.writes.add(name);
        if (touches.opaque) this.unknown = true;
        return this;
    }

    /** Access the system has regardless of the data — the agent component itself. */
    reading(...names: string[]): this {
        for (const name of names) this.reads.add(name);
        return this;
    }

    writing(...names: string[]): this {
        for (const name of names) this.writes.add(name);
        return this;
    }

    build(): SystemTouches {
        return {
            reads: [...this.reads].sort(),
            writes: [...this.writes].sort(),
            ...(this.unknown ? { opaque: true } : {}),
        };
    }
}

/** An authored leaf reference: the registry name plus whatever input it carries. */
export interface LeafRef {
    kind: 'action' | 'condition';
    name: string;
    input?: AiActionInput;
}

/** Fold every leaf of every loaded graph into one claim. */
export function touchesOfLeaves<Ctx>(
    registry: AiRegistry<Ctx>,
    leaves: Iterable<LeafRef>,
    builder = new TouchesBuilder(),
): TouchesBuilder {
    for (const leaf of leaves) {
        // A name nothing registered runs as a no-op, so it reaches for nothing —
        // counting it as unknown would make every graph with a typo opaque.
        if (leaf.kind === 'action') {
            if (!registry.hasAction(leaf.name)) continue;
            builder.add(registry.actionTouches(leaf.name, leaf.input));
        } else {
            if (!registry.hasCondition(leaf.name)) continue;
            builder.add(registry.conditionTouches(leaf.name));
        }
    }
    return builder;
}

/**
 * @file    schedule.ts
 * @brief   System scheduling phases for the ECS framework
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

// =============================================================================
// Schedule Phases
// =============================================================================

export enum Schedule {
    Startup = 0,

    First = 1,
    PreUpdate = 2,
    Update = 3,
    PostUpdate = 4,
    Last = 5,

    FixedPreUpdate = 10,
    FixedUpdate = 11,
    FixedPostUpdate = 12,
}

// =============================================================================
// System Set
// =============================================================================

export interface SystemSet {
    readonly _id: symbol;
    readonly _name: string;
}

let systemSetCounter = 0;

export function defineSystemSet(name: string): SystemSet {
    return {
        _id: Symbol(`SystemSet_${++systemSetCounter}_${name}`),
        _name: name
    };
}

// =============================================================================
// System Ordering
// =============================================================================

export interface SystemOrdering {
    before?: SystemSet;
    after?: SystemSet;
    inSet?: SystemSet;
}

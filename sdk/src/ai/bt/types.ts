// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    types.ts
 * @brief   Behavior-tree data model — the serializable shape of a `.esbt`.
 *
 * A tree is pure data; leaf `name`s resolve to real logic through the shared
 * AiRegistry at runtime (the same registry FSM actions/conditions use), so the
 * data embeds no code — matching `.esfsm` and the input maps.
 */

export type BtNodeType =
    // composites (many children)
    | 'sequence' | 'selector' | 'parallel'
    // decorators (one child)
    | 'inverter' | 'succeeder' | 'repeater' | 'wait'
    // leaves
    | 'action' | 'condition';

export interface BtNode {
    type: BtNodeType;
    /** Editor-only stable id for selection/addressing; ignored by the interpreter. */
    id?: string;
    /** Registry name for a leaf (`action`/`condition`). */
    name?: string;
    /** Children: many for a composite, one for a decorator. */
    children?: BtNode[];
    /** `repeater`: iterations before Success; 0 = forever. */
    count?: number;
    /** `parallel`: succeed when `one` child succeeds, or when `all` do (default). */
    policy?: 'all' | 'one';
    /** `wait`: seconds to run before Success. */
    seconds?: number;
    /** Editor-only canvas position; ignored by the interpreter. */
    x?: number;
    y?: number;
}

export interface BtDefinition {
    root: BtNode;
    /**
     * Editor-only unconnected nodes/subtrees (created but not yet wired under
     * root). The interpreter ignores them — only `root` is ticked.
     */
    orphans?: BtNode[];
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    The seam that makes a skeletal component's `enabled` field mean
 *          something: skeletons live in a side module's table, not in the render
 *          walk, so the flag has to be carried across. What matters here is that
 *          it is carried on the field's EDGES — a mirror that pushed every frame
 *          would silently undo the imperative `setEnabled` API next tick.
 */
import { describe, it, expect } from 'vitest';
import { SkeletalEnableMirror } from '../src/skeletal/enableSync';
import { SpineAnimation } from '../src/ecs/component';
import type { AnyComponentDef } from '../src/ecs/component';
import type { Entity } from '../src/types';

/** A World that holds one component's data per entity, and nothing else. */
function fakeWorld(data: Map<number, { enabled?: boolean } | null>) {
    return {
        tryGet<C extends AnyComponentDef>(entity: Entity, _c: C) {
            return (data.get(entity as number) ?? null) as never;
        },
    };
}

/** A manager that records every setEnabled it is told. */
function fakeManager(entities: number[]) {
    const bound = new Set(entities);
    const pushed: Array<[number, boolean]> = [];
    return {
        bound,
        pushed,
        boundEntities: () => bound as unknown as Iterable<Entity>,
        setEnabled: (e: Entity, on: boolean) => { pushed.push([e as number, on]); },
    };
}

describe('SkeletalEnableMirror', () => {
    it('pushes the field on the first sync an entity appears in', () => {
        const m = new SkeletalEnableMirror(SpineAnimation);
        const mgr = fakeManager([1, 2]);
        m.sync(fakeWorld(new Map([[1, { enabled: false }], [2, { enabled: true }]])), mgr);
        expect(mgr.pushed).toEqual([[1, false], [2, true]]);
    });

    it('treats a missing flag as enabled, and skips entities with no component', () => {
        const m = new SkeletalEnableMirror(SpineAnimation);
        const mgr = fakeManager([1, 2]);
        m.sync(fakeWorld(new Map([[1, {}], [2, null]])), mgr);
        expect(mgr.pushed).toEqual([[1, true]]);
    });

    it('pushes nothing while the field holds still', () => {
        const m = new SkeletalEnableMirror(SpineAnimation);
        const mgr = fakeManager([1]);
        const world = fakeWorld(new Map([[1, { enabled: true }]]));
        m.sync(world, mgr);
        m.sync(world, mgr);
        m.sync(world, mgr);
        expect(mgr.pushed).toEqual([[1, true]]);
    });

    it('pushes on every edge the field moves through', () => {
        const m = new SkeletalEnableMirror(SpineAnimation);
        const mgr = fakeManager([1]);
        const data = new Map<number, { enabled?: boolean }>([[1, { enabled: true }]]);
        const world = fakeWorld(data);
        m.sync(world, mgr);
        data.set(1, { enabled: false }); // the editor's eye / an inspector write
        m.sync(world, mgr);
        data.set(1, { enabled: true });
        m.sync(world, mgr);
        expect(mgr.pushed).toEqual([[1, true], [1, false], [1, true]]);
    });

    it('leaves an imperative setEnabled standing — the whole point of edge-triggering', () => {
        const m = new SkeletalEnableMirror(SpineAnimation);
        const mgr = fakeManager([1]);
        const world = fakeWorld(new Map([[1, { enabled: true }]]));
        m.sync(world, mgr);
        mgr.pushed.length = 0;
        // Gameplay calls Spine.setEnabled(e, false); the component still says true.
        // A per-frame mirror would flip it back on the next tick.
        m.sync(world, mgr);
        m.sync(world, mgr);
        expect(mgr.pushed).toEqual([]);
    });

    it('forgets an entity that unbound, so a rebound one is pushed again', () => {
        const m = new SkeletalEnableMirror(SpineAnimation);
        const mgr = fakeManager([1]);
        const world = fakeWorld(new Map([[1, { enabled: false }]]));
        m.sync(world, mgr);
        mgr.bound.delete(1);
        m.sync(world, mgr); // prunes the memo
        mgr.bound.add(1);
        mgr.pushed.length = 0;
        m.sync(world, mgr);
        expect(mgr.pushed).toEqual([[1, false]]);
    });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A live entity can name the document row it was loaded from.
 *
 * The editor's tree and the running world's are the same tree only if this
 * mapping exists. It hangs off the App on purpose: an editor runs its own world
 * beside the game's, and a module-scoped table is one bundle chunk away from
 * being two tables that never meet.
 */
import { describe, expect, it } from 'vitest';
import type { Entity } from '../src';
import {
    SceneOrigins,
    enableSceneOrigins,
    sceneOriginsEnabled,
    recordSceneOrigins,
    sceneOriginOf,
} from '../src/scene/sceneOrigins';

type App = Parameters<typeof enableSceneOrigins>[0];

/** The four members the origins table asks of an App. */
function fakeApp(alive: Set<number>): App {
    const resources = new Map<symbol, unknown>();
    return {
        world: { valid: (e: Entity) => alive.has(e as unknown as number) },
        hasResource: (def: { _id: symbol }) => resources.has(def._id),
        getResource: (def: { _id: symbol }) => resources.get(def._id),
        insertResource: (def: { _id: symbol }, v: unknown) => resources.set(def._id, v),
    } as unknown as App;
}

const ent = (n: number): Entity => n as unknown as Entity;

describe('scene origins', () => {
    it('records nothing until an App asks for it', () => {
        const app = fakeApp(new Set([10]));
        recordSceneOrigins(app, new Map([[1, ent(10)]]));
        expect(sceneOriginOf(app, ent(10))).toBeUndefined();
        expect(sceneOriginsEnabled(app)).toBe(false);
    });

    it('maps a live entity back to its document id once enabled', () => {
        const app = fakeApp(new Set([10, 11]));
        enableSceneOrigins(app);
        recordSceneOrigins(app, new Map([[1, ent(10)], [7, ent(11)]]));
        expect(sceneOriginOf(app, ent(10))).toBe(1);
        expect(sceneOriginOf(app, ent(11))).toBe(7);
    });

    it('has no answer for an entity the game spawned', () => {
        const app = fakeApp(new Set([10, 99]));
        enableSceneOrigins(app);
        recordSceneOrigins(app, new Map([[1, ent(10)]]));
        expect(sceneOriginOf(app, ent(99))).toBeUndefined();
    });

    it('drops dead rows on the next load rather than growing per restart', () => {
        const alive = new Set([10]);
        const app = fakeApp(alive);
        enableSceneOrigins(app);
        recordSceneOrigins(app, new Map([[1, ent(10)]]));

        alive.delete(10); // the scene unloaded; its entities are gone
        alive.add(20);
        recordSceneOrigins(app, new Map([[1, ent(20)]]));

        expect(sceneOriginOf(app, ent(20))).toBe(1);
        expect(sceneOriginOf(app, ent(10))).toBeUndefined();
    });

    it('keeps two Apps apart', () => {
        const a = fakeApp(new Set([10]));
        const b = fakeApp(new Set([10]));
        enableSceneOrigins(a);
        enableSceneOrigins(b);
        recordSceneOrigins(a, new Map([[3, ent(10)]]));
        expect(sceneOriginOf(a, ent(10))).toBe(3);
        expect(sceneOriginOf(b, ent(10))).toBeUndefined();
    });

    it('enabling twice keeps what is already recorded', () => {
        const app = fakeApp(new Set([10]));
        enableSceneOrigins(app);
        recordSceneOrigins(app, new Map([[5, ent(10)]]));
        enableSceneOrigins(app);
        expect(sceneOriginOf(app, ent(10))).toBe(5);
        expect(app.getResource(SceneOrigins).size).toBe(1);
    });
});

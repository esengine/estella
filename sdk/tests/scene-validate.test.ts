// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * A scene is validated by the same pass a prefab is, and the loader refuses what
 * it cannot honour. Each test pins one code, so they stay stable for readers.
 */
import { describe, it, expect, vi } from 'vitest';
import type { SceneData, DocumentDiagnostic } from '../src/index';
import { validateScene, SCENE_FORMAT_VERSION, loadSceneData, resetWorldTo } from '../src/index';
import { World } from '../src/ecs/world';
import { defineComponent } from '../src/ecs/component';

function clean(): SceneData {
    return {
        version: SCENE_FORMAT_VERSION,
        name: 'Main',
        entities: [
            { id: 1, name: 'Player', parent: null, children: [2], components: [{ type: 'Transform', data: {} }] },
            { id: 2, name: 'Sword', parent: 1, children: [], components: [] },
        ],
    };
}

const codes = (d: DocumentDiagnostic[]): string[] => d.map((x) => x.code);

describe('validateScene', () => {
    it.each([
        [null, 'malformed-entity', /entities\[0\]/],
        [{ id: 1, components: [null] }, 'malformed-component', /components\[0\]/],
        [{ id: 1, children: [{ toString: null }], components: [] }, 'malformed-entity', /children/],
        [{ id: 1, prefab: 'assets/widget.esprefab' }, 'malformed-entity', /overrides/],
        [{ id: 1, prefab: 'assets/widget.esprefab', overrides: [], added: [null], removed: [] }, 'malformed-entity', /added\[0\]/],
    ] as const)('reports a malformed scene record (%j) before replacing a world', (entry, code, message) => {
        const scene = { ...clean(), entities: [entry] } as unknown as SceneData;
        expect(validateScene(scene)).toEqual([expect.objectContaining({ code, severity: 'error', message: expect.stringMatching(message) })]);
        const world = new World();
        const entity = world.spawn();
        expect(() => resetWorldTo(world, scene)).toThrow(message);
        expect(world.getAllEntities()).toEqual([entity]);
    });

    it('returns no diagnostics for a well-formed scene', () => {
        expect(validateScene(clean())).toEqual([]);
    });

    it('flags a duplicate id', () => {
        const s = clean();
        s.entities.push({ id: 1, name: 'Impostor', parent: null, children: [], components: [] });
        expect(codes(validateScene(s))).toContain('duplicate-id');
    });

    it('flags an entity carrying the same component twice', () => {
        const s = clean();
        s.entities[0].components.push({ type: 'Transform', data: {} });
        expect(codes(validateScene(s))).toContain('duplicate-component');
    });

    it('reports repeated component types separately for each entity in document order', () => {
        const s = clean();
        s.entities[0].components.push({ type: 'Sprite', data: {} }, { type: 'Transform', data: {} },
            { type: 'MeshRenderer', data: {} }, { type: 'Transform', data: {} });
        s.entities[1].components.push({ type: 'Transform', data: {} }, { type: 'Sprite', data: {} },
            { type: 'Sprite', data: {} });
        expect(validateScene(s).map(d => [d.code, d.entityId, d.field])).toEqual([
            ['duplicate-component', 1, 'Transform'],
            ['duplicate-component', 1, 'Transform'],
            ['duplicate-component', 2, 'Sprite'],
        ]);
    });

    it('flags a parent that does not exist', () => {
        const s = clean();
        s.entities[1].parent = 99;
        expect(codes(validateScene(s))).toContain('missing-parent');
    });

    it('flags parent and children disagreeing', () => {
        const s = clean();
        s.entities[0].children = [];
        expect(codes(validateScene(s))).toContain('inconsistent-topology');
    });

    it('flags a parent cycle', () => {
        const s = clean();
        s.entities[0].parent = 2;
        s.entities[1].children = [1];
        s.entities[1].children.push(3);
        s.entities.unshift({ id: 3, name: 'Branch', parent: 2, children: [], components: [] });
        expect(validateScene(s)).toEqual([{
            code: 'parent-cycle', severity: 'error', entityId: 2, message: 'parent cycle detected: 2 → 1 → 2',
        }]);
    });

    it('accepts a forest — a scene has no single root', () => {
        const s = clean();
        s.entities.push({ id: 3, name: 'Camera', parent: null, children: [], components: [] });
        expect(validateScene(s)).toEqual([]);
    });

    it('warns, not errors, on a reference to an entity that is gone', () => {
        defineComponent('Follower', { target: 0 }, { entityFields: ['target'] });
        const s = clean();
        s.entities[1].components.push({ type: 'Follower', data: { target: 42 } });
        const found = validateScene(s).filter((d) => d.code === 'dangling-entity-ref');
        expect(found).toHaveLength(1);
        expect(found[0].severity).toBe('warning');
    });

    it('reads 0 as "no reference" rather than a dangling one', () => {
        defineComponent('Watcher', { target: 0 }, { entityFields: ['target'] });
        const s = clean();
        s.entities[1].components.push({ type: 'Watcher', data: { target: 0 } });
        expect(validateScene(s)).toEqual([]);
    });
});

describe('loadSceneData refuses what it cannot honour', () => {
    it('refuses a duplicate id rather than keeping whichever came last', () => {
        const world = new World();
        const s = clean();
        s.entities.push({ id: 1, name: 'Impostor', parent: null, children: [], components: [] });
        expect(() => loadSceneData(world, s)).toThrow(/duplicate-id/);
    });

    it('refuses a parent cycle', () => {
        const world = new World();
        const s = clean();
        s.entities[0].parent = 2;
        s.entities[1].children = [1];
        expect(() => loadSceneData(world, s)).toThrow(/parent-cycle/);
    });

    it('loads a scene whose findings are only warnings', () => {
        defineComponent('Chaser', { target: 0 }, { entityFields: ['target'] });
        const world = new World();
        const s = clean();
        s.entities[1].components.push({ type: 'Chaser', data: { target: 77 } });
        expect(loadSceneData(world, s).size).toBe(2);
    });

    it('rolls back a load when the world rejects a parent link', () => {
        const world = new World();
        const prior = world.spawn();
        vi.spyOn(world, 'trySetParent').mockReturnValueOnce(false);
        expect(() => loadSceneData(world, clean())).toThrow(/Sword.*Player/);
        expect(world.getAllEntities()).toEqual([prior]);
    });

    it('rolls back if an entity is removed at the last load phase', () => {
        const world = new World();
        const prior = world.spawn();
        expect(() => loadSceneData(world, clean(), undefined, phase => {
            if (phase === 'spawn.hierarchy') world.despawn(world.getAllEntities().at(-1)!);
        })).toThrow(/removed during scene load/);
        expect(world.getAllEntities()).toEqual([prior]);
    });

    it.each(['duplicate', 'cycle', 'future'] as const)('preserves the current world when a replacement has a %s', (problem) => {
        const world = new World();
        const entity = world.spawn();
        const State = defineComponent('ReplacementTestState', { value: 0 });
        world.insert(entity, State, { value: 17 });
        const replacement = clean();
        if (problem === 'duplicate') replacement.entities.push(replacement.entities[0]!);
        if (problem === 'cycle') replacement.entities[0]!.parent = 2;
        if (problem === 'future') replacement.version = SCENE_FORMAT_VERSION + 1;
        expect(() => resetWorldTo(world, replacement)).toThrow();
        expect(world.getAllEntities()).toEqual([entity]);
        expect(world.get(entity, State).value).toBe(17);
    });
});

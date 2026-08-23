// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    component-rename-upgrade.test.ts
 * @brief   A file written under a component's old name loads under its new one.
 *
 *          A component's name is the key its data is stored under, so renaming
 *          one is a change to every file that holds it. A scene and a prefab go
 *          through the same door, and both are checked here: an upgrade that ran
 *          on only one of the two leaves the other naming a component the engine
 *          no longer has, which loads as a scene with no lights in it.
 */
import { describe, it, expect } from 'vitest';
import { migrateSceneData, SCENE_FORMAT_VERSION, type SceneData } from '../src/scene/scene';
import { migratePrefabData } from '../src/prefab/migrate';
import { needsComponentUpgrade, RENAMED_COMPONENT_TYPES } from '../src/scene/legacyComponents';

const sceneWith = (components: { type: string; data: Record<string, unknown> }[]): SceneData =>
    ({
        version: 1,
        name: 'test',
        entities: [{ id: 0, name: 'Entity', parent: null, children: [], components }],
    } as unknown as SceneData);

const componentsOf = (scene: SceneData) => scene.entities[0]!.components;

describe('a component renamed by an engine upgrade', () => {
    it('arrives under its new name with its data intact', () => {
        const { data, migrated } = migrateSceneData(sceneWith([
            { type: 'Light2D', data: { type: 2, intensity: 0.7 } },
            { type: 'Mesh2D', data: { lit: true, layer: 3 } },
        ]));
        expect(migrated).toBe(true);
        const types = componentsOf(data).map((c) => c.type);
        expect(types).toEqual(['Light', 'MeshRenderer']);
        // The rename must not be a drop-and-recreate: what the file said is what
        // the component holds.
        expect(componentsOf(data)[0]!.data).toEqual({ type: 2, intensity: 0.7 });
        expect(componentsOf(data)[1]!.data).toEqual({ lit: true, layer: 3 });
    });

    it('is idempotent — a file already using the new name is left alone', () => {
        const { migrated } = migrateSceneData(sceneWith([
            { type: 'Light', data: { type: 2 } },
            { type: 'MeshRenderer', data: { lit: true } },
        ]));
        expect(migrated).toBe(false);
    });

    it('is answered by needsComponentUpgrade, which callers ask before copying', () => {
        for (const [before, after] of RENAMED_COMPONENT_TYPES) {
            expect(needsComponentUpgrade({ components: [{ type: before, data: {} }] })).toBe(true);
            expect(needsComponentUpgrade({ components: [{ type: after, data: {} }] })).toBe(false);
        }
    });

    it('upgrades a prefab through the same door', () => {
        const { data, migrated } = migratePrefabData({
            version: '2',
            rootEntityId: 'root',
            entities: [{
                prefabEntityId: 'root',
                name: 'Lamp',
                parent: null,
                children: [],
                visible: true,
                components: [{ type: 'Light2D', data: { intensity: 2 } }],
            }],
        });
        expect(migrated).toBe(true);
        expect(data.entities[0]!.components[0]!.type).toBe('Light');
        expect(data.entities[0]!.components[0]!.data['intensity']).toBe(2);
    });

    it('stamps the format version that tells an older engine to refuse the file', () => {
        const { data } = migrateSceneData(sceneWith([{ type: 'Light2D', data: {} }]));
        expect(data.version).toBe(SCENE_FORMAT_VERSION);
        expect(() => migrateSceneData({ ...data, version: SCENE_FORMAT_VERSION + 1 } as SceneData))
            .toThrow(/newer than this engine supports/);
    });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A target that cannot ship a cut world refuses the build.
 *
 * The shape this refuses is the one the whole feature exists against: a build
 * that succeeds while the thing it declared quietly does not ship. The cut
 * itself is the runtime's, and pinned in sdk/tests/partition-world.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OFFICIAL_PACKAGES } from './officialPackagesDir';

const SIZE = 1000;

describe('targets that cannot ship a cut world', () => {
    it.each([
        ['plain', 'StreamedWorld', false],
        ['escaped', String.raw`\u0053treamedWorld`, false],
        ['prefab instance override', 'StreamedWorld', true],
        ['inherited prefab root', 'StreamedWorld', true],
    ] as const)('refuses a streamed world declared by a %s component', async (kind, componentName, instance) => {
        const { exportGame } = await import('../src/export/exportGame');
        const project = await mkdtemp(path.join(tmpdir(), 'streamed-'));
        try {
            await mkdir(path.join(project, 'assets', 'scenes'), { recursive: true });
            const declaration = { type: 'StreamedWorld', data: { cellSize: SIZE } };
            const inherited = kind === 'inherited prefab root';
            if (inherited) await writeFile(path.join(project, 'assets', 'Settings.esprefab'), JSON.stringify({
                name: 'Settings', rootEntityId: 'r', entities: [{ prefabEntityId: 'r', components: [declaration] }],
            }));
            await writeFile(path.join(project, 'assets', 'scenes', 'main.esscene'),
                JSON.stringify({
                    version: 4, name: 'main',
                    entities: [
                        instance
                            ? { id: 0, prefab: 'assets/Settings.esprefab', parent: null, added: [], removed: [],
                                overrides: inherited ? [] : [{ prefabEntityId: 'r', type: 'component_added', componentData: declaration }] }
                            : { id: 0, name: 'World', parent: null, children: [], visible: true, components: [declaration] },
                        { id: 1, name: 'RockA', parent: null, children: [], visible: true,
                          components: [{ type: 'Transform', data: { position: { x: 500, y: 0, z: 500 } } }] },
                    ],
                }).replace('"StreamedWorld"', '"' + componentName + '"'));
            await writeFile(path.join(project, 'project.esproject'), JSON.stringify({
                formatVersion: '1', name: 'Streamed', defaultScene: 'assets/scenes/main.esscene',
            }));
            await expect(exportGame({
                root: project,
                entryScene: 'assets/scenes/main.esscene',
                outDir: path.join(project, 'out'),
                platform: 'playable',
                hostsDir: path.join(project, 'hosts'), packagesDir: OFFICIAL_PACKAGES,
                // Never reached: the refusal happens before anything is staged.
                sdkDistDir: path.join(project, 'sdk'),
                wasmDir: path.join(project, 'wasm'),
            })).rejects.toThrow(/cannot ship one/);
        } finally {
            await rm(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
        }
    });
});

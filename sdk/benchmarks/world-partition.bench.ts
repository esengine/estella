// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { bench, describe } from 'vitest';
import { StreamPlane } from '../src/residency/components';
import { partitionWorld } from '../src/residency/partitionWorld';
import type { SceneData } from '../src/scene/scene';

for (const plane of [StreamPlane.Screen, StreamPlane.Ground]) {
    describe(plane === StreamPlane.Screen ? '2D world partition' : '3D world partition', () => {
        const size = 64;
        const roots = size * size * 2;
        const cellSize = 256;
        const entities: unknown[] = [{ id: 1, parent: null, components: [{ type: 'StreamedWorld', data: { cellSize, plane } }] }];
        for (let index = 0; index < roots; index++) {
            const id = index * 4 + 2;
            const x = index % size * cellSize + 16;
            const second = Math.floor(index / size) % size * cellSize + 16;
            const position = plane === StreamPlane.Screen ? { x, y: second, z: 0 } : { x, y: 0, z: second };
            entities.push({ id, parent: null, components: [{ type: 'Transform', data: { position } }] });
            for (let child = 1; child <= 3; child++) {
                entities.push({ id: id + child, parent: id, components: [
                    { type: 'Transform', data: { position: { x: -child * 16, y: child, z: child } } },
                    { type: 'Follow', data: { target: 1 } },
                ] });
            }
        }
        const scene = { version: 4, name: 'main', entities } as SceneData;
        const fields = ['target'];
        const options = { entityFieldsOf: (type: string) => type === 'Follow' ? fields : [] };
        const result = partitionWorld(scene, 'main', options);
        if (result?.errors.length !== 0 || result.cells.length !== size * size || result.persistentRefs[0] !== 1
            || result.cells.some(cell => cell.rootCount !== 2 || cell.entityCount !== 8)) {
            throw new Error('Unexpected partition fixture');
        }
        bench('cut 32,769 authored entries', () => { partitionWorld(scene, 'main', options); }, { time: 1500, warmupTime: 600 });
    });
}

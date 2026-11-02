// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A Cocos scene's ambient light becomes an Ambient light entity, so a lit mesh has what it is lit by.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importCocosProject } from '../src/import/cocos';

const scene = [
    { __type__: 'cc.SceneAsset', _name: 'main', scene: { __id__: 1 } },
    { __type__: 'cc.Scene', _name: 'main', _children: [], _globals: { __id__: 2 } },
    { __type__: 'cc.SceneGlobals', ambient: { __id__: 3 }, shadows: { __id__: 4 }, _skybox: { __id__: 5 }, fog: { __id__: 6 } },
    { __type__: 'cc.AmbientInfo', _skyColorLDR: { __type__: 'cc.Vec4', x: 0.5, y: 0.75, z: 1, w: 0.8 }, _skyIllumLDR: 0.8 },
    { __type__: 'cc.ShadowsInfo', _enabled: true },
    { __type__: 'cc.SkyboxInfo', _enabled: false },
    { __type__: 'cc.FogInfo', _enabled: true, _type: 0, _fogStart: 20, _fogEnd: 200, _fogColor: { __type__: 'cc.Color', r: 51, g: 102, b: 255, a: 255 } },
];

describe('a Cocos scene with an ambient light', () => {
    let root: string;
    let doc: { entities: Array<{ name: string; components: Array<{ type: string; data: Record<string, any> }> }> };
    let report: Awaited<ReturnType<typeof importCocosProject>>;

    beforeAll(async () => {
        root = mkdtempSync(path.join(tmpdir(), 'cocos-ambient-'));
        const dir = path.join(root, 'creator', 'assets');
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'main.scene'), JSON.stringify(scene));
        writeFileSync(path.join(dir, 'main.scene.meta'), JSON.stringify({ ver: '1', importer: 'scene', uuid: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', subMetas: {}, userData: {} }));
        report = await importCocosProject({ source: path.join(root, 'creator'), out: path.join(root, 'out') });
        doc = JSON.parse(readFileSync(path.join(root, 'out', 'assets', 'cocos', 'main.esscene'), 'utf8'));
    });
    afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

    it('is an ambient Light with the sky colour and the illumination', () => {
        const ambient = doc.entities.find((e) => e.name === 'Ambient');
        const light = ambient?.components.find((c) => c.type === 'Light');
        expect(light?.data).toMatchObject({ type: 2, intensity: 0.8, color: { r: 0.5, g: 0.75, b: 1 } });
    });

    it('is a global distance fog volume when the scene turns a linear fog on', () => {
        const volume = doc.entities.find((e) => e.name === 'Fog')?.components.find((c) => c.type === 'PostProcessVolume');
        expect(volume?.data).toMatchObject({ isGlobal: true });
        expect(volume?.data.effects[0]).toMatchObject({
            type: 'distanceFog', enabled: true,
            uniforms: { u_fogNear: 20, u_fogFar: 200 },
            colors: { u_fogColor: { r: 0.2, g: 0.4, b: 1, a: 1 } },
        });
    });

    it('says only what of the scene settings that are on it did not carry', () => {
        const said = report.notes['scene-globals-dropped']?.examples.join(' ') ?? '';
        expect(said).toContain('shadows');
        expect(said).not.toContain('ambient');
        expect(said).not.toContain('fog');
        expect(said).not.toContain('skybox');
    });
});

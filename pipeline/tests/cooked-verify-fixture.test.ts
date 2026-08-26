// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Produces the cooked build that headless-cooked-verify.mjs renders — a
 *        content-addressed web export of a green-KTX2 sprite scene, built with the
 *        real SDK dist + engine/basis wasm. Guarded by ESTELLA_COOK_FIXTURE so it's
 *        not part of the normal unit suite; the verify:render:cooked script sets it.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportGame } from '../src/export/exportGame';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..', '.cooked-verify');
const SRC = path.resolve(HERE, '..', '.cooked-src');
const TEX = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MAT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SHD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const meta = (uuid: string, type: string) => JSON.stringify({ uuid, version: '2.0', type, importer: {} });

// A user material chain referenced entirely by PATH: the scene names the
// material by project path, the material names its shader + a texture RELATIVE
// to itself — the forms real content uses. The shader paints solid red via a
// reflected param, so the cooked render proves the whole logical→staged
// resolution (dep-graph inclusion, cook ref rewrite, runtime pathMap+catalog).
const TINT_SHADER = `#pragma shader "CookTint"
#pragma version 300 es
#pragma domain Unlit2D
#pragma param u_tint color default(1,1,1,1)
#pragma param u_tex texture default(white)

#pragma fragment
precision mediump float;
in vec4 v_color;
in vec2 v_texCoord;
out vec4 fragColor;
void main() { fragColor = u_tint; }
#pragma end
`;

/**
 * The project's own code: one component, one system, and the promise that the
 * system compiles. `Transform` is an ENGINE component, so the compiled code
 * reads it at the offsets EHT generated, in the memory the engine already owns.
 */
const PROJECT_SCRIPTS = `import {
    addSystem, defineComponent, defineSystem, Query, Mut, Res, Time, Transform,
} from 'esengine';

export const Drifter = defineComponent('Drifter', { speed: 0 });

/**
 * @compiled
 * A promise, not a hint: what the subset cannot lower fails the export here
 * rather than falling back to the interpreter with nothing to see.
 */
export const driftSystem = defineSystem(
    [Query(Mut(Transform), Drifter), Res(Time)],
    (query, time) => {
        for (const [, transform, drifter] of query) {
            transform.position.x += drifter.speed * time.delta;
        }
    },
    { name: 'CookedDrift' },
);

addSystem(driftSystem);
`;

describe.skipIf(!process.env.ESTELLA_COOK_FIXTURE)('cooked-verify fixture', () => {
  it('cooks a content-addressed build: green KTX2 sprite + path-ref material chain', async () => {
    rmSync(SRC, { recursive: true, force: true });
    rmSync(OUT, { recursive: true, force: true });

    mkdirSync(path.join(SRC, 'assets'), { recursive: true });
    copyFileSync(path.resolve(HERE, '..', '..', 'fixtures', 'scenes', 'ktx2-test', 'green.ktx2'),
      path.join(SRC, 'assets', 'green.ktx2'));
    writeFileSync(path.join(SRC, 'assets', 'green.ktx2.meta'), meta(TEX, 'texture'));
    writeFileSync(path.join(SRC, 'assets', 'tint.esshader'), TINT_SHADER);
    writeFileSync(path.join(SRC, 'assets', 'tint.esshader.meta'), meta(SHD, 'shader'));
    writeFileSync(path.join(SRC, 'assets', 'red.esmaterial'), JSON.stringify({
      version: '1.0', type: 'material', shader: 'tint.esshader',
      properties: { u_tint: { r: 1, g: 0, b: 0, a: 1 }, u_tex: 'green.ktx2' },
    }));
    writeFileSync(path.join(SRC, 'assets', 'red.esmaterial.meta'), meta(MAT, 'material'));

    mkdirSync(path.join(SRC, 'scenes'), { recursive: true });
    writeFileSync(path.join(SRC, 'scenes', 'main.esscene'), JSON.stringify({
      version: '1.0', name: 'Main', entities: [
        { id: 0, name: 'Camera', parent: null, children: [], visible: true, components: [
          { type: 'Transform', data: { position: { x: 0, y: 0, z: 10 } } },
          { type: 'Camera', data: { projectionType: 1, orthoSize: 300, isActive: true, priority: 0 } },
        ] },
        { id: 1, name: 'GreenQuad', parent: null, children: [], visible: true, components: [
          { type: 'Transform', data: { position: { x: -150, y: 0, z: 0 } } },
          { type: 'Sprite', data: { size: { x: 250, y: 250 }, color: { r: 1, g: 1, b: 1, a: 1 }, texture: `@uuid:${TEX}` } },
        ] },
        { id: 2, name: 'RedMaterialQuad', parent: null, children: [], visible: true, components: [
          { type: 'Transform', data: { position: { x: 150, y: 0, z: 0 } } },
          { type: 'Sprite', data: { size: { x: 250, y: 250 }, color: { r: 1, g: 1, b: 1, a: 1 }, material: 'assets/red.esmaterial' } },
        ] },
        // Nothing draws this one. It exists so the compiled system has a real
        // engine component to move, and the driver a number to read.
        { id: 3, name: 'Drifter', parent: null, children: [], visible: true, components: [
          { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } },
          { type: 'Drifter', data: { speed: 100 } },
        ] },
      ],
    }));
    writeFileSync(path.join(SRC, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));

    mkdirSync(path.join(SRC, 'src'), { recursive: true });
    // A `@compiled` system, so this build also proves the AOT road end to end
    // (docs/REARCH_AOT.md §9). What it moves carries no Sprite, so the pixel
    // claims below keep sampling the same two quads.
    writeFileSync(path.join(SRC, 'src', 'main.ts'), PROJECT_SCRIPTS);

    const res = await exportGame({
      root: SRC,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: path.resolve(HERE, '..', '..', 'pipeline', 'src', 'runtime', 'gameHost.ts'),
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.resolve(HERE, '..', '..', 'sdk', 'dist'),
      wasmDir: path.resolve(HERE, '..', '..', 'build', 'wasm', 'web'),
      outDir: OUT,
      title: 'Cooked Verify',
      contentAddressed: true,
    });
    expect(res.ok, res.errors.join('; ')).toBe(true);
  }, 120_000);
});

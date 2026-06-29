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
import { exportGame } from '../electron/exportGame';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..', '.cooked-verify');
const SRC = path.resolve(HERE, '..', '.cooked-src');
const TEX = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const meta = (uuid: string, type: string) => JSON.stringify({ uuid, version: '2.0', type, importer: {} });

describe.skipIf(!process.env.ESTELLA_COOK_FIXTURE)('cooked-verify fixture', () => {
  it('cooks a content-addressed build of a green KTX2 sprite', async () => {
    rmSync(SRC, { recursive: true, force: true });
    rmSync(OUT, { recursive: true, force: true });

    mkdirSync(path.join(SRC, 'assets'), { recursive: true });
    copyFileSync(path.resolve(HERE, '..', 'public', 'scenes', 'ktx2-test', 'green.ktx2'),
      path.join(SRC, 'assets', 'green.ktx2'));
    writeFileSync(path.join(SRC, 'assets', 'green.ktx2.meta'), meta(TEX, 'texture'));

    mkdirSync(path.join(SRC, 'scenes'), { recursive: true });
    writeFileSync(path.join(SRC, 'scenes', 'main.esscene'), JSON.stringify({
      version: '1.0', name: 'Main', entities: [
        { id: 0, name: 'Camera', parent: null, children: [], visible: true, components: [
          { type: 'Transform', data: { position: { x: 0, y: 0, z: 10 } } },
          { type: 'Camera', data: { projectionType: 1, orthoSize: 300, isActive: true, priority: 0 } },
        ] },
        { id: 1, name: 'Quad', parent: null, children: [], visible: true, components: [
          { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } },
          { type: 'Sprite', data: { size: { x: 200, y: 200 }, color: { r: 1, g: 1, b: 1, a: 1 }, texture: `@uuid:${TEX}` } },
        ] },
      ],
    }));
    writeFileSync(path.join(SRC, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));

    mkdirSync(path.join(SRC, 'src'), { recursive: true });
    writeFileSync(path.join(SRC, 'src', 'main.ts'), 'export {};\n');

    const res = await exportGame({
      root: SRC,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: path.resolve(HERE, '..', 'src', 'gameHost.ts'),
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

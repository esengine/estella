// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A Cocos script bundles against the engine: `cc` and `cc/env` become `esengine/cocos`, however the build resolves that, and
 *        the script's decorators come out in the legacy form the layer's `@ccclass` / `@property` take.
 */
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { cocosCompatPlugin } from '../src/bundle/cocosCompat';

const SCRIPT = `
import { _decorator, Component } from 'cc';
import { EDITOR } from 'cc/env';
const { ccclass, property } = _decorator;

@ccclass('Counter')
export class Counter extends Component {
    @property speed = 3;
    start() { if (EDITOR) return; this.speed++; }
}
`;

describe('bundling a Cocos script', () => {
    let root: string;
    beforeAll(() => {
        root = mkdtempSync(path.join(tmpdir(), 'cocos-compat-'));
        mkdirSync(path.join(root, 'scripts'));
        writeFileSync(path.join(root, 'scripts', 'Counter.ts'), SCRIPT);
        // A file that is not a Cocos script keeps its own rules: no `cc` import, so it is not touched.
        writeFileSync(path.join(root, 'scripts', 'Plain.ts'), 'export const answer: number = 42;\n');
        writeFileSync(path.join(root, 'layer.js'), 'export const _decorator = { ccclass: (n) => (c) => c, property: () => () => {} };\nexport class Component {}\nexport const EDITOR = false;\n');
    });
    afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

    const run = (extra: object) => build({
        entryPoints: [path.join(root, 'scripts', 'Counter.ts')],
        bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent',
        plugins: [cocosCompatPlugin()], ...extra,
    });

    it('leaves cc and cc/env as esengine/cocos when the build keeps esengine external', async () => {
        const out = (await run({ external: ['esengine', 'esengine/*'] })).outputFiles[0]!.text;
        expect(out).toMatch(/from "esengine\/cocos"/);
        expect(out).not.toMatch(/from "cc/);
    });

    it('inlines the layer when the build aliases it, for the builds that have no import map', async () => {
        const out = (await run({ alias: { 'esengine/cocos': path.join(root, 'layer.js') }, format: 'iife' })).outputFiles[0]!.text;
        expect(out).not.toMatch(/esengine\/cocos|from "cc/);
        expect(out).toMatch(/Component = class|class Component/);   // the layer's own text is in the bundle
    });

    it('lowers decorators in the legacy form with fields assigned, not defined', async () => {
        const out = (await run({ external: ['esengine/*'] })).outputFiles[0]!.text;
        expect(out).toMatch(/__decorateClass|__decorate\(/);
        expect(out).not.toMatch(/__esDecorate|__publicField/);
        expect(out).toMatch(/this\.speed = 3/);
    });

    it('says what it could not do, in the layer\'s terms, when the layer does not resolve', async () => {
        await expect(run({})).rejects.toMatchObject({ errors: expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('esengine/cocos') })]) });
    });

    it('does not touch a file that is not a Cocos script', async () => {
        const plain = await build({
            entryPoints: [path.join(root, 'scripts', 'Plain.ts')], bundle: true, write: false, format: 'esm', logLevel: 'silent', plugins: [cocosCompatPlugin()],
        });
        expect(plain.outputFiles[0]!.text).toContain('answer = 42');
    });

    // Against the SDK as built, when it has been: every name a script imports from `cc` must be a name the layer exports, or the
    // bundle fails with esbuild's "no matching export" at the script, not at a user's first run.
    const BUILT = path.resolve(__dirname, '../../sdk/dist/cocos/index.js');
    it.skipIf(!existsSync(BUILT))('bundles against the layer as built, for the names a script commonly imports', async () => {
        const names = ['_decorator', 'Component', 'Node', 'Vec2', 'Vec3', 'Quat', 'Color', 'Size', 'Rect', 'director', 'UITransform', 'Label',
            'Sprite', 'Button', 'Widget', 'Layout', 'EventTouch', 'NodeEventType', 'EventHandler', 'Prefab', 'SpriteFrame', 'v2', 'v3', 'find', 'isValid'];
        writeFileSync(path.join(root, 'scripts', 'Names.ts'), `import { ${names.join(', ')} } from 'cc';
import { EDITOR, DEBUG } from 'cc/env';
export default [${names.join(', ')}, EDITOR, DEBUG];
`);
        const result = await build({
            entryPoints: [path.join(root, 'scripts', 'Names.ts')], bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent',
            alias: { 'esengine/cocos': BUILT }, plugins: [cocosCompatPlugin()],
        });
        expect(result.errors).toEqual([]);
    });
});

describe('a const the script assigns to again', () => {
    it('is read as let, and only that one', async () => {
        const { letTheReassignedConsts } = await import('../src/bundle/cocosCompat');
        const fixed = letTheReassignedConsts('const a = null;\nconst b = 1;\nif (x) {\n    a = 2;\n}\nconst c: number = 3;\n  c += 1;\nuse(b == 1, a);');
        expect(fixed).toContain('let a = null');
        expect(fixed).toContain('const b = 1');
        expect(fixed).toContain('let c: number = 3');
    });
    it('leaves a source with no reassignment as it is', async () => {
        const { letTheReassignedConsts } = await import('../src/bundle/cocosCompat');
        const src = 'const a = 1;\nconst f = () => a === 2 ? a : 3;\nconst o = { a: 1 };\no.a = 2;\n';
        expect(letTheReassignedConsts(src)).toBe(src);
    });
});

describe('named imports from cc', () => {
    it('are read from the layer namespace, so a name the layer lacks is undefined instead of a build error', async () => {
        const { readNamedImportsThroughNamespace } = await import('../src/bundle/cocosCompat');
        const out = readNamedImportsThroughNamespace("import { _decorator, Node as N, type Vec3, gfx } from 'cc';\nimport { EDITOR } from 'cc/env';\nconst x = 1;");
        expect(out).toContain("import * as __cc0 from 'cc'; const { _decorator, Node: N, gfx } = __cc0;");
        expect(out).toContain("import * as __cc1 from 'cc/env'; const { EDITOR } = __cc1;");
        expect(out).toContain('const x = 1;');
    });
});

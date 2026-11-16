// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dropWgslSections, drawsOnlyThroughGL, glOnlyShadersPlugin } from '../src/bundle/glOnlyShaders';

const SHADER = [
    '#pragma shader "X"',
    '#pragma fragment',
    'void main() { fragColor = vec4(1.0); }',
    '#pragma end',
    '#pragma fragment wgsl',
    '${HELPER_WGSL}',
    '@fragment fn fs_main() -> @location(0) vec4f { return vec4f(1.0); }',
    '#pragma end',
    '',
].join('\n');

describe('glOnlyShaders', () => {
    it('cuts each WGSL section whole, with what it splices, and keeps the GLSL', () => {
        const code = `const HELPER_WGSL = \`fn h() -> f32 { return 1.0; }\`;\nexport const S = \`${SHADER}\`;\n`;
        const r = dropWgslSections(code);
        expect(r.sections).toBe(1);
        expect(r.code).toBe('const HELPER_WGSL = `fn h() -> f32 { return 1.0; }`;\nexport const S = `#pragma shader "X"\n#pragma fragment\nvoid main() { fragColor = vec4(1.0); }\n#pragma end\n`;\n');
    });

    it('leaves a section with a nested template, or whose end is spliced in, as it was', () => {
        const nested = 'const S = `#pragma fragment wgsl\n${on ? `fn a() {}` : ``}\n#pragma end\n`;\n';
        expect(dropWgslSections(nested).code).toBe(nested);
        const spliced = 'const S = `#pragma fragment wgsl\n${BODY_AND_END}`;\nconst T = `x\n`;\n';
        expect(dropWgslSections(spliced).code).toBe(spliced);
    });

    it('does not read a doc comment that mentions the pragma as a section', () => {
        const doc = '/**\n * `#pragma fragment wgsl` opens a twin.\n * #pragma end\n */\nconst x = 1;\n';
        expect(dropWgslSections(doc).code).toBe(doc);
    });

    it('is for every mini-game and playable, and a web build that did not ask for WebGPU', () => {
        expect(drawsOnlyThroughGL('minigame')).toBe(true);
        expect(drawsOnlyThroughGL('playable', 'webgpu')).toBe(true);
        expect(drawsOnlyThroughGL('web')).toBe(true);
        expect(drawsOnlyThroughGL('web', 'webgl2')).toBe(true);
        expect(drawsOnlyThroughGL('web', 'webgpu')).toBe(false);
    });

    it('drops the WGSL helper a bundle no longer reaches, and nothing outside the SDK', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'gl-only-'));
        try {
            const sdk = path.join(dir, 'sdk');
            await mkdir(sdk);
            await writeFile(path.join(sdk, 'shaders.js'), `const HELPER_WGSL = \`fn helperOnlyWgsl() -> f32 { return 1.0; }\`;\nexport const S = \`${SHADER}\`;\n`);
            const app = path.join(dir, 'app.js');
            await writeFile(app, `import { S } from './sdk/shaders.js';\nexport const own = \`${SHADER}\`;\nconsole.log(S, own);\n`);
            const stats = { removed: 0, sections: 0 };
            const out = await build({ entryPoints: [app], bundle: true, write: false, format: 'esm', plugins: [glOnlyShadersPlugin(sdk, stats)] });
            const text = out.outputFiles[0].text;
            expect(stats.sections).toBe(1);
            expect(text).not.toContain('helperOnlyWgsl');
            // The project's own shader is not the SDK's to change.
            expect(text.match(/#pragma fragment wgsl/g)?.length).toBe(1);
        } finally {
            await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
        }
    });
});

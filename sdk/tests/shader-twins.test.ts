// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Structural guard for the SDK's embedded .esshader strings: every stage
// section must close with `#pragma end` (an unterminated section fails
// ShaderParser.parse at runtime — the sprite-filter shaders shipped broken
// this way once, lazily compiled and never exercised), and every material
// source must carry its `#pragma fragment wgsl` twin so it compiles on the
// WebGPU backend.
import { describe, expect, it } from 'vitest';

import { BUILTIN_SHADER_TEMPLATES } from '../src/render/builtinShaders';

// The filter modules export functions, not their sources — read the sources
// from disk so the guard sees exactly what ships.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function embeddedEsshaders(file: string): string[] {
    const text = readFileSync(join(SRC, file), 'utf-8');
    // Template literals that start with a #pragma shader header.
    return [...text.matchAll(/`(#pragma shader[\s\S]*?)`/g)].map((m) => m[1]);
}

function sectionsBalance(source: string): boolean {
    let open = 0;
    for (const line of source.split('\n')) {
        const t = line.trim();
        if (/^#pragma (vertex|fragment|properties|variant)\b/.test(t)) {
            if (open !== 0) return false;
            open = 1;
        } else if (t === '#pragma end') {
            if (open !== 1) return false;
            open = 0;
        }
    }
    return open === 0;
}

const CASES: Array<{ name: string; source: string }> = [
    ...BUILTIN_SHADER_TEMPLATES.map((t) => ({ name: `template:${t.id}`, source: t.source })),
    ...embeddedEsshaders('render/filters.ts').map((source, i) => ({ name: `filters.ts[${i}]`, source })),
    ...embeddedEsshaders('render/spriteFilter.ts').map((source, i) => ({ name: `spriteFilter.ts[${i}]`, source })),
    ...embeddedEsshaders('postprocess/postProcessEffects.ts').map(
        (source, i) => ({ name: `postProcessEffects.ts[${i}]`, source })),
    ...embeddedEsshaders('camera/editorGridRenderer.ts').map(
        (source, i) => ({ name: `editorGridRenderer.ts[${i}]`, source })),
];

describe('embedded .esshader structure', () => {
    it('found the filter, effect and grid sources', () => {
        expect(CASES.filter((c) => c.name.startsWith('filters.ts')).length).toBe(1);
        expect(CASES.filter((c) => c.name.startsWith('spriteFilter.ts')).length).toBe(2);
        expect(CASES.filter((c) => c.name.startsWith('postProcessEffects.ts')).length).toBe(14);
        expect(CASES.filter((c) => c.name.startsWith('editorGridRenderer.ts')).length).toBe(1);
    });

    for (const { name, source } of CASES) {
        it(`${name}: every section closes with #pragma end`, () => {
            expect(sectionsBalance(source)).toBe(true);
        });

        it(`${name}: carries a WGSL fragment twin with the fs_main entry point`, () => {
            expect(source).toContain('#pragma fragment wgsl');
            const wgsl = source.slice(source.indexOf('#pragma fragment wgsl'));
            expect(wgsl).toContain('fn fs_main(');
        });

        // A shader that authors its own vertex stage (no canonical injection)
        // must also carry the WGSL vertex twin, or it cannot link on WebGPU.
        if (/^#pragma vertex\s*$/m.test(source)) {
            it(`${name}: authored vertex carries a WGSL twin with the vs_main entry point`, () => {
                expect(source).toContain('#pragma vertex wgsl');
                const wgsl = source.slice(source.indexOf('#pragma vertex wgsl'));
                expect(wgsl).toContain('fn vs_main(');
            });
        }
    }
});

// The staleness contract behind cook-time + editor twin (re)generation: a
// generated twin stores a hash of the authored GLSL, so `needsTwin` is true when
// the twin is missing OR the GLSL changed under it (stale) — but not when only
// the generated twin body changed. This is what makes "GLSL is the single source,
// WGSL is a derivative" hold — the derivative provably tracks the source.
const gen = (await import('../../tools/gen-shader-twins.mjs')) as unknown as {
    needsTwin(s: string): boolean;
    sourceHash(s: string): string;
};
describe('gen-shader-twins needsTwin / sourceHash (staleness)', () => {
    const glsl = '#pragma shader "T"\n#pragma fragment\nvoid main() { }\n#pragma end\n';
    const twin = (hash: string | null) =>
        `${glsl}\n#pragma fragment wgsl full\n` +
        (hash ? `// source-hash: ${hash}\n` : '') +
        '@fragment fn fs_main() { }\n#pragma end\n';

    it('no twin → needs one', () => expect(gen.needsTwin(glsl)).toBe(true));
    it('fresh generated twin (matching hash) → up to date', () =>
        expect(gen.needsTwin(twin(gen.sourceHash(glsl)))).toBe(false));
    it('stale generated twin (wrong hash) → needs regen', () =>
        expect(gen.needsTwin(twin('deadbeefdeadbeef'))).toBe(true));
    it('generated twin with no stored hash → needs regen (legacy)', () =>
        expect(gen.needsTwin(twin(null))).toBe(true));
    it('hand-authored (non-full) twin → left alone', () =>
        expect(gen.needsTwin(`${glsl}\n#pragma fragment wgsl\n@fragment fn fs_main() { }\n#pragma end\n`)).toBe(false));
    it('#pragma switch shader → never auto-generated', () =>
        expect(gen.needsTwin(`${glsl}#pragma switch FOO default(off)\n`)).toBe(false));
    it('editing only the twin body does not stale it; editing the GLSL does', () => {
        const fresh = twin(gen.sourceHash(glsl));
        expect(gen.needsTwin(fresh.replace('fs_main', 'fs_main_x'))).toBe(false);
        expect(gen.needsTwin(fresh.replace('void main() { }', 'void main() { discard; }'))).toBe(true);
    });
});

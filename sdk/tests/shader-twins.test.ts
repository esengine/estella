// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Structural guard for the SDK's embedded .esshader strings: every stage
// section must close with `#pragma end` (an unterminated section fails
// ShaderParser.parse at runtime — the sprite-filter shaders shipped broken
// this way once, lazily compiled and never exercised), and every material
// source must carry its `#pragma fragment wgsl` twin so it compiles on the
// WebGPU backend.
import { describe, expect, it } from 'vitest';

import { BUILTIN_SHADER_TEMPLATES } from '../src/builtinShaders';

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
    ...embeddedEsshaders('filters.ts').map((source, i) => ({ name: `filters.ts[${i}]`, source })),
    ...embeddedEsshaders('spriteFilter.ts').map((source, i) => ({ name: `spriteFilter.ts[${i}]`, source })),
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

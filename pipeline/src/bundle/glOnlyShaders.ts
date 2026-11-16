// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    glOnlyShaders.ts
 * @brief   A package that never draws through WebGPU ships its shaders without their WGSL.
 *
 * Every built-in shader carries both languages: the GLSL stages, and a `#pragma vertex wgsl` / `#pragma fragment wgsl` section
 * for each stage, up to its `#pragma end`. A mini-game and a playable draw through WebGL only, and a web build that did not ask
 * for WebGPU never reaches it either, so the WGSL sections are text they carry and never read — a fifth of the SDK's shader text.
 * The engine takes a shader with no WGSL section as one with no twin, which only a WebGPU device asks for.
 *
 * This runs on the SDK's built JavaScript, where no TypeScript parser is to hand, so it works on the text and only where that is
 * provably safe: a section is cut from the start of its pragma line to the end of its `#pragma end` line, and only when no
 * backtick lies between them. Line breaks are real only inside a template literal, so both ends are in one, and with no backtick
 * between them they are in the same one: what is cut is that template's text and any `${...}` inside it, whole. A section whose
 * end is spliced in from elsewhere, or that holds a nested template, is left as it was. What a cut section referred to and
 * nothing else does (a WGSL helper constant) is then dropped by the bundler as unused.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'esbuild';

const SECTION_START = /^[ \t]*#pragma (?:vertex|fragment|compute|vertexoffset) wgsl\b[^\n]*\n/gm;
const SECTION_END = /^[ \t]*#pragma end\b[^\n]*(?:\n|$)/m;

/** `code` without the WGSL sections of its shaders, and how many characters went. */
export function dropWgslSections(code: string): { code: string; removed: number; sections: number } {
    if (!code.includes(' wgsl')) return { code, removed: 0, sections: 0 };
    let out = '';
    let from = 0;
    let sections = 0;
    SECTION_START.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SECTION_START.exec(code))) {
        const start = m.index;
        const rest = code.slice(start + m[0].length);
        const end = SECTION_END.exec(rest);
        if (!end) break;
        const stop = start + m[0].length + end.index + end[0].length;
        const cut = code.slice(start, stop);
        if (cut.includes('`')) { SECTION_START.lastIndex = start + m[0].length; continue; }
        out += code.slice(from, start);
        from = stop;
        sections++;
        SECTION_START.lastIndex = stop;
    }
    if (sections === 0) return { code, removed: 0, sections: 0 };
    out += code.slice(from);
    return { code: out, removed: code.length - out.length, sections };
}

/** Whether a package draws only through WebGL: a mini-game and a playable always, a web build unless it asked for WebGPU. */
export function drawsOnlyThroughGL(target: 'web' | 'minigame' | 'playable', renderBackend?: string): boolean {
    return target !== 'web' || renderBackend !== 'webgpu';
}

/** The esbuild plugin: the SDK's own modules, under `sdkDir`, load without their WGSL sections. */
export function glOnlyShadersPlugin(sdkDir: string, stats?: { removed: number; sections: number }): Plugin {
    const root = path.resolve(sdkDir);
    return {
        name: 'estella-gl-only-shaders',
        setup(build) {
            build.onLoad({ filter: /\.m?js$/ }, async (args) => {
                const file = path.resolve(args.path);
                if (!file.startsWith(root + path.sep)) return undefined;
                const r = dropWgslSections(await readFile(file, 'utf8'));
                if (r.sections === 0) return undefined;
                if (stats) { stats.removed += r.removed; stats.sections += r.sections; }
                return { contents: r.code, loader: 'js', resolveDir: path.dirname(file) };
            });
        },
    };
}

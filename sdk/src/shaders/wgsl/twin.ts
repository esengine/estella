// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    twin.ts
 * @brief   A shader source with the WGSL its GLSL translates to, for a device that draws through WebGPU.
 */
import { ENGINE_SHADER_API } from './engineApi.generated';
import { transpileFragment, transpileVertexHook } from './transpile';

const GLSL_FRAGMENT = /^#pragma fragment[ \t]*\r?$/m;
const WGSL_FRAGMENT = /^#pragma fragment wgsl\b/m;
const GLSL_VERTEX = /^#pragma vertex[ \t]*\r?$/m;
const WGSL_VERTEX = /^#pragma vertex wgsl\b/m;
const GLSL_HOOK = /^#pragma vertexoffset[ \t]*\r?$/m;
const WGSL_HOOK = /^#pragma vertexoffset wgsl\b/m;

/** What stops a source's GLSL being written as WGSL: the message, and the line of the source file it names when it names one. */
export interface WgslTwinProblem { section: 'fragment' | 'vertexoffset'; message: string; line?: number }

/**
 * Why `source` would draw nowhere but WebGL: the first GLSL section of it the transpiler cannot write as WGSL, with the line counted
 * in the whole file (the transpiler counts from the top of the section). Null when every section that needs a twin translates, or
 * none does. Nothing is cached or warned, so an author can ask again after every edit: what a tool that writes shaders reports.
 */
export function wgslTwinProblem(source: string): WgslTwinProblem | null {
    const check = (section: 'fragment' | 'vertexoffset', glsl: RegExp, wgsl: RegExp, translate: (s: string) => unknown): WgslTwinProblem | null => {
        if (!glsl.test(source) || wgsl.test(source)) return null;
        try {
            translate(source);
            return null;
        } catch (e) {
            const err = e as Error & { line?: number };
            const pragma = new RegExp(`^#pragma ${section}[ \\t]*\\r?$`, 'm').exec(source);
            const pragmaLine = pragma ? source.slice(0, pragma.index).split('\n').length : 0;
            const message = err.message.replace(/^line \d+: /, '');
            return err.line !== undefined && pragma ? { section, message, line: pragmaLine + err.line } : { section, message };
        }
    };
    if (GLSL_VERTEX.test(source) && !WGSL_VERTEX.test(source)) {
        return { section: 'fragment', message: 'a source with its own GLSL vertex stage needs its WGSL vertex stage written by hand (`#pragma vertex wgsl`); only fragments and vertex hooks are translated' };
    }
    return check('fragment', GLSL_FRAGMENT, WGSL_FRAGMENT, (s) => transpileFragment(s, ENGINE_SHADER_API))
        ?? check('vertexoffset', GLSL_HOOK, WGSL_HOOK, (s) => transpileVertexHook(s, ENGINE_SHADER_API));
}

/** Twins by source: a shader compiles once per permutation, and the twin of one source is the same for all of them. */
const twins = new Map<string, string>();
const refused = new Set<string>();

/**
 * `source` with the WGSL of each GLSL section that has none: its fragment (`#pragma fragment wgsl`) and its vertex hook
 * (`#pragma vertexoffset wgsl`). A section that already has its WGSL keeps it. A source whose own vertex stage has no WGSL (which
 * this does not write) is returned as it is, and so is one the transpiler cannot read, with a warning naming why, once.
 */
export function withWgslTwin(source: string): string {
    const fragment = GLSL_FRAGMENT.test(source) && !WGSL_FRAGMENT.test(source);
    const hook = GLSL_HOOK.test(source) && !WGSL_HOOK.test(source);
    if (!fragment && !hook) return source;
    if (GLSL_VERTEX.test(source) && !WGSL_VERTEX.test(source)) return source;
    const cached = twins.get(source);
    if (cached !== undefined) return cached;
    if (refused.has(source)) return source;
    try {
        let out = source.trimEnd();
        if (fragment) out += `\n\n#pragma fragment wgsl\n${transpileFragment(source, ENGINE_SHADER_API)}\n#pragma end`;
        if (hook) out += `\n\n#pragma vertexoffset wgsl\n${transpileVertexHook(source, ENGINE_SHADER_API)}\n#pragma end`;
        out += '\n';
        twins.set(source, out);
        return out;
    } catch (e) {
        refused.add(source);
        const name = /^#pragma shader\s+"([^"]*)"/m.exec(source)?.[1] ?? 'a shader';
        console.warn(`[wgsl] ${name} has no WGSL twin and could not be given one: ${(e as Error).message}`);
        return source;
    }
}

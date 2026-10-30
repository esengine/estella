// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    effects.ts
 * @brief   Reading a Cocos `.effect` file: its technique/pass/property description and its GLSL programs.
 *
 * An effect is one text file of two kinds of block: `CCEffect %{ … }%`, YAML describing the techniques, their passes (which program is the
 * vertex stage and which the fragment, the blend, depth and cull state) and each pass's properties; and `CCProgram name %{ … }%`, GLSL 3.00
 * that the passes name as `program:entry`. The programs `#include <builtin/…>` chunks of the Creator install and declare the uniform blocks
 * they read. This reads both into data; turning that into an Estella material is the converter's job (effectConvert.ts), and what an
 * effect needs of the renderer, which decides whether it can be converted at all, is {@link describeEffect}.
 */
import yaml from 'js-yaml';

export interface EffectProperty {
    name: string;
    /** The declared default, as written: a number, a vector, or a texture default name (`white`, `grey`, `normal`, …). */
    value: unknown;
    /** The editor's type for it (`color`, `vector`, …), which tells a colour from a vector. */
    editorType: string | null;
    /** The uniform (or sampler) the property is stored in, when it says: `target: baseColor.rgb`. */
    target: string | null;
}

export interface EffectPass {
    /** `program:entry` of each stage as written. */
    vert: string;
    frag: string;
    /** Macro defines the pass fixes (`embeddedMacros`). */
    macros: Record<string, unknown>;
    blend: unknown;
    depthStencil: unknown;
    rasterizer: unknown;
    /** The pass's phase (`forward-add`, a custom pipeline's name…), which says which part of the frame draws it. */
    phase: string | null;
    properties: EffectProperty[];
    /** The pass is a reference to another effect's pass (`switch`, `pass: builtin-xxx`) rather than its own. */
    inherits: string | null;
}

export interface EffectProgram {
    name: string;
    source: string;
}

export interface CocosEffect {
    techniques: Array<{ name: string; passes: EffectPass[] }>;
    programs: Map<string, EffectProgram>;
}

const BLOCK = /(CCEffect|CCProgram)\s*([A-Za-z0-9_\-.]*)\s*%\{([\s\S]*?)\}%/g;

/** Read an effect file's blocks. A file with no CCEffect has no techniques. Throws on YAML it cannot read. */
export function parseEffect(text: string): CocosEffect {
    const effect: CocosEffect = { techniques: [], programs: new Map() };
    for (const m of text.matchAll(BLOCK)) {
        const [, kind, name, body] = m;
        if (kind === 'CCProgram') { effect.programs.set(name!, { name: name!, source: body! }); continue; }
        const doc = yaml.load(body!) as { techniques?: unknown[] } | null;
        for (const [i, t] of (doc?.techniques ?? []).entries()) {
            const tech = t as { name?: string; passes?: unknown[] };
            effect.techniques.push({
                name: tech.name ?? `technique${i}`,
                passes: (tech.passes ?? []).map((p) => passOf(p as Record<string, unknown>)),
            });
        }
    }
    return effect;
}

function passOf(p: Record<string, unknown>): EffectPass {
    const props = (p.properties ?? {}) as Record<string, unknown>;
    return {
        vert: String(p.vert ?? ''),
        frag: String(p.frag ?? ''),
        macros: (p.embeddedMacros ?? {}) as Record<string, unknown>,
        blend: p.blendState ?? null,
        depthStencil: p.depthStencilState ?? null,
        rasterizer: p.rasterizerState ?? null,
        phase: typeof p.phase === 'string' ? p.phase : null,
        inherits: typeof p.switch === 'string' ? p.switch : typeof p.pass === 'string' ? p.pass : null,
        properties: Object.entries(props).map(([name, def]) => {
            const d = (def ?? {}) as { value?: unknown; editor?: { type?: string }; target?: string };
            return { name, value: d.value ?? null, editorType: d.editor?.type ?? null, target: d.target ?? null };
        }),
    };
}

// ---------------------------------------------------------------------------
// What an effect asks of the renderer
// ---------------------------------------------------------------------------

export interface EffectFacts {
    passes: number;
    techniques: number;
    phases: string[];
    /** `builtin/…` and `common/…` chunks the programs include. */
    includes: string[];
    /** The Cocos uniform blocks and built-in uniforms the shader code reads (`cc_time`, `cc_matWorld`, …). */
    builtinUniforms: string[];
    /** The vertex attributes the vertex program reads. */
    attributes: string[];
    samplers: number;
    properties: number;
    /** Macros the programs branch on (`#if USE_TEXTURE`). */
    macros: string[];
    /** Reads the frame behind it, or the depth: not a function of the object alone. */
    readsFrame: boolean;
    readsDepth: boolean;
    /** Uses the scene's lights or shadows: needs what the renderer's lighting provides. */
    usesLighting: boolean;
    usesShadow: boolean;
    skinned: boolean;
    instanced: boolean;
    /** What kind of thing it draws, by its stages: a sprite/UI quad, a mesh, a particle, a screen pass. */
    kind: 'sprite' | 'mesh' | 'particle' | 'screen' | 'other';
}

const unique = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();

/**
 * The macros a program branches on: every name in an `#if`, `#elif`, `#ifdef` or `#ifndef`, wherever it stands in the expression. A name a number
 * is compared with (`LEVEL == 2`) is in the second list, since a switch cannot say it.
 */
export function macrosIn(source: string): { switches: string[]; compared: string[] } {
    const switches = new Set<string>(), compared = new Set<string>();
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const m of code.matchAll(/^[ \t]*#[ \t]*(if|elif|ifdef|ifndef)\b(.*)$/gm)) {
        const expr = m[2]!.replace(/\bdefined\b/g, ' ');
        for (const t of expr.matchAll(/\b([A-Z][A-Z0-9_]+)\b(\s*(?:==|!=|<=|>=|<|>))?/g)) {
            (t[2] ? compared : switches).add(t[1]!);
        }
    }
    return { switches: [...switches].sort(), compared: [...compared].sort() };
}

/** The facts about one effect that decide how it can be taken across. Reads the passes' programs, not their names. */
export function describeEffect(effect: CocosEffect, file = ''): EffectFacts {
    const passes = effect.techniques.flatMap((t) => t.passes);
    const stageNames = new Set<string>();
    const vertNames = new Set<string>();
    for (const p of passes) {
        for (const ref of [p.vert, p.frag]) if (ref) stageNames.add(ref.split(':')[0]!);
        if (p.vert) vertNames.add(p.vert.split(':')[0]!);
    }
    const source = [...stageNames].map((n) => effect.programs.get(n)?.source ?? '').join('\n');
    const vertSource = [...vertNames].map((n) => effect.programs.get(n)?.source ?? '').join('\n');
    const includes = [...source.matchAll(/#include\s*<([^>]+)>/g)].map((m) => m[1]!);
    const builtinUniforms = [...source.matchAll(/\b(cc_[A-Za-z0-9_]+)\b/g)].map((m) => m[1]!);
    const attributes = [...vertSource.matchAll(/^\s*in\s+(?:highp\s+|mediump\s+|lowp\s+)?\w+\s+(a_\w+)/gm)].map((m) => m[1]!);
    const macros = macrosIn(source).switches;
    const samplers = [...source.matchAll(/uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?sampler\w+\s+\w+/g)].length;
    const has = (re: RegExp): boolean => re.test(source);
    const lower = file.toLowerCase();
    const attrs = new Set(attributes);
    let kind: EffectFacts['kind'] = 'other';
    if (/particle|trail/.test(lower) || attrs.has('a_dir') || attrs.has('a_texCoord1')) kind = 'particle';
    else if (attrs.has('a_normal') || attrs.has('a_tangent') || attrs.has('a_joints')) kind = 'mesh';
    else if (/bloom|post|blur|screen/.test(lower) || has(/cc_screenSize|cc_spriteTexture.*RT/)) kind = 'screen';
    else if (attrs.has('a_position') && attrs.has('a_texCoord') && attrs.has('a_color')) kind = 'sprite';
    else if (attrs.has('a_position')) kind = 'mesh';
    return {
        passes: passes.length,
        techniques: effect.techniques.length,
        phases: unique(passes.map((p) => p.phase).filter((x): x is string => !!x)),
        includes: unique(includes),
        builtinUniforms: unique(builtinUniforms),
        attributes: unique(attributes),
        samplers,
        properties: passes.reduce((n, p) => n + p.properties.length, 0),
        macros: unique(macros),
        readsFrame: has(/cc_gbuffer|cc_(?:grab|screen)Tex|SAMPLE_FROM_RT|frameBuffer|sceneColor/i),
        readsDepth: has(/cc_depth|depthTex|cc_gbufferDepth/i),
        usesLighting: includes.some((i) => /lighting|cc-forward-light|shading|pbr|standard-surface/i.test(i)) || has(/cc_mainLitDir|CCStandardShading|CCToon/),
        usesShadow: includes.some((i) => /shadow/i.test(i)) || has(/cc_shadow|CC_RECEIVE_SHADOW/),
        skinned: attrs.has('a_joints') || has(/CCSkin|USE_SKINNING/),
        instanced: has(/USE_INSTANCING|a_matWorld0/),
        kind,
    };
}

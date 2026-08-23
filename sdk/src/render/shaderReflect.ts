// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    shaderReflect.ts
 * @brief   What a `.esshader`'s `#pragma param` lines declare, read from the source.
 * @details Parses the same param grammar the engine's C++ ShaderParser does, but only the
 *          declaration metadata (name / type / default / range / ui hint / display name).
 *          The engine remains the single source of the std140 layout + GLSL codegen; this is
 *          the static view of the declarations, for everything that needs to know a shader's
 *          parameter vocabulary without compiling one.
 *
 *          Three things read it, which is why it lives here rather than in the editor where
 *          it started: the Material inspector builds its parameter panel from it, the built-in
 *          templates derive their material defaults from it (so the defaults cannot drift from
 *          the shader that consumes them), and `Material.setUniform` uses it to tell a caller
 *          that the name it just wrote is not one this shader has — a value the engine would
 *          otherwise drop without a word.
 *
 *          Grammar (matches ShaderParser):
 *            #pragma param <name> <type> [default(csv)] [range(min,max)] [ui(hint)]
 *            #pragma domain <Unlit|Lit|PostProcess|UI>
 */

export type ShaderParamType = 'float' | 'vec2' | 'vec3' | 'vec4' | 'color' | 'int' | 'texture';

export interface ShaderParam {
    name: string;
    type: ShaderParamType;
    /** Human label for the inspector row (leading `u_` stripped, capitalized). */
    displayName: string;
    /** Default components for a scalar/vector param (length 1–4); empty for a texture. */
    default: number[];
    /** Default texture hint for a texture param (e.g. "white"); undefined otherwise. */
    defaultTexture?: string;
    /** Optional slider bounds from `range(min,max)`. */
    range?: { min: number; max: number };
    /** Optional UI hint from `ui(...)`, e.g. "slider". */
    ui?: string;
}

export interface ShaderReflection {
    domain: string;
    params: ShaderParam[];
}

const TYPES = new Set<ShaderParamType>(['float', 'vec2', 'vec3', 'vec4', 'color', 'int', 'texture']);
const ARITY: Record<string, number> = { float: 1, int: 1, vec2: 2, vec3: 3, vec4: 4, color: 4 };
const VEC_KEYS = ['x', 'y', 'z', 'w'] as const;

// Extract the contents of a `key(...)` clause from a directive argument.
function clause(arg: string, key: string): string | undefined {
    const token = `${key}(`;
    const open = arg.indexOf(token);
    if (open < 0) return undefined;
    const start = open + token.length;
    const close = arg.indexOf(')', start);
    if (close < 0) return undefined;
    return arg.slice(start, close).trim();
}

function defaultForType(type: ShaderParamType): number[] {
    if (type === 'texture') return [];
    if (type === 'color') return [0, 0, 0, 1];
    return new Array(ARITY[type] ?? 1).fill(0);
}

function displayNameFor(name: string): string {
    let s = name.startsWith('u_') ? name.slice(2) : name;
    if (s.length > 0) s = s[0].toUpperCase() + s.slice(1);
    return s;
}

function parseParam(arg: string): ShaderParam | null {
    const tokens = arg.trim().split(/\s+/);
    const name = tokens[0];
    const typeStr = tokens[1];
    if (!name || !typeStr || !TYPES.has(typeStr as ShaderParamType)) return null;
    const type = typeStr as ShaderParamType;

    const param: ShaderParam = { name, type, displayName: displayNameFor(name), default: defaultForType(type) };

    const def = clause(arg, 'default');
    if (def !== undefined) {
        if (type === 'texture') {
            param.defaultTexture = def;
        } else {
            const nums = def.split(',').map((s) => parseFloat(s.trim())).filter((n) => !Number.isNaN(n));
            if (nums.length > 0) param.default = nums;
        }
    }

    const range = clause(arg, 'range');
    if (range !== undefined) {
        const [min, max] = range.split(',').map((s) => parseFloat(s.trim()));
        if (!Number.isNaN(min) && !Number.isNaN(max)) param.range = { min, max };
    }

    const ui = clause(arg, 'ui');
    if (ui !== undefined) param.ui = ui;

    return param;
}

/**
 * A param's declared default in the shape a `.esmaterial`'s `properties` stores it: a number
 * for float/int, `{r,g,b,a}` for a color, `{x,y,…}` for a vector, and for a texture the
 * default's NAME (`"white"`, `"flatnormal"` — an engine-resolved stand-in, not an asset ref).
 */
export function paramDefaultValue(param: ShaderParam): unknown {
    if (param.type === 'texture') return param.defaultTexture ?? 0;
    if (param.type === 'color') {
        const d = param.default;
        return { r: d[0] ?? 0, g: d[1] ?? 0, b: d[2] ?? 0, a: d[3] ?? 1 };
    }
    if (param.type === 'float' || param.type === 'int') return param.default[0] ?? 0;
    const vec: Record<string, number> = {};
    const arity = ARITY[param.type] ?? 1;
    for (let i = 0; i < arity; i++) vec[VEC_KEYS[i]] = param.default[i] ?? 0;
    return vec;
}

/**
 * A domain a shader was authored against, under the name the engine uses now.
 * The twin of the engine parser's own table: the two lit domains were named for
 * a plane before either was the only one there is, and a `.esshader` carries no
 * format version to migrate by, so the old spelling is answered on the way in.
 */
export const RENAMED_DOMAINS: Readonly<Record<string, string>> = { Lit2D: 'Lit', Unlit2D: 'Unlit' };

/** Parse a `.esshader` source into its declared parameters and domain. */
export function reflectEsshader(source: string): ShaderReflection {
    const params: ShaderParam[] = [];
    let domain = 'Unlit';

    for (const raw of source.split('\n')) {
        const line = raw.trim();
        if (!line.startsWith('#pragma')) continue;
        const rest = line.slice('#pragma'.length).trim();
        const sp = rest.search(/\s/);
        const directive = sp < 0 ? rest : rest.slice(0, sp);
        const arg = sp < 0 ? '' : rest.slice(sp + 1).trim();

        if (directive === 'param') {
            const p = parseParam(arg);
            if (p) params.push(p);
        } else if (directive === 'domain' && arg) {
            domain = RENAMED_DOMAINS[arg] ?? arg;
        }
    }

    return { domain, params };
}

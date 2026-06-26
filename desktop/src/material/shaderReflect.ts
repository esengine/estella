// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    shaderReflect.ts
 * @brief   Editor-side reflection of a `.esshader`'s `#pragma param` declarations.
 * @details Parses the same param grammar the engine's C++ ShaderParser does, but only the
 *          UI-facing metadata (name / type / default / range / ui hint / display name) — the
 *          editor builds a parameter panel from it. The engine remains the single source of
 *          the std140 layout + GLSL codegen; this is the static, editor-only view of the
 *          declarations, so the Material Editor needn't round-trip through a compiled shader.
 *
 *          Grammar (matches ShaderParser):
 *            #pragma param <name> <type> [default(csv)] [range(min,max)] [ui(hint)]
 *            #pragma domain <Unlit2D|Lit2D|PostProcess|UI>
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

/** Parse a `.esshader` source into its editor-facing parameter reflection. */
export function reflectEsshader(source: string): ShaderReflection {
  const params: ShaderParam[] = [];
  let domain = 'Unlit2D';

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
      domain = arg;
    }
  }

  return { domain, params };
}

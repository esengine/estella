// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { reflectEsshader, paramDefaultValue } from '../src/render/shaderReflect';
import { BUILTIN_SHADER_TEMPLATES, builtinShaderTemplate } from '../src/render/builtinShaders';

const SRC = `
#pragma shader "ParamTest"
#pragma version 300 es
#pragma domain Unlit2D
#pragma param u_strength float default(1) range(0,4) ui(slider)
#pragma param u_tint color default(1,0.5,0.25,1)
#pragma param u_offset vec2 default(3,4)
#pragma param u_noise texture default(white)

#pragma vertex
void main() {}
#pragma end
#pragma fragment
void main() {}
#pragma end
`;

describe('reflectEsshader', () => {
  it('parses domain and all params', () => {
    const r = reflectEsshader(SRC);
    expect(r.domain).toBe('Unlit2D');
    expect(r.params.map((p) => p.name)).toEqual(['u_strength', 'u_tint', 'u_offset', 'u_noise']);
  });

  it('parses type, default, range and ui for a scalar', () => {
    const p = reflectEsshader(SRC).params.find((x) => x.name === 'u_strength')!;
    expect(p.type).toBe('float');
    expect(p.default).toEqual([1]);
    expect(p.range).toEqual({ min: 0, max: 4 });
    expect(p.ui).toBe('slider');
    expect(p.displayName).toBe('Strength'); // u_ stripped + capitalized
  });

  it('parses a color default as 4 components', () => {
    const p = reflectEsshader(SRC).params.find((x) => x.name === 'u_tint')!;
    expect(p.type).toBe('color');
    expect(p.default).toEqual([1, 0.5, 0.25, 1]);
  });

  it('parses a vec2 default', () => {
    const p = reflectEsshader(SRC).params.find((x) => x.name === 'u_offset')!;
    expect(p.type).toBe('vec2');
    expect(p.default).toEqual([3, 4]);
  });

  it('parses a texture param with a default texture hint (not in components)', () => {
    const p = reflectEsshader(SRC).params.find((x) => x.name === 'u_noise')!;
    expect(p.type).toBe('texture');
    expect(p.default).toEqual([]);
    expect(p.defaultTexture).toBe('white');
  });

  it('applies type defaults when no default() clause is given', () => {
    const r = reflectEsshader('#pragma param u_a float\n#pragma param u_c color\n#pragma vertex\n#pragma end\n#pragma fragment\n#pragma end');
    expect(r.params.find((p) => p.name === 'u_a')!.default).toEqual([0]);
    expect(r.params.find((p) => p.name === 'u_c')!.default).toEqual([0, 0, 0, 1]); // color alpha defaults to 1
  });

  it('ignores malformed/unknown-type params and non-pragma lines', () => {
    const r = reflectEsshader('#pragma param u_x notatype\n#pragma param onlyname\nuniform float x;\n#pragma param u_ok float');
    expect(r.params.map((p) => p.name)).toEqual(['u_ok']);
  });

  it('returns the default domain when none is declared', () => {
    expect(reflectEsshader('#pragma param u_a float').domain).toBe('Unlit2D');
  });
});

describe('a declared default in the shape a material stores it', () => {
  it('maps each param type to its stored shape', () => {
    const p = (name: string) => reflectEsshader(SRC).params.find((x) => x.name === name)!;
    expect(paramDefaultValue(p('u_strength'))).toBe(1);
    expect(paramDefaultValue(p('u_tint'))).toEqual({ r: 1, g: 0.5, b: 0.25, a: 1 });
    expect(paramDefaultValue(p('u_offset'))).toEqual({ x: 3, y: 4 });
    // A texture default is a NAME the engine resolves, not a ref to an asset.
    expect(paramDefaultValue(p('u_noise'))).toBe('white');
  });
});

describe('the built-in templates take their defaults from their own source', () => {
  // Five of the seven used to carry `defaults: {}` while their shader declared four
  // parameters: a material made from Dissolve came out empty, and the word `u_progress`
  // appeared nowhere a caller could find it. Deriving them is why that cannot recur.
  it('names every non-texture param a template declares', () => {
    for (const tpl of BUILTIN_SHADER_TEMPLATES) {
      const declared = reflectEsshader(tpl.source).params.filter((p) => p.type !== 'texture');
      expect([tpl.id, Object.keys(tpl.defaults).sort()])
        .toEqual([tpl.id, declared.map((p) => p.name).sort()]);
    }
  });

  it('carries the dissolve slider the engine actually reads', () => {
    expect(builtinShaderTemplate('sprite-dissolve')!.defaults).toEqual({
      u_progress: 0,
      u_edgeColor: { r: 1, g: 0.5, b: 0, a: 1 },
      u_edgeWidth: 0.08,
      u_noiseScale: 12,
    });
  });

  it('leaves a texture param out — a stored "flatnormal" would read as an asset ref', () => {
    expect(builtinShaderTemplate('sprite-lit')!.defaults).toEqual({ u_tint: { r: 1, g: 1, b: 1, a: 1 } });
  });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { shaderProjectPathOf, shaderRelRef } from '../src/material/materialInspectorModel';

describe('material shader ref <-> project path', () => {
  it('resolves a same-folder relative ref to the shader project path', () => {
    expect(shaderProjectPathOf('assets/mats/foo.esmaterial', 'bar.esshader')).toBe('assets/mats/bar.esshader');
  });

  it('resolves a `../` relative ref and a `/`-rooted ref', () => {
    expect(shaderProjectPathOf('assets/mats/foo.esmaterial', '../shaders/x.esshader')).toBe('assets/shaders/x.esshader');
    expect(shaderProjectPathOf('assets/mats/foo.esmaterial', '/assets/shaders/x.esshader')).toBe('assets/shaders/x.esshader');
  });

  it('reports no bound shader for an instance / empty ref', () => {
    expect(shaderProjectPathOf('assets/mats/foo.esmaterial', '')).toBe('');
    expect(shaderProjectPathOf('assets/mats/foo.esmaterial', undefined)).toBe('');
  });

  it('stores a same-folder shader as a bare name (what New Material writes)', () => {
    expect(shaderRelRef('assets/mats/foo.esmaterial', 'assets/mats/bar.esshader')).toBe('bar.esshader');
  });

  it('stores a cross-folder shader as a `../`-relative ref', () => {
    expect(shaderRelRef('assets/mats/foo.esmaterial', 'assets/shaders/x.esshader')).toBe('../shaders/x.esshader');
    expect(shaderRelRef('assets/a/b/foo.esmaterial', 'assets/shaders/x.esshader')).toBe('../../shaders/x.esshader');
  });

  it('round-trips: picked project path -> stored ref -> project path', () => {
    const mat = 'assets/mats/foo.esmaterial';
    for (const shader of ['assets/mats/bar.esshader', 'assets/shaders/x.esshader', 'shared/effect.esshader', 'top.esshader']) {
      const ref = shaderRelRef(mat, shader);
      expect(shaderProjectPathOf(mat, ref)).toBe(shader);
    }
  });

  it('handles a material at the project root', () => {
    expect(shaderRelRef('foo.esmaterial', 'bar.esshader')).toBe('bar.esshader');
    expect(shaderProjectPathOf('foo.esmaterial', 'bar.esshader')).toBe('bar.esshader');
    expect(shaderRelRef('foo.esmaterial', 'shaders/x.esshader')).toBe('shaders/x.esshader');
    expect(shaderProjectPathOf('foo.esmaterial', 'shaders/x.esshader')).toBe('shaders/x.esshader');
  });
});

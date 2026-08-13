// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The list of shaders a material can name.
 *
 * Measured on a real run before this existed: 47% of the calls went on finding
 * an API, and `sprite-outline` — which is one of these, described as exactly
 * what was wanted — was searched for three times and missed three times. The
 * ids and their parameters are runtime values, so a project holds no text of
 * them; a catalog that is not asked for cannot be found at all.
 */
import { describe, it, expect } from 'vitest';
import { builtinShaderCatalog, projectShaderEntry } from '@/material/shaderCatalog';

const catalog = builtinShaderCatalog();
const byRef = (ref: string) => catalog.find((e) => e.ref === ref);

describe('the stock templates', () => {
  it('answers with a ref that is what goes in the material', () => {
    for (const entry of catalog) expect(entry.ref).toMatch(/^builtin:[a-z0-9-]+$/);
  });

  it('carries every one the engine has', () => {
    expect(catalog.length).toBeGreaterThanOrEqual(7);
    for (const id of ['sprite-unlit', 'sprite-lit', 'sprite-outline', 'sprite-dissolve']) {
      expect(byRef(`builtin:${id}`)).toBeTruthy();
    }
  });

  it('says what each one is for, in the words the picker shows', () => {
    expect(byRef('builtin:sprite-outline')).toMatchObject({
      label: expect.stringMatching(/outline/i),
      description: expect.stringMatching(/outline/i),
      source: 'builtin',
    });
  });

  // The other half of the guessing: the uniform names. Reflected from the same
  // source the material is compiled from, so a name here is a name that works.
  it('lists the parameters each one takes, with their defaults', () => {
    const outline = byRef('builtin:sprite-outline')!;
    expect(outline.params.length).toBeGreaterThan(0);
    for (const p of outline.params) {
      expect(p.name).toMatch(/^u_/);
      expect(typeof p.type).toBe('string');
      expect(Array.isArray(p.default)).toBe(true);
    }
  });
});

// The other half of what the run went looking for: `interface MaterialAsset`,
// `type: 'material'`, `"version":`, `properties` — the file format, guessed at
// from types because nothing hands over a whole one.
describe('the material each template comes with', () => {
  it('is a document that can be written as it stands', () => {
    expect(byRef('builtin:sprite-outline')!.material).toMatchObject({
      version: '1.0',
      type: 'material',
      shader: 'builtin:sprite-outline',
      properties: expect.any(Object),
    });
  });

  it('starts from the template own defaults, so it renders before anything is set', () => {
    const material = byRef('builtin:sprite-outline')!.material!;
    const params = byRef('builtin:sprite-outline')!.params.map((p) => p.name);
    for (const key of Object.keys(material.properties ?? {})) expect(params).toContain(key);
  });

  it('is absent for a project shader, whose own file declares them', () => {
    expect(projectShaderEntry('a.esshader', '#pragma param u_x float default(1)').material).toBeUndefined();
  });
});

describe("a project's own shader", () => {
  it('is named by its path and reflected the same way', () => {
    const entry = projectShaderEntry('assets/shaders/wave.esshader', [
      '#pragma param u_amplitude float default(0.5) range(0,1)',
      '#pragma param u_tint color default(1,1,1,1)',
    ].join('\n'));
    expect(entry).toMatchObject({ ref: 'assets/shaders/wave.esshader', label: 'wave.esshader', source: 'project' });
    expect(entry.params.map((p) => p.name)).toEqual(['u_amplitude', 'u_tint']);
    expect(entry.params[0].range).toEqual({ min: 0, max: 1 });
  });
});

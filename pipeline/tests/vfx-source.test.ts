// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { buildVfx, checkVfx, describeLightClip, describeVfx, VFX_TEXTURES, type StoredEntity, type VfxSpec } from '../src/vfx/vfxSource';
import { vfxTextureSource } from '../src/vfx/vfxTextures';
import { validateImageSource } from '../src/image/imageSource';

const fire = (): VfxSpec => ({
  unit: 100,
  layers: [
    { name: 'flames', shape: 'cone', radius: 0.2, angle: 12, rate: 60, life: [0.5, 0.9], speed: [0.6, 1.2], gravity: 0.8, size: [[0.5, 0.7], 0.1], color: [[0, '#ffd27000'], [0.15, '#ffb040ee'], [1, '#80200000']], texture: 'flame', blend: 'add', intensity: 2 },
    { name: 'smoke', rate: 5, life: [3, 5], speed: 0.4, size: [0.5, 2], color: [[0, '#40383000'], [0.2, '#4a443e55'], [1, '#60606000']], texture: 'smoke', blend: 'alpha', at: [0, 0.8, 0] },
  ],
  light: { color: '#ff8a3c', intensity: 8, radius: 4, at: [0, 0.4, 0], flicker: { amount: 0.3, speed: 8 } },
});

const boom = (): VfxSpec => ({
  layers: [
    { name: 'sparks', shape: 'sphere', radius: 0.1, bursts: [[0, 60]], life: [0.5, 1.2], speed: [4, 9], gravity: -9.8, size: [0.06, 0.02], color: '#ffd080ff', texture: 'spark', render: 'stretched', collide: { bounce: 0.4 } },
    { name: 'smoke', delay: 0.2, bursts: [[0, 16]], life: [2.5, 4], speed: [1, 2], drag: 1.5, size: [1, 3], color: [[0, '#30303000'], [0.1, '#40404066'], [1, '#55555500']], texture: 'smoke', blend: 'alpha' },
  ],
  light: { color: '#ffa050', intensity: 30, radius: 7, fade: 0.6 },
});

describe('an effect from a description', () => {
  it('refuses what it cannot build, saying what', () => {
    expect(checkVfx({ layers: [] })).toEqual([expect.stringContaining('at least one layer')]);
    const bad = checkVfx({ layers: [{ name: 'x', life: 1, size: [1, 1], color: '#zzz', blend: 'glow' as never }] }).join(' | ');
    expect(bad).toContain('emits nothing');
    expect(bad).toContain('"#zzz"');
    expect(bad).toContain('`blend` is add');
    expect(checkVfx({ layers: [{ name: 'x', rate: 1, life: 1, size: [1, 1], color: [[2, '#ffffff']] }] }).join(' ')).toContain('colour stop 0');
    expect(checkVfx({ ...fire(), light: { color: '#fff000', intensity: 1, radius: 1, flicker: { amount: 0.2 }, fade: 1 } }).join(' ')).toContain('only one of them');
    expect(checkVfx({ layers: [{ name: 'x', rate: 1, life: 1, size: 1, color: '#ffffff', shape: 'box', arc: 90 }] }).join(' ')).toContain('not a box');
    expect(checkVfx({ layers: [{ name: 'x', rate: 1, life: 1, size: 1, color: '#ffffff', render: 'flat' as never }] }).join(' ')).toContain('horizontal');
  });

  it('writes emitters in world units, with the gradient in the shape the engine reads', () => {
    const b = buildVfx(fire());
    const flames = b.children.find((c) => c.name === 'flames')!.components.find((c) => c.type === 'ParticleEmitter')!.data as Record<string, any>;
    expect(flames.speedMin).toBeCloseTo(60);
    expect(flames.startSizeMax).toBeCloseTo(70);
    expect(flames.gravity).toEqual({ x: 0, y: 80, z: 0 });
    expect(flames.colorGradient.stops[1]).toEqual({ t: 0.15, color: expect.objectContaining({ r: 1, a: expect.closeTo(0.933, 2) }) });
    expect(flames.blendMode).toBe(1);
    // `angle` is the half-angle; the engine's shapeAngle is the whole opening.
    expect(flames.shapeAngle).toBe(24);
    expect(flames.looping).toBe(true);
    // Room for every particle it can have alive at once.
    expect(flames.maxParticles).toBeGreaterThanOrEqual(60 * 0.9);
    expect(b.textures.sort()).toEqual(['flame', 'smoke']);
    expect(b.lasts).toBeNull();
    // A flicker is the light's own, run by the engine (in the editor too), not a clip that only plays in a running game.
    expect(b.lightClip).toBeNull();
    const light = b.children.find((c) => c.name === 'Light')!.components.find((c) => c.type === 'Light')!.data as Record<string, number>;
    expect([light.pulse, light.pulseRate, light.pulseDepth, light.intensity]).toEqual([2, 8, 0.3, 8]);
  });

  it('writes a sine pulse on the light, and a loop that only pulses its light is still a loop', () => {
    const b = buildVfx({ layers: [{ name: 'rune', bursts: [[0, 1]], life: 1, size: 1, color: '#ffffff', texture: 'glow' }], light: { color: '#80a0ff', intensity: 3, radius: 2, pulse: { depth: 0.6, rate: 1.5 } } });
    const light = b.children.find((c) => c.name === 'Light')!.components[1]!.data as Record<string, number>;
    expect([light.pulse, light.pulseRate, light.pulseDepth]).toEqual([1, 1.5, 0.6]);
    expect(b.lasts).toBeNull();
  });

  it('writes the ground ring, the swirl and the arc as the engine takes them', () => {
    const b = buildVfx({ unit: 100, layers: [
      { name: 'ring', shape: 'circle', radius: 0.5, thickness: 0, arc: 180, orbit: 90, radial: 2, render: 'horizontal', bursts: [[0, 40]], life: 1, size: 0.2, color: '#ffffff', texture: 'glow' },
      { name: 'vortex', shape: 'sphere', radius: 1, orbit: [0, 45, 10], radial: -0.5, render: 'vertical', rate: 10, life: 1, size: 0.2, color: '#ffffff', texture: 'glow' },
    ] });
    const [ring, vortex] = b.children.map((c) => c.components[1]!.data as Record<string, any>);
    expect([ring!.shapeArc, ring!.shapeThickness, ring!.renderMode, ring!.radialVelocity]).toEqual([180, 0, 2, 200]);
    // A bare number turns a circle about its normal (z) and anything else about its axis (y).
    expect(ring!.orbitalVelocity).toEqual({ x: 0, y: 0, z: 90 });
    expect(vortex!.orbitalVelocity).toEqual({ x: 0, y: 45, z: 10 });
    expect([vortex!.renderMode, vortex!.radialVelocity, vortex!.shapeArc, vortex!.shapeThickness]).toEqual([3, -50, 360, 1]);
    // A ring that keeps widening is framed wider than its birth radius.
    expect(b.reach).toBeGreaterThan(2);
  });

  it('makes a one-shot of bursts, says how long it lasts, and fades its light', () => {
    const b = buildVfx(boom());
    const sparks = b.children[0]!.components[1]!.data as Record<string, any>;
    expect(sparks.looping).toBe(false);
    expect(sparks.bursts).toEqual([{ time: 0, count: 60 }]);
    expect(sparks.renderMode).toBe(1);
    expect(sparks.collisionEnabled).toBe(true);
    expect(b.lasts).toBeCloseTo(0.2 + 0.05 + 4, 1);
    // It removes itself once it is over.
    expect(b.root.components.find((c) => c.type === 'EffectLifetime')?.data.seconds).toBeGreaterThan(b.lasts!);
    expect(buildVfx(fire()).root.components.some((c) => c.type === 'EffectLifetime')).toBe(false);
    const clip = b.lightClip as any;
    expect(clip.wrapMode).toBe('once');
    expect(clip.tracks[0].channels[0].keyframes.at(-1).value).toBe(0);
    expect(b.reach).toBeGreaterThan(3);
  });

  it('reads back as the description that builds it', () => {
    const swirl: VfxSpec = { unit: 100, layers: [
      { name: 'ring', shape: 'circle', radius: 0.5, thickness: 0.2, arc: 270, orbit: 90, radial: 2, render: 'horizontal', bursts: [[0, 40]], life: 1, size: 0.2, color: '#ffffff', texture: 'glow' },
      { name: 'motes', shape: 'sphere', radius: 1, orbit: [10, 45, 0], render: 'vertical', rate: 10, life: 1, size: 0.2, color: '#ffffff', texture: 'glow' },
    ], light: { color: '#80a0ff', intensity: 3, radius: 2, pulse: { depth: 0.6, rate: 1.5 } } };
    for (const spec of [fire(), boom(), swirl]) {
      const b = buildVfx(spec);
      const stored: StoredEntity[] = b.children.map((c) => ({ name: c.name, parent: 'root', components: c.components.map((x) => ({ ...x, data: { ...x.data, ...(c.texture ? { texture: `@uuid:${c.texture}` } : {}) } })) }));
      const { spec: back } = describeVfx(stored, spec.unit ?? 1, (ref) => ref.slice(6));
      const again = buildVfx({ ...back, light: back.light ? describeLightClip(back.light, b.lightClip as never) : undefined });
      again.children.forEach((c, i) => expect(c.components).toEqual(b.children[i]!.components));
      expect(back.light?.flicker).toEqual(spec.light?.flicker && { amount: spec.light.flicker.amount, speed: spec.light.flicker.speed });
      expect(back.light?.pulse).toEqual(spec.light?.pulse);
      expect(back.layers.map((l) => l.texture)).toEqual(spec.layers.map((l) => l.texture));
    }
  });

  it('takes one number for a size that does not change', () => {
    expect(checkVfx({ layers: [{ name: 'x', rate: 1, life: 1, size: 0.5, color: '#ffffff', texture: 'glow' }] })).toEqual([]);
    const d = buildVfx({ layers: [{ name: 'x', rate: 1, life: 1, size: 0.5, color: '#ffffff', texture: 'glow' }] }).children[0]!.components[1]!.data as Record<string, number>;
    expect([d.startSizeMin, d.startSizeMax, d.endSizeMin, d.endSizeMax]).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('plays a built-in sheet as it was drawn: a flame round and round, a puff once over its life', () => {
    const b = buildVfx({ layers: [
      { name: 'f', rate: 10, life: 1, size: [1, 1], color: '#ffffff', texture: 'flame-sheet' },
      { name: 's', rate: 10, life: [2, 6], size: [1, 1], color: '#ffffff', texture: 'smoke-sheet', blend: 'alpha' },
    ] });
    const [f, s] = b.children.map((c) => c.components[1]!.data as Record<string, number | boolean>);
    expect([f!.spriteColumns, f!.spriteRows, f!.spriteLoop, f!.spriteFPS]).toEqual([4, 4, true, 20]);
    expect([s!.spriteLoop, s!.spriteFPS]).toEqual([false, 4]);
  });

  it('draws its own textures from recipes the image tools accept', () => {
    for (const name of VFX_TEXTURES) expect(() => validateImageSource(vfxTextureSource(name)), name).not.toThrow();
  });
});

describe('the built-in textures', () => {
  it('are fully clear at every edge, cell by cell for a sheet: a faint veil adds up to a square in an additive layer', async () => {
    const { renderImage } = await import('../src/image/imageRaster');
    for (const name of VFX_TEXTURES) {
      const src = validateImageSource(vfxTextureSource(name));
      const img = renderImage(src);
      const sheet = name.endsWith('-sheet'), cell = sheet ? img.width / 4 : img.width;
      let worst = 0;
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
        const cx = x % cell, cy = y % cell;
        if (cx > 1 && cy > 1 && cx < cell - 2 && cy < cell - 2) continue;
        worst = Math.max(worst, img.rgba[(y * img.width + x) * 4 + 3]!);
      }
      expect(worst, `${name}: alpha at its edge`).toBe(0);
    }
  });
});

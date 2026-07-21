// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Conditional field visibility — the Details panel hides fields that are
 *        inert in a component's current state (Camera projection, Light2D type,
 *        ParticleEmitter shape/trail/collision), gated on a sibling discriminator.
 *        Exercised through the builtin registry (no WASM). A rule must hide a field
 *        ONLY when it is meaningless, and bring it back when the discriminator flips.
 */
import { describe, it, expect } from 'vitest';
import { inspectorFields } from '@/engine/schema';

/** The visible field keys the inspector would render for `data`. */
const keys = (comp: string, data: Record<string, unknown>): Set<string> =>
  new Set(inspectorFields(comp, data).map((f) => f.key));

describe('conditional inspector fields', () => {
  describe('Camera projection', () => {
    it('an Orthographic camera shows orthoSize/pixelPerfect and hides fov', () => {
      const k = keys('Camera', { projectionType: 1 });
      expect(k.size).toBeGreaterThan(0); // registry loaded
      expect(k.has('orthoSize')).toBe(true);
      expect(k.has('pixelPerfect')).toBe(true);
      expect(k.has('fov')).toBe(false);
    });
    it('a Perspective camera shows fov and hides orthoSize/pixelPerfect', () => {
      const k = keys('Camera', { projectionType: 0 });
      expect(k.has('fov')).toBe(true);
      expect(k.has('orthoSize')).toBe(false);
      expect(k.has('pixelPerfect')).toBe(false);
    });
  });

  describe('Light2D type', () => {
    it('Point: radius only, no direction / cone angles / directional shadow', () => {
      const k = keys('Light2D', { type: 0 });
      expect(k.has('radius')).toBe(true);
      expect(k.has('direction')).toBe(false);
      expect(k.has('innerAngle')).toBe(false);
      expect(k.has('shadowDistance')).toBe(false);
    });
    it('Directional: direction + directional shadow, no radius / cone angles', () => {
      const k = keys('Light2D', { type: 1 });
      expect(k.has('direction')).toBe(true);
      expect(k.has('shadowDistance')).toBe(true);
      expect(k.has('radius')).toBe(false);
      expect(k.has('outerAngle')).toBe(false);
    });
    it('Ambient: neither reach, aim, cone, nor shadows', () => {
      const k = keys('Light2D', { type: 2 });
      expect(k.has('radius')).toBe(false);
      expect(k.has('direction')).toBe(false);
      expect(k.has('innerAngle')).toBe(false);
      expect(k.has('shadowSoftness')).toBe(false);
      expect(k.has('intensity')).toBe(true); // still tunable
    });
    it('Spot: reach + aim + cone angles, no directional shadow', () => {
      const k = keys('Light2D', { type: 3 });
      expect(k.has('radius')).toBe(true);
      expect(k.has('direction')).toBe(true);
      expect(k.has('innerAngle')).toBe(true);
      expect(k.has('outerAngle')).toBe(true);
      expect(k.has('shadowDistance')).toBe(false);
    });
  });

  describe('ParticleEmitter shape', () => {
    it('Point: no shape geometry fields', () => {
      const k = keys('ParticleEmitter', { shape: 0 });
      expect(k.has('shapeRadius')).toBe(false);
      expect(k.has('shapeSize')).toBe(false);
      expect(k.has('shapeAngle')).toBe(false);
    });
    it('Circle: radius only', () => {
      const k = keys('ParticleEmitter', { shape: 1 });
      expect(k.has('shapeRadius')).toBe(true);
      expect(k.has('shapeSize')).toBe(false);
      expect(k.has('shapeAngle')).toBe(false);
    });
    it('Rectangle: size only', () => {
      const k = keys('ParticleEmitter', { shape: 2 });
      expect(k.has('shapeSize')).toBe(true);
      expect(k.has('shapeRadius')).toBe(false);
      expect(k.has('shapeAngle')).toBe(false);
    });
    it('Cone: radius (reach) + angle, no rectangle size', () => {
      const k = keys('ParticleEmitter', { shape: 3 });
      expect(k.has('shapeRadius')).toBe(true);
      expect(k.has('shapeAngle')).toBe(true);
      expect(k.has('shapeSize')).toBe(false);
    });
  });

  describe('ParticleEmitter trail / collision toggles', () => {
    it('a disabled trail hides its tuning block', () => {
      expect(keys('ParticleEmitter', { trailEnabled: false }).has('trailWidth')).toBe(false);
      expect(keys('ParticleEmitter', { trailEnabled: true }).has('trailWidth')).toBe(true);
    });
    it('disabled floor collision hides its tuning block', () => {
      expect(keys('ParticleEmitter', { collisionEnabled: false }).has('collisionBounce')).toBe(false);
      expect(keys('ParticleEmitter', { collisionEnabled: true }).has('collisionBounce')).toBe(true);
    });
  });

  describe('TilemapLayer orientation (regression)', () => {
    it('an orthogonal layer hides stagger + hex fields', () => {
      const k = keys('TilemapLayer', { orientation: 0 });
      expect(k.has('hexSideLength')).toBe(false);
      expect(k.has('staggerAxis')).toBe(false);
    });
  });
});

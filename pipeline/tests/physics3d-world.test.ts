// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A project says how its 3D world is made — what a scene unit is, gravity, the solver — in Project Settings,
 *        not in code. The settings are read from the project, carried into every packaged build, and become the
 *        config the 3D world is installed with, together with the fixed step and collision matrix 2D also uses.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_PHYSICS3D_WORLD, physics3DInstallConfig } from 'esengine';
import { parseManifest } from '../src/project/format';
import { packagedRuntimeFields, runtimeConfigOf } from '../src/project/runtimeConfig';

const manifest = (physics: Record<string, unknown>) => parseManifest({ formatVersion: '1', name: 'g', features: { physics } });

describe('3D physics world settings', () => {
  it('are the engine\'s own values when the project says nothing, and an untouched project ships no block', () => {
    const rc = runtimeConfigOf(manifest({}));
    expect(rc.physics3dWorld).toEqual(DEFAULT_PHYSICS3D_WORLD);
    expect(packagedRuntimeFields(rc)).not.toHaveProperty('physics3dWorld');
    expect(physics3DInstallConfig(packagedRuntimeFields(rc).physics3dWorld, undefined)).toEqual({});
  });

  it('reach a packaged build and the installed world, a metre scene included', () => {
    const m = manifest({
      fixedTimestep: 1 / 120,
      collisionLayerMasks: [0xfffe, ...Array(15).fill(0xffff)],
      world3d: { unitsPerMeter: 1, gravity: { x: 0, y: -3.7, z: 0 }, collisionSteps: 2, maxBodies: 4096,
                 velocityIterations: 12, positionIterations: 4, enableSleep: false, bounceThreshold: 0.5 },
    });
    const rc = runtimeConfigOf(m);
    const shipped = packagedRuntimeFields(rc);
    expect(shipped.physics3dWorld?.unitsPerMeter).toBe(1);
    const installed = physics3DInstallConfig(shipped.physics3dWorld, shipped.physicsConfig);
    expect(installed).toMatchObject({
      pixelsPerUnit: 1, gravity: { x: 0, y: -3.7, z: 0 }, collisionSteps: 2, maxBodies: 4096,
      velocityIterations: 12, positionIterations: 4, enableSleep: false, bounceThreshold: 0.5,
      fixedTimestep: 1 / 120,
    });
    expect(installed.layerMasks?.[0]).toBe(0xfffe);
  });

  it('drops what the runtime would refuse rather than keep it in the project', () => {
    const m = manifest({ world3d: { unitsPerMeter: 0, gravity: { x: 0, y: 'down', z: 0 }, collisionSteps: 1.5, maxBodies: -4 } });
    expect(m.features?.physics?.world3d).toBeUndefined();
    expect(runtimeConfigOf(m).physics3dWorld).toEqual(DEFAULT_PHYSICS3D_WORLD);
  });
});

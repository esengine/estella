// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Where the editor's eye stands across a 2D/3D toggle.
 *
 * Swapping projection alone is invisible — head-on, a perspective picture of the
 * z = 0 plane IS the orthographic one — so the toggle turns the eye. What that
 * must not cost is the angle you had: an isometric orthographic view is a working
 * mode, and it has to survive going to 3D and back.
 */
import { describe, it, expect } from 'vitest';
import { eyeAcrossProjection, NO_PARKED_EYE, type ParkedEye } from '@/engine/EngineHost';

const HEAD_ON = { yaw: 0, pitch: 0 };

/** Toggle repeatedly, threading the parked angles the way EngineHost does. */
function toggle(steps: boolean[], from = HEAD_ON, parked: ParkedEye = NO_PARKED_EYE) {
  let eye = from;
  let park = parked;
  const seen = [];
  for (const toPerspective of steps) {
    const next = eyeAcrossProjection(toPerspective, eye, park);
    eye = { yaw: next.yaw, pitch: next.pitch };
    park = next.parked;
    seen.push(eye);
  }
  return { eye, parked: park, seen };
}

describe('the editor eye across a projection toggle', () => {
  it('turns the eye when 3D is entered head-on', () => {
    const { eye } = toggle([true]);
    expect(eye).not.toEqual(HEAD_ON);
    expect(eye.pitch).toBeGreaterThan(0);
  });

  it('faces the scene head-on again on the way back', () => {
    expect(toggle([true, false]).eye).toEqual(HEAD_ON);
  });

  it('returns to where 3D was left, not to the default', () => {
    const first = toggle([true]);
    const turned = { yaw: 50, pitch: 40 };
    const back = eyeAcrossProjection(false, turned, first.parked);
    const again = eyeAcrossProjection(true, back, back.parked);
    expect({ yaw: again.yaw, pitch: again.pitch }).toEqual(turned);
    expect(turned).not.toEqual(first.eye);
  });

  it('keeps an isometric 2D view through a round trip', () => {
    const iso = { yaw: 20, pitch: 10 };
    const { eye } = toggle([true, false], iso);
    expect(eye).toEqual(iso);
  });

  it('parks the angle of the projection it leaves, both ways', () => {
    const { parked } = toggle([true], { yaw: 20, pitch: 10 });
    expect(parked.ortho).toEqual({ yaw: 20, pitch: 10 });
    expect(parked.perspective).toBeNull();
  });
});

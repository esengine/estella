// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What the built-in agent is told before it has asked anything.
 *
 *        The prompt is the ONLY guidance that reaches a turn regardless of which
 *        doors the agent happens to use. Guidance that lives solely in the New
 *        Script template reaches a project that scaffolds its systems and nobody
 *        else: three dogfood runs in a row wrote game input against the DOM —
 *        two of them in projects that already had source, one that hand-wrote
 *        its system rather than scaffolding it — and the DOM is exactly what a
 *        mini-game runtime and a native build do not have.
 */
import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT } from '../electron/agent/prompt';

describe('the agent is told where game input comes from', () => {
  it('names the engine resources rather than describing them', () => {
    expect(SYSTEM_PROMPT).toContain('Res(Input)');
    expect(SYSTEM_PROMPT).toContain('CameraView');
    expect(SYSTEM_PROMPT).toMatch(/isMouseButtonPressed/);
    expect(SYSTEM_PROMPT).toMatch(/getWorldMousePosition|screenToWorld/);
  });

  it('says what the DOM route costs, so it reads as a reason and not a rule', () => {
    expect(SYSTEM_PROMPT).toMatch(/document\.querySelector/);
    expect(SYSTEM_PROMPT).toMatch(/no DOM|have no DOM/i);
  });

  it('says the units, because that is the half a caller gets wrong silently', () => {
    // mouseX/mouseY are screen pixels; treating them as world coordinates is a
    // board that responds to clicks nowhere near where they landed.
    expect(SYSTEM_PROMPT).toMatch(/SCREEN pixels/);
  });

  it('points at the way to read an API instead of guessing at it', () => {
    expect(SYSTEM_PROMPT).toMatch(/offset.*limit|limit.*offset/);
  });

  it('names the two front doors, and that the underscore fields are not one', () => {
    // A hand-assembled SystemDef happens to RUN, so nothing complains — it just
    // leaves a project whose systems no tool of ours recognises.
    expect(SYSTEM_PROMPT).toContain('defineSystem');
    expect(SYSTEM_PROMPT).toContain('defineComponent');
    expect(SYSTEM_PROMPT).toContain('addSystemToSchedule');
    expect(SYSTEM_PROMPT).toMatch(/_params.*_fn|_fn.*_params/);
    expect(SYSTEM_PROMPT).toMatch(/not an authoring surface/);
  });

  it('stays one text — it sits in the cached prefix and must not vary per turn', () => {
    expect(typeof SYSTEM_PROMPT).toBe('string');
    expect(SYSTEM_PROMPT).toBe(SYSTEM_PROMPT);
  });
});

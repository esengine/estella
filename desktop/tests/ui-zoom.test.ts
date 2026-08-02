// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  UI zoom: the settings value the View-menu commands and the settings slider
 *        both write. The commands walk a fixed set of stops; the slider is free to
 *        land between them, so stepping has to work from an off-stop value too.
 *        The shell hand-off (window.estella.win.setZoom) is not reachable here — the
 *        suite runs in node, where the bridge is absent and applyUiZoom no-ops.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import '@/settings';
import { useSettings } from '@/store/settingsStore';
import {
  UI_SCALE_SETTING, ZOOM_STEPS, ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT,
  uiZoom, setUiZoom, stepUiZoom, canZoomIn, canZoomOut,
} from '@/layout/uiZoom';
import { commands, formatKeybinding } from '@/commands';
import { chordMatches } from '@/commands/keybinding';

describe('ui zoom', () => {
  beforeEach(() => setUiZoom(ZOOM_DEFAULT));

  it('defaults to 100% and is the registered setting', () => {
    expect(uiZoom()).toBe(ZOOM_DEFAULT);
    expect(useSettings.getState().getValue(UI_SCALE_SETTING)).toBe(ZOOM_DEFAULT);
  });

  it('walks the stops in both directions', () => {
    stepUiZoom(1);
    expect(uiZoom()).toBe(110);
    stepUiZoom(1);
    expect(uiZoom()).toBe(125);
    stepUiZoom(-1);
    expect(uiZoom()).toBe(110);
  });

  it('steps to the neighbouring stop from a value the slider left between two', () => {
    setUiZoom(85);
    stepUiZoom(1);
    expect(uiZoom()).toBe(90);
    setUiZoom(85);
    stepUiZoom(-1);
    expect(uiZoom()).toBe(80);
  });

  it('clamps to the stop range and stops walking at the ends', () => {
    setUiZoom(999);
    expect(uiZoom()).toBe(ZOOM_MAX);
    expect(canZoomIn()).toBe(false);
    stepUiZoom(1);
    expect(uiZoom()).toBe(ZOOM_MAX);

    setUiZoom(10);
    expect(uiZoom()).toBe(ZOOM_MIN);
    expect(canZoomOut()).toBe(false);
    stepUiZoom(-1);
    expect(uiZoom()).toBe(ZOOM_MIN);
  });

  it('exposes zoom as commands, so the palette and rebinding get it for free', () => {
    const ids = commands.all().map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['view.zoomIn', 'view.zoomOut', 'view.zoomReset']));

    setUiZoom(150);
    commands.run('view.zoomReset');
    expect(uiZoom()).toBe(ZOOM_DEFAULT);
    // Reset is a no-op at 100%, so it reads disabled rather than doing nothing.
    expect(commands.get('view.zoomReset')?.isEnabled?.()).toBe(false);
  });

  it('keeps every stop reachable by the 5% slider step', () => {
    expect(ZOOM_STEPS.every((s) => s % 5 === 0)).toBe(true);
  });

  // "The + key" arrives as three different events, and the chord grammar joins on
  // '+' — so the literal key can only be spelled by name. All three must land.
  it('matches every way the zoom-in key arrives', () => {
    const kb = commands.get('view.zoomIn')!.keybinding!;
    const ev = (key: string, shiftKey = false) =>
      ({ key, ctrlKey: true, metaKey: false, altKey: false, shiftKey }) as KeyboardEvent;

    expect(chordMatches(ev('='), kb)).toBe(true); // unshifted =
    expect(chordMatches(ev('+'), kb)).toBe(true); // numpad +
    expect(chordMatches(ev('+', true), kb)).toBe(true); // shift-=
    expect(chordMatches(ev('-'), kb)).toBe(false);
    // The hint shows the unshifted key, not the spelled-out name.
    expect(formatKeybinding(kb)).toMatch(/=$/);
    expect(formatKeybinding('mod+plus')).toMatch(/\+$/);
  });
});

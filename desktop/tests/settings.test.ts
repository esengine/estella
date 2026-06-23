// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Settings registry + store. Importing '@/settings' registers the built-in
 *        sections/settings (side effect); the store resolves defaults, persists
 *        owned values (here: console cap → LogStore), and delegates bound settings
 *        to their live store (editorStore). DOM-effect settings (accent / UI scale)
 *        aren't exercised — the suite runs in a node environment.
 */
import { describe, it, expect } from 'vitest';
import '@/settings';
import { settingsRegistry } from '@/settings/registry';
import { useSettings } from '@/store/settingsStore';
import { useEditorStore } from '@/store/editorStore';
import { LogStore } from '@/store/LogStore';
import { commands } from '@/commands';

describe('settings registry', () => {
  it('registers the editor sections', () => {
    const ids = settingsRegistry.allSections().map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['appearance', 'viewport', 'shortcuts', 'console']));
  });

  it('groups sections by category for the nav', () => {
    const editor = settingsRegistry.sectionsByCategory().find((c) => c.category === 'editor');
    expect(editor?.sections.length).toBeGreaterThan(0);
  });

  it('generates read-only keybinding rows from the command registry', () => {
    const rows = settingsRegistry.settingsForSection('shortcuts');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((s) => s.type === 'keybinding')).toBe(true);
  });

  it('registers the collision-layers list setting (16 slots, Default at 0)', () => {
    const s = settingsRegistry.get('project.physics.collisionLayers');
    expect(s?.type).toBe('stringList');
    expect((s?.default as string[]).length).toBe(16);
    expect((s?.default as string[])[0]).toBe('Default');
    // A list setting at its default reads unchanged (compared by value, not reference).
    expect(useSettings.getState().isChanged('project.physics.collisionLayers')).toBe(false);
  });
});

describe('settings store', () => {
  it('getValue returns the registered default', () => {
    expect(useSettings.getState().getValue('console.maxLines')).toBe(2000);
  });

  it('an owned setting persists its value, pushes its effect, and resets', () => {
    const s = useSettings.getState();
    s.setValue('console.maxLines', 500);
    expect(s.getValue('console.maxLines')).toBe(500);
    expect(s.isChanged('console.maxLines')).toBe(true);
    expect(LogStore.getCap()).toBe(500); // effect ran
    s.reset('console.maxLines');
    expect(s.getValue('console.maxLines')).toBe(2000);
    expect(s.isChanged('console.maxLines')).toBe(false);
  });

  it('a bound setting delegates get/set to its live store', () => {
    const s = useSettings.getState();
    useEditorStore.setState({ showGrid: true });
    expect(s.getValue('viewport.showGrid')).toBe(true);
    s.setValue('viewport.showGrid', false);
    expect(useEditorStore.getState().showGrid).toBe(false);
    expect(s.getValue('viewport.showGrid')).toBe(false);
  });

  it('a keybinding setting rebinds the command and reset clears the override', () => {
    const s = useSettings.getState();
    s.setValue('shortcut.tool.move', 'x');
    expect(commands.keybindingFor('tool.move')).toBe('x');
    expect(commands.hasOverride('tool.move')).toBe(true);
    s.reset('shortcut.tool.move'); // → default 'w', clears override
    expect(commands.hasOverride('tool.move')).toBe(false);
    expect(commands.keybindingFor('tool.move')).toBe('w');
  });
});

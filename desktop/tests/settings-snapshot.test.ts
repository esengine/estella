// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a settings row is allowed to subscribe to.
 *
 *        Every zustand selector is a useSyncExternalStore snapshot, so it must
 *        not change between two reads of an unchanged value. A getter handing
 *        back fresh OBJECTS never compares equal under a shallow check, and the
 *        row re-renders until React tears the whole tree down (#185) — which is
 *        what a non-empty objectList did, invisibly, while every such list in
 *        the editor happened to be empty.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, afterEach } from 'vitest';
import '@/settings';
import { settingsRegistry } from '@/settings/registry';
import { useSettings } from '@/store/settingsStore';
import { ProjectStore } from '@/project/ProjectStore';

const read = (id: string) => useSettings.getState().getValue(id);
const shallowEqual = (a: unknown, b: unknown): boolean => {
  if (!Array.isArray(a) || !Array.isArray(b)) return Object.is(a, b);
  return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
};

describe('every registered setting', () => {
  const real = { packaging: ProjectStore.packagingSettings, presets: ProjectStore.screenPresets };
  afterEach(() => {
    ProjectStore.packagingSettings = real.packaging;
    ProjectStore.screenPresets = real.presets;
  });

  it('reads a snapshot that is stable across two calls', () => {
    // The project-bound lists are stood up NON-EMPTY, or this passes on `[]`
    // comparing equal to itself and says nothing about the case that broke.
    ProjectStore.packagingSettings = () => ({ achievements: ['FIRST_BLOOD'] });
    ProjectStore.screenPresets = () => ([{ id: 'phone', label: 'Phone', width: 1080, height: 1920 }]);
    for (const id of ['project.packaging.achievements', 'project.display.screenPresets']) {
      expect((read(id) as unknown[]).length).toBeGreaterThan(0);
    }
    for (const s of settingsRegistry.all()) {
      const a = read(s.id);
      const b = read(s.id);
      // Rows of objects are exempt and read through their serialized form
      // instead — see the objectList control. Everything else has to be stable
      // as-is, because that is what its control subscribes to.
      if (s.type === 'objectList') expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      else expect(shallowEqual(a, b)).toBe(true);
    }
  });
});

describe('a non-empty list of rows', () => {
  const real = ProjectStore.packagingSettings;
  afterEach(() => { ProjectStore.packagingSettings = real; });

  it('is not shallow-stable, which is why it is not read that way', () => {
    // The pairing that matters: were this list read with a shallow comparison —
    // as every other list setting is — it would report a change on every render
    // forever. The serialized read is what makes it a usable snapshot.
    ProjectStore.packagingSettings = () => ({ achievements: ['FIRST_BLOOD'] });
    const id = 'project.packaging.achievements';
    expect(read(id)).toEqual([{ id: 'FIRST_BLOOD' }]);
    expect(shallowEqual(read(id), read(id))).toBe(false);
    expect(JSON.stringify(read(id))).toBe(JSON.stringify(read(id)));
  });

  it('is read by a control that does not compare it shallowly', () => {
    // No node test can render the rule, so it is checked where it is written.
    // Both halves count: the row control must not read shallowly, and Control
    // must not take a read on behalf of every type.
    const src = readFileSync(new URL('../src/components/SettingsRow.tsx', import.meta.url), 'utf8');
    const body = (name: string) => {
      const from = src.indexOf(`function ${name}(`);
      expect(from).toBeGreaterThan(-1);
      return src.slice(from, src.indexOf('\n}\n', from));
    };
    expect(body('ObjectListControl')).not.toContain('useSettings(useShallow');
    expect(body('ObjectListControl')).toContain('JSON.stringify');
    expect(body('Control')).not.toContain('useSettings(');
  });
});

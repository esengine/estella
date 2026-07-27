// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// A double-click that silently does nothing was the bug these cover. Two ways it
// comes back: a type that names no program (so it falls off the end of the table),
// and a type that names one nobody registered (so it resolves to "unset" forever
// and looks exactly like a user who never configured anything).
import { describe, it, expect } from 'vitest';
import { externalPrograms, programSettingId } from '@/project/externalPrograms';
import { settingsRegistry } from '@/settings/registry';
import { ASSET_TYPES } from '@/project/assetTypes';
import { ASSET_OPEN } from '@/project/assetOpen';
import type { AssetType } from '@/types';

describe('the external program registry', () => {
  it('gives every slot a setting to fill it', () => {
    for (const program of externalPrograms.all()) {
      const setting = settingsRegistry.get(programSettingId(program.id));
      expect(setting, `no setting for slot ${program.id}`).toBeDefined();
      expect(setting?.type).toBe('path');
      // An absolute program path is true of ONE machine. In project scope it would
      // be committed and then be wrong for everyone else who opened the project.
      expect(setting?.scope).toBe('editor');
      expect(setting?.section).toBe('externalTools');
    }
  });

  it('registers and retracts a slot and its setting together', () => {
    const id = 'test.diff';
    const disposable = externalPrograms.register({ id, label: 'Diff tool' }, 'test-owner');
    expect(externalPrograms.get(id)).toBeDefined();
    expect(settingsRegistry.get(programSettingId(id))).toBeDefined();

    disposable.dispose();
    expect(externalPrograms.get(id)).toBeUndefined();
    // The half that used to be easy to forget: a setting nobody reads, left in the
    // dialog by a plugin that unloaded.
    expect(settingsRegistry.get(programSettingId(id))).toBeUndefined();
  });

  it('reports an unconfigured slot as empty, not undefined', () => {
    // '' is what the open chain reads as "use the OS default" — an undefined here
    // would reach launchProgram as the string "undefined".
    expect(externalPrograms.pathFor('script')).toBe('');
    expect(externalPrograms.pathFor('no-such-slot')).toBe('');
  });
});

describe('what opens each asset type', () => {
  const types = Object.entries(ASSET_TYPES) as [AssetType, (typeof ASSET_TYPES)[keyof typeof ASSET_TYPES]][];

  it('never names a program slot that does not exist', () => {
    for (const [type, def] of types) {
      if (!def.externalProgram) continue;
      expect(externalPrograms.get(def.externalProgram), `${type} names an unregistered slot`).toBeDefined();
    }
  });

  it('hands source and images to an outside program, having no editor for them', () => {
    // The reported bug, as an assertion: `script` had neither an entry in
    // ASSET_OPEN nor a program, so double-clicking a .ts did nothing at all.
    for (const type of ['script', 'shader', 'texture', 'sprite'] as const) {
      expect(ASSET_OPEN[type], `${type} unexpectedly grew an internal editor`).toBeUndefined();
      expect(ASSET_TYPES[type].externalProgram, `${type} opens nothing`).toBeTruthy();
    }
  });
});

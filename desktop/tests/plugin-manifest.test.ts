// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  plugin.json validation + the `engines.editor` range check. Both are the
 *        gate between "a folder the user wrote" and "code the editor runs", so the
 *        rules that matter here are: a bad manifest is NAMED not dropped, and an
 *        unreadable version range is refused rather than guessed at.
 */
import { describe, it, expect } from 'vitest';
import { validateManifest, satisfiesEditorRange, resolveLocalized } from '@/plugins/manifest';

const ok = (raw: unknown) => {
  const r = validateManifest(raw);
  if ('error' in r) throw new Error(`expected valid, got: ${r.error}`);
  return r.manifest;
};
const err = (raw: unknown): string => {
  const r = validateManifest(raw);
  if (!('error' in r)) throw new Error('expected an error');
  return r.error;
};

const base = {
  id: 'acme.tools',
  name: 'Acme Tools',
  version: '1.0.0',
  main: { editor: 'src/editor.ts' },
};

describe('validateManifest', () => {
  it('accepts a minimal manifest', () => {
    expect(ok(base).id).toBe('acme.tools');
  });

  it('accepts localized name + description', () => {
    const m = ok({ ...base, name: { en: 'Acme', 'zh-CN': '顶针' }, description: { en: 'd' } });
    expect(resolveLocalized(m.name, 'zh-CN')).toBe('顶针');
    expect(resolveLocalized(m.name, 'de')).toBe('Acme'); // falls back to en
  });

  it('requires a dotted lowercase id', () => {
    expect(err({ ...base, id: 'Tools' })).toMatch(/dotted, lowercase/);
    expect(err({ ...base, id: 'tools' })).toMatch(/dotted, lowercase/); // needs a namespace
    expect(err({ ...base, id: 'acme..tools' })).toMatch(/dotted, lowercase/);
    expect(ok({ ...base, id: 'acme.level-tools.extra' }).id).toBe('acme.level-tools.extra');
  });

  it('requires a name, a semver version, and an entry point', () => {
    expect(err({ ...base, name: '' })).toMatch(/`name`/);
    expect(err({ ...base, name: { zh: 'x' } })).toMatch(/`en` string/);
    expect(err({ ...base, version: '1.0' })).toMatch(/`version`/);
    expect(err({ ...base, main: {} })).toMatch(/no entry point/);
    expect(err({ ...base, main: { editor: 42 } })).toMatch(/`main.editor`/);
  });

  it('refuses an entry that escapes the plugin folder', () => {
    expect(err({ ...base, main: { editor: '../../elsewhere.ts' } })).toMatch(/stay inside/);
  });

  it('rejects an unknown capability by name', () => {
    expect(err({ ...base, capabilities: ['fs:project', 'gpu'] })).toMatch(/unknown capability "gpu"/);
    expect(ok({ ...base, capabilities: ['fs:project', 'net'] }).capabilities).toEqual(['fs:project', 'net']);
  });

  it('reports a non-object manifest instead of throwing', () => {
    expect(err(null)).toMatch(/JSON object/);
    expect(err('nope')).toMatch(/JSON object/);
    expect(err([])).toMatch(/`id`/); // an array is an object, so it fails on id
  });
});

describe('satisfiesEditorRange', () => {
  it('accepts * always', () => {
    expect(satisfiesEditorRange('0.33.0', '*').ok).toBe(true);
  });

  it('treats MINOR as the breaking axis below 1.0 (npm caret semantics)', () => {
    // The editor is pre-1.0, so ^0.33 must NOT match 0.34 — that's exactly the
    // case where a plugin written against an older API would silently load.
    expect(satisfiesEditorRange('0.33.0', '^0.33').ok).toBe(true);
    expect(satisfiesEditorRange('0.33.7', '^0.33').ok).toBe(true);
    expect(satisfiesEditorRange('0.34.0', '^0.33').ok).toBe(false);
    expect(satisfiesEditorRange('0.32.9', '^0.33').ok).toBe(false);
  });

  it('treats MAJOR as the breaking axis at 1.0 and above', () => {
    expect(satisfiesEditorRange('1.4.0', '^1.2').ok).toBe(true);
    expect(satisfiesEditorRange('2.0.0', '^1.2').ok).toBe(false);
  });

  it('supports >= and exact', () => {
    expect(satisfiesEditorRange('0.34.0', '>=0.33').ok).toBe(true);
    expect(satisfiesEditorRange('0.32.0', '>=0.33').ok).toBe(false);
    expect(satisfiesEditorRange('0.33.0', '0.33.0').ok).toBe(true);
    expect(satisfiesEditorRange('0.33.1', '0.33.0').ok).toBe(false);
  });

  it('refuses a range it cannot read rather than guessing', () => {
    // Guessing at "~0.33" or "0.33.x" would load a plugin against an API it was
    // not written for; saying so is the only safe answer.
    const r = satisfiesEditorRange('0.33.0', '~0.33');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/cannot read version range/);
  });

  it('explains itself when it says no', () => {
    const r = satisfiesEditorRange('0.34.0', '^0.33');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('needs editor ^0.33, running 0.34.0');
  });
});

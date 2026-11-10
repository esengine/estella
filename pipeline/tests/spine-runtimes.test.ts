// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Which Spine runtimes a package carries. A mini-game, a playable or an
 *        Android package pays for every runtime it carries, and a skeleton whose
 *        runtime was left out does not play: too many and the package is over
 *        its cap, too few and it does not run. One decision serves every target
 *        (resolveSpineRuntimes); these hold it to the skeleton files themselves
 *        and to the project's per-runtime choice.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  planSideModules, resolveSpineRuntimes, spineRefusalMessage,
} from '../src/bundle/sideModuleScan';
import { spineChoiceKey } from '../src/project/format';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TP = path.join(HERE, '..', '..', 'third_party');

/** Real exports from the vendored runtimes' own examples: the version is read
 *  from the bytes, so a fixture that only claimed one would prove nothing. */
const SKELETONS: Record<string, string> = {
  '3.8': path.join(TP, 'spine-runtimes-3.8', 'examples', 'spineboy', 'export', 'spineboy-pro.skel'),
  '4.2': path.join(TP, 'spine-runtimes-4.2', 'examples', 'spineboy', 'export', 'spineboy-pro.skel'),
};

let staged: string;
beforeAll(() => {
  staged = mkdtempSync(path.join(tmpdir(), 'estella-spine-rt-'));
  for (const [v, file] of Object.entries(SKELETONS)) copyFileSync(file, path.join(staged, `hero${v}.skel`));
});
afterAll(() => rmSync(staged, { recursive: true, force: true }));

const entries = (...versions: string[]) =>
  versions.map((v) => ({ path: `hero${v}.skel`, sourcePath: `assets/hero${v}.skel`, type: 'spine' }));

function plan(versions: string[], choices: Record<string, 'auto' | 'include' | 'exclude'> = {}) {
  return planSideModules({ root: staged, includedPaths: [], cookEntries: entries(...versions), stagedDir: staged, choices });
}

describe('the Spine runtimes a package carries', () => {
  it('carries exactly the runtimes its skeletons were exported from', async () => {
    const p = await plan(['3.8', '4.2']);
    expect([...p.ids].filter((id) => id.startsWith('spine:')).sort()).toEqual(['spine:3.8', 'spine:4.2']);
    expect(p.spine.versions).toEqual(['3.8', '4.2']);
    expect(p.spine.decisions.find((d) => d.version === '3.8')).toMatchObject({
      ships: true, why: 'detected', skeletons: ['assets/hero3.8.skel'],
    });
    expect(p.spine.decisions.find((d) => d.version === '4.1')).toMatchObject({ ships: false, why: 'unused' });
  });

  it('carries no runtime for a package with no skeletons', async () => {
    const p = await plan([]);
    expect([...p.ids].some((id) => id.startsWith('spine:'))).toBe(false);
  });

  // A skeleton a script loads by a path it builds at run time leaves nothing for
  // the cook to see: the project says so, and the runtime ships.
  it('carries a runtime the project includes for skeletons only code loads', async () => {
    const p = await plan(['4.2'], { [spineChoiceKey('3.8')]: 'include' });
    expect(p.spine.versions).toEqual(['3.8', '4.2']);
    expect(p.spine.decisions.find((d) => d.version === '3.8')).toMatchObject({ ships: true, why: 'included' });
  });

  it('leaves out an unused runtime the project excludes, and says why', async () => {
    const p = await plan(['4.2'], { [spineChoiceKey('3.8')]: 'exclude' });
    expect(p.spine.versions).toEqual(['4.2']);
    expect(p.spine.refused).toEqual([]);
    expect(p.spine.decisions.find((d) => d.version === '3.8')).toMatchObject({ ships: false, why: 'excluded' });
  });

  // Too few is the failure that only a device shows: refuse the export instead,
  // naming the skeletons that would not play.
  it('refuses an excluded runtime that a shipped skeleton needs', async () => {
    const p = await plan(['3.8', '4.2'], { [spineChoiceKey('3.8')]: 'exclude' });
    expect(p.spine.versions).toEqual(['4.2']);
    expect(p.spine.refused).toEqual([{ version: '3.8', skeletons: ['assets/hero3.8.skel'] }]);
    const message = spineRefusalMessage(p.spine.refused[0]);
    expect(message).toContain('esengine/spine@3.8 is excluded');
    expect(message).toContain('assets/hero3.8.skel');
  });

  it('carries nothing when the whole Spine module is excluded, leaving the refusal to the module', () => {
    const r = resolveSpineRuntimes(new Map([['4.2', ['a.skel']]]), { 'esengine/spine': 'exclude' });
    expect(r.versions).toEqual([]);
    expect(r.refused).toEqual([]);
  });
});

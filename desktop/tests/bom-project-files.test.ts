// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A byte-order mark is an encoding hint, not content.
 *
 * Every Windows tool that touches a file can leave one — Notepad, PowerShell's
 * `Out-File`, an editor with "UTF-8 with BOM" selected — and `JSON.parse` calls
 * it a syntax error. A project whose manifest had been edited that way failed to
 * open with `Unexpected token '﻿'` and nothing naming the file, which reads
 * as "the editor cannot open my project". Caught by a dogfood run whose fixture
 * PowerShell happened to write.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readManifest, openProject, readInRoot, readOptionalInRoot } from '../electron/projectFs';

const BOM = '﻿';
let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-bom-'));
  mkdirSync(path.join(root, 'assets', 'scenes'), { recursive: true });
  mkdirSync(path.join(root, '.esengine'), { recursive: true });
  writeFileSync(path.join(root, 'project.esproject'),
    BOM + JSON.stringify({ formatVersion: '1', name: 'Bommed', defaultScene: 'assets/scenes/main.esscene' }));
  writeFileSync(path.join(root, '.esengine', 'workspace.json'),
    BOM + JSON.stringify({ lastOpenedScene: 'assets/scenes/main.esscene' }));
  writeFileSync(path.join(root, 'assets', 'scenes', 'main.esscene'),
    BOM + JSON.stringify({ version: '1.0', name: 'Main', entities: [] }));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('project files written with a BOM', () => {
  it('opens a manifest that carries one', async () => {
    const manifest = await readManifest(root);
    expect(manifest.name).toBe('Bommed');
  });

  it('opens the project, workspace and all', async () => {
    const opened = await openProject(root);
    expect(opened.manifest.name).toBe('Bommed');
    expect(opened.workspace.lastOpenedScene).toBe('assets/scenes/main.esscene');
  });

  // The renderer reads every scene, material and prefab through this door, so
  // one strip here is what keeps a BOM out of every parse downstream.
  it('hands a scene to the renderer without it', async () => {
    const text = await readInRoot(root, 'assets/scenes/main.esscene');
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(JSON.parse(text).name).toBe('Main');
    const optional = await readOptionalInRoot(root, 'assets/scenes/main.esscene');
    expect(optional?.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('leaves a file that has no BOM exactly as it is', async () => {
    writeFileSync(path.join(root, 'plain.txt'), 'no mark here');
    expect(await readInRoot(root, 'plain.txt')).toBe('no mark here');
  });
});

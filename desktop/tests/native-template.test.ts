// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The runtime-template store. A native app's compiled half ships as an artifact
// rather than being rebuilt on every user's machine, so what is pinned here is the
// contract between the emitter and the editor:
//
//   1. A template is matched EXACTLY on version — the SDK bundle is compiled into
//      the app binary, so a near-miss fails on a device instead of in the dialog.
//   2. An archive is untrusted input, and an incomplete one must not replace a
//      working install.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  resolveNativeTemplate, iosSourcesFromTemplate, installNativeTemplate,
  listNativeTemplates, removeNativeTemplate,
} from '../electron/nativeTemplates';
import { listPlatforms } from '../electron/platformCatalog';
import {
  requiredTemplateFiles, installedTemplateDir, TEMPLATE_FORMAT, TEMPLATE_MANIFEST,
} from '../../build-tools/utils/nativeTemplate.js';
import { makeZip } from '../../build-tools/utils/zip.js';

const VERSION = '9.9.9';

let store: string;
let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'es-tmpl-'));
  store = path.join(scratch, 'templates');
  process.env.ESTELLA_NATIVE_TEMPLATES = store;
});

afterEach(() => {
  delete process.env.ESTELLA_NATIVE_TEMPLATES;
  rmSync(scratch, { recursive: true, force: true });
});

/** Every file the layout declares required, with a stand-in body — so the fixture
 *  follows the contract rather than a copy of it that can go stale. */
function templateEntries(version: string, omit?: string): { name: string; data: Buffer }[] {
  const entries = requiredTemplateFiles('ios')
    .filter((rel) => rel !== omit)
    .map((rel) => ({ name: rel, data: Buffer.from(`stand-in for ${rel}`) }));
  entries.push({
    name: TEMPLATE_MANIFEST,
    data: Buffer.from(JSON.stringify({
      kind: 'estella-native-template',
      formatVersion: TEMPLATE_FORMAT,
      id: 'ios-arm64',
      platform: 'ios',
      abi: 'arm64',
      engineVersion: version,
      spineVersion: '4.2',
      deploymentTarget: '17.0',
    })),
  });
  return entries;
}

function writeTemplateZip(version: string, omit?: string): string {
  const file = path.join(scratch, `template-${version}.zip`);
  writeFileSync(file, makeZip(templateEntries(version, omit)));
  return file;
}

describe('installing a runtime template', () => {
  it('installs an archive and makes the platform resolvable', () => {
    expect(resolveNativeTemplate('ios', VERSION)).toBeNull();

    const res = installNativeTemplate(writeTemplateZip(VERSION), VERSION);

    expect(res.ok).toBe(true);
    expect(res.versionMismatch).toBe(false);
    expect(res.dir).toBe(installedTemplateDir(VERSION, 'ios', 'arm64', store));

    const resolved = resolveNativeTemplate('ios', VERSION);
    expect(resolved?.manifest.engineVersion).toBe(VERSION);
    const sources = iosSourcesFromTemplate(VERSION)!;
    expect(existsSync(sources.xcframework)).toBe(true);
    expect(existsSync(sources.mainM)).toBe(true);
    expect(existsSync(sources.infoPlistIn)).toBe(true);
  });

  it('stores a template built for another release, but does not offer it', () => {
    const res = installNativeTemplate(writeTemplateZip('1.0.0'), VERSION);

    expect(res.ok).toBe(true);
    // Named, so the dialog can say which version the archive was for.
    expect(res.versionMismatch).toBe(true);
    expect(res.engineVersion).toBe('1.0.0');
    expect(resolveNativeTemplate('ios', VERSION)).toBeNull();
    expect(listNativeTemplates(VERSION)).toEqual([
      expect.objectContaining({ id: 'ios-arm64', engineVersion: '1.0.0', current: false }),
    ]);
  });

  it('rejects an incomplete archive, and leaves the installed one alone', () => {
    installNativeTemplate(writeTemplateZip(VERSION), VERSION);

    const res = installNativeTemplate(writeTemplateZip(VERSION, 'App/main.m'), VERSION);

    expect(res.ok).toBe(false);
    expect(res.error).toContain('App/main.m');
    // The working install survived the bad one.
    expect(resolveNativeTemplate('ios', VERSION)).not.toBeNull();
  });

  it('rejects an archive that is not a template at all', () => {
    const file = path.join(scratch, 'random.zip');
    writeFileSync(file, makeZip([{ name: 'readme.txt', data: Buffer.from('hi') }]));

    expect(installNativeTemplate(file, VERSION).error).toContain('template.json');
  });

  it('refuses an archive that would write outside the store', () => {
    const file = path.join(scratch, 'evil.zip');
    writeFileSync(file, makeZip([{ name: '../escaped.txt', data: Buffer.from('x') }]));

    expect(installNativeTemplate(file, VERSION).error).toContain('unsafe');
    expect(existsSync(path.join(scratch, 'escaped.txt'))).toBe(false);
  });

  it('treats a half-deleted install as absent rather than usable', () => {
    installNativeTemplate(writeTemplateZip(VERSION), VERSION);
    rmSync(path.join(installedTemplateDir(VERSION, 'ios', 'arm64', store), 'App', 'main.m'));

    expect(resolveNativeTemplate('ios', VERSION)).toBeNull();
  });

  it('removes an installed template', () => {
    installNativeTemplate(writeTemplateZip(VERSION), VERSION);

    expect(removeNativeTemplate('ios', 'arm64', VERSION)).toBe(true);
    expect(resolveNativeTemplate('ios', VERSION)).toBeNull();
    expect(removeNativeTemplate('ios', 'arm64', VERSION)).toBe(false);
  });
});

describe('the iOS row reports what is missing', () => {
  const dirs = () => ({ web: path.join(scratch, 'web'), wechat: path.join(scratch, 'wx') });
  const iosRow = async () => (await listPlatforms(null, dirs(), VERSION)).find((r) => r.id === 'ios')!;

  it('asks for the runtime template before anything about Xcode', async () => {
    const row = await iosRow();

    expect(row.ready).toBe(false);
    expect(row.prereq).toEqual({ kind: 'template-missing', id: 'ios-arm64', version: VERSION });
  });

  it('moves on to the toolchain once a template is installed', async () => {
    installNativeTemplate(writeTemplateZip(VERSION), VERSION);

    const row = await iosRow();

    // On a Mac with Xcode that is everything; elsewhere the toolchain is the
    // remaining gap — and the export still writes a project to carry to a Mac.
    if (row.ready) expect(row.prereq).toBeUndefined();
    else expect(row.prereq?.kind).toBe('toolchain-missing');
  });
});

describe('the template layout is the one source of filenames', () => {
  it('assembles the iOS project from paths inside the installed template', () => {
    installNativeTemplate(writeTemplateZip(VERSION), VERSION);
    const dir = installedTemplateDir(VERSION, 'ios', 'arm64', store);

    const sources = iosSourcesFromTemplate(VERSION)!;

    expect(sources.xcframework).toBe(path.join(dir, 'Estella.xcframework'));
    expect(sources.mainM).toBe(path.join(dir, 'App', 'main.m'));
    expect(sources.infoPlistIn).toBe(path.join(dir, 'App', 'Info.plist.in'));
    // And each is something the emitter is required to have written.
    const required = requiredTemplateFiles('ios');
    for (const file of Object.values(sources)) {
      expect(required).toContain(path.relative(dir, file).split(path.sep).join('/'));
    }
  });
});

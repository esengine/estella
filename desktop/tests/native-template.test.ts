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
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  resolveNativeTemplate, iosSourcesFromTemplate, installNativeTemplate,
  listNativeTemplates, removeNativeTemplate, downloadNativeTemplate,
} from '../electron/nativeTemplates';
import { listPlatforms } from '../electron/platformCatalog';
import {
  requiredTemplateFiles, templateLayout, installedTemplateDir, parseTemplateIndex,
  missingTemplateEntries, TEMPLATE_FORMAT, TEMPLATE_MANIFEST, TEMPLATE_INDEX,
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
      id: 'ios',
      platform: 'ios',
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
    expect(res.dir).toBe(installedTemplateDir(VERSION, 'ios', store));

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
      expect.objectContaining({ id: 'ios', engineVersion: '1.0.0', current: false }),
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
    rmSync(path.join(installedTemplateDir(VERSION, 'ios', store), 'App', 'main.m'));

    expect(resolveNativeTemplate('ios', VERSION)).toBeNull();
  });

  it('removes an installed template', () => {
    installNativeTemplate(writeTemplateZip(VERSION), VERSION);

    expect(removeNativeTemplate('ios', VERSION)).toBe(true);
    expect(resolveNativeTemplate('ios', VERSION)).toBeNull();
    expect(removeNativeTemplate('ios', VERSION)).toBe(false);
  });
});

describe('downloading a template from a release', () => {
  /** A stand-in release: the published index plus the archive it describes. */
  function release(overrides: { sha256?: string; bytes?: number; templates?: unknown[] } = {}) {
    const zip = readFileSync(writeTemplateZip(VERSION));
    const index = {
      kind: 'estella-native-templates',
      formatVersion: TEMPLATE_FORMAT,
      engineVersion: VERSION,
      templates: overrides.templates ?? [{
        id: 'ios', platform: 'ios',
        file: `estella-native-ios-${VERSION}.zip`,
        bytes: overrides.bytes ?? zip.length,
        sha256: overrides.sha256 ?? createHash('sha256').update(zip).digest('hex'),
      }],
    };
    const served: string[] = [];
    const fetchImpl = (async (url: string) => {
      served.push(url);
      if (url.endsWith(TEMPLATE_INDEX)) {
        return { ok: true, status: 200, json: async () => index } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        // Two chunks, so progress is reported more than once.
        body: (async function* () {
          yield zip.subarray(0, 100);
          yield zip.subarray(100);
        })(),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    return { fetchImpl, served, zip };
  }

  it('installs what the index describes, and reports progress on the way', async () => {
    const { fetchImpl, served, zip } = release();
    const progress: number[] = [];

    const res = await downloadNativeTemplate('ios', VERSION, {
      fetchImpl, baseUrl: 'https://example.test/r', onProgress: (p) => progress.push(p.received),
    });

    expect(res).toMatchObject({ ok: true, id: 'ios', versionMismatch: false });
    expect(resolveNativeTemplate('ios', VERSION)).not.toBeNull();
    expect(served).toEqual([
      `https://example.test/r/${TEMPLATE_INDEX}`,
      `https://example.test/r/estella-native-ios-${VERSION}.zip`,
    ]);
    expect(progress).toEqual([100, zip.length]);
  });

  it('refuses an archive whose checksum does not match the index', async () => {
    const { fetchImpl } = release({ sha256: 'f'.repeat(64) });

    const res = await downloadNativeTemplate('ios', VERSION, { fetchImpl, baseUrl: 'https://example.test/r' });

    expect(res.ok).toBe(false);
    expect(res.error).toContain('checksum mismatch');
    expect(resolveNativeTemplate('ios', VERSION)).toBeNull();
  });

  it('refuses a truncated download before it is unpacked', async () => {
    const { fetchImpl } = release({ bytes: 999_999 });

    const res = await downloadNativeTemplate('ios', VERSION, { fetchImpl, baseUrl: 'https://example.test/r' });

    expect(res.error).toContain('999999');
    expect(resolveNativeTemplate('ios', VERSION)).toBeNull();
  });

  it('says so when this version publishes no template for the platform', async () => {
    const { fetchImpl } = release();

    const res = await downloadNativeTemplate('android', VERSION, { fetchImpl, baseUrl: 'https://example.test/r' });

    expect(res.error).toContain('no android template');
  });

  it('treats an unreadable index as no index — a 404 page is not a template list', async () => {
    const fetchImpl = (async () => ({
      ok: true, status: 200, json: async () => ({ error: 'Not Found' }),
    } as unknown as Response)) as unknown as typeof fetch;

    const res = await downloadNativeTemplate('ios', VERSION, { fetchImpl, baseUrl: 'https://example.test/r' });

    expect(res.error).toContain('not readable');
  });

  it('rejects an index published for another version', () => {
    expect(parseTemplateIndex({
      kind: 'estella-native-templates', formatVersion: TEMPLATE_FORMAT, engineVersion: '1.0.0',
      templates: [{ id: 'ios', platform: 'ios', file: 'x.zip', bytes: 1, sha256: 'a'.repeat(64) }],
    }, VERSION)).toBeNull();
  });

  it('drops an entry whose filename could escape the download directory', () => {
    expect(parseTemplateIndex({
      kind: 'estella-native-templates', formatVersion: TEMPLATE_FORMAT, engineVersion: VERSION,
      templates: [{ id: 'ios', platform: 'ios', file: '../evil.zip', bytes: 1, sha256: 'a'.repeat(64) }],
    }, VERSION)).toBeNull();
  });
});

describe('the iOS row reports what is missing', () => {
  const dirs = () => ({ web: path.join(scratch, 'web'), wechat: path.join(scratch, 'wx') });
  const iosRow = async () => (await listPlatforms(null, dirs(), VERSION)).find((r) => r.id === 'ios')!;

  it('asks for the runtime template before anything about Xcode', async () => {
    const row = await iosRow();

    expect(row.ready).toBe(false);
    expect(row.prereq).toEqual({ kind: 'template-missing', id: 'ios', version: VERSION });
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
    const dir = installedTemplateDir(VERSION, 'ios', store);

    const sources = iosSourcesFromTemplate(VERSION)!;

    expect(sources.xcframework).toBe(path.join(dir, 'Estella.xcframework'));
    expect(sources.mainM).toBe(path.join(dir, 'App', 'main.m'));
    expect(sources.infoPlistIn).toBe(path.join(dir, 'App', 'Info.plist.in'));
    // And every one of them is a file the layout declares — including the
    // bytecode, which is optional (a build machine without a host compiler ships a
    // template without it, and the app compiles on first launch instead).
    const declared = templateLayout('ios').map((e) => e.rel);
    for (const file of Object.values(sources)) {
      expect(declared).toContain(path.relative(dir, file).split(path.sep).join('/'));
    }
    expect(requiredTemplateFiles('ios')).not.toContain(
      path.relative(dir, sources.bytecode).split(path.sep).join('/'));
  });
});

describe('what a PUBLISHED template must carry', () => {
  // The bytecode is optional for a local build and not for a release, and reading
  // "optional" as one answer to both is what let v0.36.0 ship an Android template
  // without it — every game packaged from that template opened on a black screen
  // while the host compiled the bundle on the device.
  const BYTECODE = 'assets/esengine.native.qjsbc';

  // What v0.36.0 actually published, minus the bytecode: complete by the rule a
  // contributor's build is held to.
  const shipped = (extra: string[] = []) => [
    'AndroidManifest.xml.in', 'classes.dex', 'icon.png',
    'java/com/estella/host/TextEditor.java',
    'lib/arm64-v8a/libestella_js_host.so', 'lib/arm64-v8a/libwebgpu_dawn.so',
    'lib/arm64-v8a/libc++_shared.so',
    'lib/x86_64/libestella_js_host.so', 'lib/x86_64/libwebgpu_dawn.so',
    'lib/x86_64/libc++_shared.so',
    'template.json', ...extra,
  ];

  it('accepts a template without bytecode, and refuses to publish it', () => {
    expect(missingTemplateEntries(shipped(), 'android')).toEqual([]);
    expect(missingTemplateEntries(shipped(), 'android', { release: true })).toEqual([BYTECODE]);
    expect(missingTemplateEntries(shipped([BYTECODE]), 'android', { release: true })).toEqual([]);
  });

  it('holds a release to every ABI the template claims', () => {
    // One ABI is a usable template; a release builds both, and losing the emulator
    // one leaves everybody without a phone unable to run the game at all.
    const oneAbi = shipped([BYTECODE]).filter((n) => !n.startsWith('lib/x86_64/'));
    expect(missingTemplateEntries(oneAbi, 'android')).toEqual([]);
    expect(missingTemplateEntries(oneAbi, 'android', { release: true }))
      .toEqual(expect.arrayContaining(['lib/x86_64/libestella_js_host.so']));
  });

  it('counts a directory entry as held when something inside it is', () => {
    // A zip stores files, never the folder — so `java` is present because
    // `java/com/...` is, and absent when nothing under it shipped.
    const noJava = shipped([BYTECODE]).filter((n) => !n.startsWith('java/'));
    expect(missingTemplateEntries(noJava, 'android', { release: true })).toEqual(['java']);
  });

  it('reads Windows separators, since that is where an archive may be listed', () => {
    const win = shipped([BYTECODE]).map((n) => n.split('/').join(String.fromCharCode(92)));
    expect(missingTemplateEntries(win, 'android', { release: true })).toEqual([]);
  });
});

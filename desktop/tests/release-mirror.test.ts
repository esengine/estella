// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// A mirror is a shortcut, never an authority. These are the two halves of that
// sentence: the editor asks a mirror first (so a slow origin is not the download
// speed anyone gets), and every way a mirror can be wrong — down, missing the
// version, serving a truncated or substituted archive, lagging behind a release —
// hands the job back to the origin instead of failing or, worse, succeeding.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { downloadNativeTemplate } from '../../pipeline/src/export/nativeTemplates';
import { checkForUpdate } from '../electron/updateCheck';
import {
  releaseAssetBase, releaseAssetBases, releaseMirrors, RELEASE_MIRROR_ENV,
  DEFAULT_RELEASE_MIRROR,
  TEMPLATE_INDEX, TEMPLATE_FORMAT, writeTemplateManifest, installedTemplateDir,
} from '../../build-tools/utils/nativeTemplate.js';
import { makeZip } from '../../build-tools/utils/zip.js';

const VERSION = '9.9.9';
const MIRROR = 'https://mirror.test/estella';

describe('where a release is fetched from', () => {
  it('is the built-in mirror, then the origin', () => {
    expect(releaseAssetBases(VERSION, {})).toEqual([
      `${DEFAULT_RELEASE_MIRROR}/v${VERSION}`,
      releaseAssetBase(VERSION),
    ]);
  });

  it('is the origin alone when the mirror is turned off', () => {
    // Explicitly empty, not unset: an offline or air-gapped install has to be able
    // to say "no mirror" without the build having to be different.
    expect(releaseMirrors({ [RELEASE_MIRROR_ENV]: '' })).toEqual([]);
    expect(releaseAssetBases(VERSION, { [RELEASE_MIRROR_ENV]: '' }))
      .toEqual([releaseAssetBase(VERSION)]);
  });

  it('puts each mirror before the origin, and lays a version out the same way', () => {
    const env = { [RELEASE_MIRROR_ENV]: `${MIRROR}/, https://second.test` };
    expect(releaseAssetBases(VERSION, env)).toEqual([
      `${MIRROR}/v${VERSION}`,
      `https://second.test/v${VERSION}`,
      releaseAssetBase(VERSION),
    ]);
  });
});

describe('downloading a template with a mirror configured', () => {
  let store: string;

  beforeEach(() => {
    store = mkdtempSync(path.join(tmpdir(), 'es-mirror-'));
    process.env.ESTELLA_NATIVE_TEMPLATES = store;
    process.env[RELEASE_MIRROR_ENV] = MIRROR;
  });

  afterEach(() => {
    delete process.env.ESTELLA_NATIVE_TEMPLATES;
    delete process.env[RELEASE_MIRROR_ENV];
    rmSync(store, { recursive: true, force: true });
  });

  /** A template archive and the index that describes it, as a release publishes them. */
  function published() {
    const dir = path.join(store, 'src');
    mkdirSync(dir, { recursive: true });
    writeTemplateManifest(dir, { platform: 'ios', engineVersion: VERSION });
    const zip = makeZip([
      { name: 'template.json', data: readFileSync(path.join(dir, 'template.json')) },
      { name: 'Estella.xcframework/Info.plist', data: Buffer.from('<plist/>') },
      { name: 'App/main.m', data: Buffer.from('int main(){}') },
      { name: 'App/Info.plist.in', data: Buffer.from('<plist/>') },
      { name: 'icon.png', data: Buffer.alloc(8, 1) },
    ]);
    const index = {
      kind: 'estella-native-templates',
      formatVersion: TEMPLATE_FORMAT,
      engineVersion: VERSION,
      templates: [{
        id: 'ios', platform: 'ios', file: `estella-native-ios-${VERSION}.zip`,
        bytes: zip.length, sha256: createHash('sha256').update(zip).digest('hex'),
      }],
    };
    return { zip, index };
  }

  /**
   * A fetch that answers per host: `mirror` decides what the mirror serves, and the
   * origin always serves the real thing. Records every URL asked for.
   */
  function serve(mirrorBehaviour: 'good' | 'down' | 'corrupt') {
    const { zip, index } = published();
    const asked: string[] = [];
    const bodyOf = (data: Buffer) => ({
      ok: true, status: 200,
      body: (async function* () { yield data; })(),
    } as unknown as Response);

    const fetchImpl = (async (url: string) => {
      asked.push(url);
      const fromMirror = url.startsWith(MIRROR);
      if (fromMirror && mirrorBehaviour === 'down') {
        return { ok: false, status: 503 } as unknown as Response;
      }
      if (url.endsWith(TEMPLATE_INDEX)) {
        return { ok: true, status: 200, json: async () => index } as unknown as Response;
      }
      // A substituted archive: right size, wrong bytes — the case a checksum is for.
      if (fromMirror && mirrorBehaviour === 'corrupt') return bodyOf(Buffer.alloc(zip.length, 0x5a));
      return bodyOf(zip);
    }) as unknown as typeof fetch;

    return { fetchImpl, asked };
  }

  const installed = () => existsSync(path.join(installedTemplateDir(VERSION, 'ios', store), 'template.json'));

  it('takes the mirror when it serves the archive the index describes', async () => {
    const { fetchImpl, asked } = serve('good');

    const res = await downloadNativeTemplate('ios', VERSION, { fetchImpl });

    expect(res.ok).toBe(true);
    expect(installed()).toBe(true);
    expect(asked.every((u) => u.startsWith(MIRROR))).toBe(true);
  });

  it('falls back to the origin when the mirror is down', async () => {
    const { fetchImpl, asked } = serve('down');

    const res = await downloadNativeTemplate('ios', VERSION, { fetchImpl });

    expect(res.ok).toBe(true);
    expect(installed()).toBe(true);
    expect(asked.some((u) => u.startsWith(MIRROR))).toBe(true);
    expect(asked.some((u) => u.startsWith('https://github.com/'))).toBe(true);
  });

  it('falls back when the mirror serves the right size and the wrong bytes', async () => {
    const { fetchImpl, asked } = serve('corrupt');

    const res = await downloadNativeTemplate('ios', VERSION, { fetchImpl });

    // The checksum is what makes a mirror safe to prefer: a substituted archive is
    // not installed, and it is not the end of the attempt either.
    expect(res.ok).toBe(true);
    expect(installed()).toBe(true);
    expect(asked.filter((u) => u.startsWith('https://github.com/')).length).toBeGreaterThan(0);
  });
});

describe('checking for an editor update with a mirror configured', () => {
  const env = { [RELEASE_MIRROR_ENV]: MIRROR };

  it('asks the mirror first and points the download at the installer it publishes', async () => {
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      asked.push(url);
      return {
        ok: true, status: 200,
        json: async () => ({
          version: '1.2.0',
          url: 'https://estellaengine.com/#download',
          downloads: { win: { url: `${MIRROR}/latest/Estella-Editor-Setup.exe` } },
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const res = await checkForUpdate('1.1.0', fetchImpl, env, 'win32', 'x64');

    // This test used to assert `${MIRROR}/v1.2.0/` — a url composed here rather
    // than published by the mirror, and a 404 on every static host, since object
    // storage has no directory index. It pinned the bug as the contract.
    expect(res).toEqual({ version: '1.2.0', url: `${MIRROR}/latest/Estella-Editor-Setup.exe` });
    expect(asked).toEqual([`${MIRROR}/latest.json`]);
  });

  it('asks the origin when the mirror has no answer, or a stale one', async () => {
    for (const mirrorAnswer of [null, { version: '1.0.0' }]) {
      const asked: string[] = [];
      const fetchImpl = (async (url: string) => {
        asked.push(url);
        if (url.startsWith(MIRROR)) {
          return mirrorAnswer
            ? { ok: true, status: 200, json: async () => mirrorAnswer } as unknown as Response
            : { ok: false, status: 404 } as unknown as Response;
        }
        return {
          ok: true, status: 200,
          json: async () => ({ tag_name: 'v1.2.0', html_url: 'https://github.com/r/releases/v1.2.0' }),
        } as unknown as Response;
      }) as unknown as typeof fetch;

      const res = await checkForUpdate('1.1.0', fetchImpl, env);

      // The origin publishes; a mirror that has not caught up cannot hide a release.
      expect(res?.version).toBe('1.2.0');
      expect(asked.some((u) => u.startsWith('https://api.github.com/'))).toBe(true);
    }
  });

  it('says nothing when the running version is current', async () => {
    const fetchImpl = (async () => (
      { ok: true, status: 200, json: async () => ({ version: '1.1.0' }) } as unknown as Response
    )) as unknown as typeof fetch;

    // The mirror agrees it is current, and the origin (same answer) confirms.
    expect(await checkForUpdate('1.1.0', fetchImpl, env)).toBeNull();
  });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The APK assembler: a binary manifest, an aligned zip and an APK Signature
// Scheme v2 block, all written here rather than shelled out to the Android SDK.
//
// Three formats we implement ourselves means three places where "it looked right
// to us" is worth nothing, so every claim is checked by something that is not us:
//
//   * the signature, by build-tools/tests/verify-apk.py — a second implementation
//     of the scheme, from the spec, on Python's standard library alone;
//   * the manifest, by androguard's decoder (skipped where it isn't installed),
//     and its resource ids against AOSP's own public.xml table;
//   * the archive, by a real `unzip`.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleApk, apkFileName } from '../../build-tools/utils/apk.js';
import { debugSigningKey } from '../../build-tools/utils/androidKeystore.js';
import { compileManifest, ANDROID_ATTR_IDS } from '../../build-tools/utils/androidBinaryXml.js';
import { appResources, ICON_RESOURCE_ID, ICON_PATH } from '../../build-tools/utils/androidResources.js';
import { zipLayout, readZip } from '../../build-tools/utils/zip.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERIFIER = path.join(REPO, 'build-tools', 'tests', 'verify-apk.py');
const MANIFEST_TEMPLATE = path.join(REPO, 'native', 'android', 'host', 'AndroidManifest.xml.in');
/** The icon a template ships, used when the project sets none. */
const DEFAULT_ICON_SOURCE = path.join(REPO, 'native', 'icon.png');

const APP = {
    id: 'com.example.demo', name: 'My Game', version: '1.2', versionCode: 7,
    orientation: 'portrait' as const,
};

let scratch: string;
let templateDir: string;
let contentDir: string;

/** python3 ships with macOS and most Linux; skip rather than fail where it doesn't. */
let hasPython = true;
/** androguard is an optional deeper oracle — the signature check needs neither it
 *  nor any other package. */
let hasAndroguard = false;

beforeAll(() => {
    try {
        execFileSync('python3', ['-c', 'pass'], { stdio: 'ignore' });
    } catch {
        hasPython = false;
    }
    if (hasPython) {
        try {
            execFileSync('python3', ['-c', 'import androguard'], { stdio: 'ignore' });
            hasAndroguard = true;
        } catch { /* the stdlib checks still run */ }
    }
});

beforeEach(() => {
    scratch = mkdtempSync(path.join(tmpdir(), 'es-apk-'));
    process.env.ESTELLA_ANDROID_KEYS = path.join(scratch, 'keys');

    // A stand-in template: the assembler cares about the layout, not about what is
    // inside a .so. Big enough that alignment has something to align.
    templateDir = path.join(scratch, 'template');
    mkdirSync(path.join(templateDir, 'lib', 'arm64-v8a'), { recursive: true });
    mkdirSync(path.join(templateDir, 'assets'), { recursive: true });
    writeFileSync(path.join(templateDir, 'AndroidManifest.xml.in'), readFileSync(MANIFEST_TEMPLATE));
    writeFileSync(path.join(templateDir, 'icon.png'), readFileSync(DEFAULT_ICON_SOURCE));
    writeFileSync(path.join(templateDir, 'lib/arm64-v8a/libestella_js_host.so'), Buffer.alloc(120_000, 7));
    writeFileSync(path.join(templateDir, 'lib/arm64-v8a/libwebgpu_dawn.so'), Buffer.alloc(90_000, 9));
    // A second architecture, the way a template that was built twice carries one.
    mkdirSync(path.join(templateDir, 'lib', 'x86_64'), { recursive: true });
    writeFileSync(path.join(templateDir, 'lib/x86_64/libestella_js_host.so'), Buffer.alloc(110_000, 5));
    writeFileSync(path.join(templateDir, 'classes.dex'), Buffer.from('dex\n035\0stand-in'));
    writeFileSync(path.join(templateDir, 'assets', 'esengine.native.qjsbc'), Buffer.alloc(2048, 3));

    contentDir = path.join(scratch, 'dist-android');
    mkdirSync(path.join(contentDir, 'assets', 'scenes'), { recursive: true });
    writeFileSync(path.join(contentDir, 'game.config.json'), '{"entryScene":"main"}');
    writeFileSync(path.join(contentDir, 'assets/scenes/main.esscene'), '{"entities":[]}');
    writeFileSync(path.join(contentDir, '.DS_Store'), 'litter');
});

afterEach(() => {
    delete process.env.ESTELLA_ANDROID_KEYS;
    rmSync(scratch, { recursive: true, force: true });
});

const assemblyOptions = () => ({ templateDir, contentDir, app: APP, key: debugSigningKey() });

function build(app = APP): string {
    const apk = assembleApk({ templateDir, contentDir, app, key: debugSigningKey() });
    const file = path.join(contentDir, apkFileName(app.id));
    writeFileSync(file, apk);
    return file;
}

function verify(apk: string): {
    signedV2: boolean; entries: number;
    manifest: null | Record<string, unknown>;
} {
    return JSON.parse(execFileSync('python3', [VERIFIER, apk], { encoding: 'utf8' }));
}

/**
 * The attributes of every element, as the platform reads them: resource id, value
 * type and value. Walks the chunk tree and the resource map, and never decodes a
 * string — which is the point. A decoder that renders the manifest back as text
 * shows `android:configChanges="orientation|..."` and looks right; the platform
 * calls Integer.parseInt on it and refuses to install the package.
 */
function compiledAttributes(binary: Buffer): Array<Array<{ id: number; type: number; data: number }>> {
    const CHUNK_RESOURCE_MAP = 0x0180;
    const CHUNK_START_ELEMENT = 0x0102;

    let ids: number[] = [];
    const elements: Array<Array<{ id: number; type: number; data: number }>> = [];

    // Chunks follow the 8-byte XML header, each with type/headerSize/size.
    let at = 8;
    while (at + 8 <= binary.length) {
        const type = binary.readUInt16LE(at);
        const headerSize = binary.readUInt16LE(at + 2);
        const size = binary.readUInt32LE(at + 4);
        if (size <= 0) break;

        if (type === CHUNK_RESOURCE_MAP) {
            ids = [];
            for (let n = at + headerSize; n + 4 <= at + size; n += 4) ids.push(binary.readUInt32LE(n));
        } else if (type === CHUNK_START_ELEMENT) {
            const body = at + headerSize;
            const attrStart = binary.readUInt16LE(body + 8);
            const count = binary.readUInt16LE(body + 12);
            const attrs = [];
            for (let i = 0; i < count; i++) {
                const a = body + attrStart + i * 20;
                const nameIndex = binary.readUInt32LE(a + 4);
                attrs.push({
                    id: ids[nameIndex] ?? 0,
                    type: binary.readUInt8(a + 15),
                    data: binary.readUInt32LE(a + 16),
                });
            }
            if (count > 0) elements.push(attrs);
        }
        at += size;
    }
    return elements;
}

describe('what the platform reads out of the compiled manifest', () => {
    const ATTR = { screenOrientation: 0x0101001e, configChanges: 0x0101001f, exported: 0x01010010 };
    const TYPE_INT_DEC = 0x10;

    const manifest = () => compiledAttributes(compileManifest(
        readFileSync(MANIFEST_TEMPLATE, 'utf8')
            .replace(/@APP_ID@/g, 'com.example.demo').replace(/@APP_NAME@/g, 'My Game')
            .replace(/@VERSION_NAME@/g, '1.2').replace(/@VERSION_CODE@/g, '7')
            .replace(/@SCREEN_ORIENTATION@/g, 'sensorPortrait').replace(/@HAS_CODE@/g, 'true'),
        appResources(Buffer.alloc(4)).references));

    it('gives configChanges the bitmask its words mean, not the words', () => {
        const attr = manifest().flat().find((a) => a.id === ATTR.configChanges);

        // orientation|keyboardHidden|screenSize|screenLayout|density, per AOSP's
        // attrs_manifest.xml. As a string this is INSTALL_PARSE_FAILED on a device.
        expect(attr).toBeDefined();
        expect(attr!.type).toBe(TYPE_INT_DEC);
        expect(attr!.data).toBe(0x0080 | 0x0020 | 0x0400 | 0x0100 | 0x1000);
    });

    it('gives screenOrientation its enum number', () => {
        const attr = manifest().flat().find((a) => a.id === ATTR.screenOrientation);
        expect(attr).toBeDefined();
        expect(attr!.type).toBe(TYPE_INT_DEC);
        expect(attr!.data).toBe(7); // sensorPortrait
    });

    it('sorts each element’s attributes by resource id, which is how they are found', () => {
        // The platform binary-searches this array. Out of order, an attribute is
        // simply not there: an activity whose android:exported cannot be found is
        // refused on Android 12+ for not declaring one.
        for (const attrs of manifest()) {
            // Only the id-bearing ones: `package` carries no resource id and the
            // platform looks it up by name, so it is not part of the ordering the
            // search depends on (it lands last, which a device accepts).
            const ids = attrs.map((a) => a.id).filter((id) => id !== 0);
            expect(ids).toEqual([...ids].sort((x, y) => x - y));
        }
        expect(manifest().flat().some((a) => a.id === ATTR.exported)).toBe(true);
    });
});

describe('the manifest is compiled, not shelled out to aapt2', () => {
    it('uses the resource ids AOSP publishes — the platform resolves attributes by id', () => {
        if (!hasAndroguard) return;
        const dump = execFileSync('python3', ['-c',
            'from androguard.core.resources.public import SYSTEM_RESOURCES;'
            + 'import json;print(json.dumps(SYSTEM_RESOURCES["attributes"]["forward"]))',
        ], { encoding: 'utf8' });
        const aosp: Record<string, number> = JSON.parse(dump);

        for (const [attribute, id] of Object.entries(ANDROID_ATTR_IDS)) {
            expect(`${attribute}=${id}`).toBe(`${attribute}=${aosp[attribute]}`);
        }
    });

    it('round-trips through an independent decoder with every value intact', () => {
        if (!hasAndroguard) return;
        const file = path.join(scratch, 'AndroidManifest.xml');
        writeFileSync(file, compileManifest(readFileSync(MANIFEST_TEMPLATE, 'utf8')
            .replace(/@APP_ID@/g, 'com.example.demo').replace(/@APP_NAME@/g, 'My Game')
            .replace(/@VERSION_NAME@/g, '1.2').replace(/@VERSION_CODE@/g, '7')
            .replace(/@SCREEN_ORIENTATION@/g, 'sensorPortrait').replace(/@HAS_CODE@/g, 'true'),
        appResources(Buffer.alloc(4)).references));

        const xml = execFileSync('python3', ['-c',
            'import sys,os;os.environ["LOGURU_LEVEL"]="CRITICAL";'
            + 'from androguard.core.axml import AXMLPrinter;'
            + 'print(AXMLPrinter(open(sys.argv[1],"rb").read()).get_xml().decode())', file,
        ], { encoding: 'utf8' });

        expect(xml).toContain('package="com.example.demo"');
        expect(xml).toContain('android:versionCode="7"');
        expect(xml).toContain('android:label="My Game"');
        expect(xml).toContain('android:screenOrientation="sensorPortrait"');
        // A framework style survives as a REFERENCE to the id, not as its text.
        expect(xml).toContain('android:theme="@android:01030007"');
        expect(xml).toContain('android:name="android.app.NativeActivity"');
        expect(xml).toContain('android.intent.category.LAUNCHER');
    });

    it('refuses an attribute whose id it does not know, rather than dropping it', () => {
        expect(() => compileManifest(
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android" android:invented="1"/>',
        )).toThrow(/android:invented/);
    });
});

describe('assembling an APK', () => {
    it('produces an archive a real unzip accepts, carrying every part of the app', () => {
        const apk = build();
        expect(execFileSync('unzip', ['-t', apk], { encoding: 'utf8' })).toContain('No errors detected');

        const names = execFileSync('unzip', ['-Z1', apk], { encoding: 'utf8' }).trim().split('\n');
        expect(names).toContain('AndroidManifest.xml');
        expect(names).toContain('classes.dex');
        expect(names).toContain('lib/arm64-v8a/libestella_js_host.so');
        expect(names).toContain('lib/arm64-v8a/libwebgpu_dawn.so');
        // Every architecture the template carries, so one package installs on a
        // phone and in an emulator alike.
        expect(names).toContain('lib/x86_64/libestella_js_host.so');
        expect(names).toContain('assets/esengine.native.qjsbc');
        // The export directory BECOMES assets/, so the cooked tree keeps the
        // project-relative paths the host's readAsset() asks for.
        expect(names).toContain('assets/game.config.json');
        expect(names).toContain('assets/assets/scenes/main.esscene');
        // Build-machine litter stays out of the package.
        expect(names).not.toContain('assets/.DS_Store');
    });

    it('stores native libraries uncompressed on a 16 KiB boundary, so the OS can map them', () => {
        const apk = readFileSync(build());
        const { centralDirOffset } = zipLayout(apk);

        let checked = 0;
        // Entries run until the signing block, which sits just before the central
        // directory — so walk while local headers keep appearing.
        for (let at = 0; at < centralDirOffset && apk.readUInt32LE(at) === 0x04034b50;) {
            const method = apk.readUInt16LE(at + 8);
            const compressedSize = apk.readUInt32LE(at + 18);
            const nameLen = apk.readUInt16LE(at + 26);
            const extraLen = apk.readUInt16LE(at + 28);
            const name = apk.toString('utf8', at + 30, at + 30 + nameLen);
            const dataAt = at + 30 + nameLen + extraLen;
            if (name.endsWith('.so')) {
                expect(method).toBe(0);              // stored
                expect(dataAt % 16384).toBe(0);
                checked++;
            }
            at = dataAt + compressedSize;
        }
        expect(checked).toBe(3);
    });

    it('carries a launcher icon the platform can resolve, through a table we wrote', () => {
        if (!hasAndroguard) return;
        const apk = build();

        const resolved = JSON.parse(execFileSync('python3', ['-c',
            'import sys,os,json;os.environ["LOGURU_LEVEL"]="CRITICAL";'
            + 'from androguard.core.apk import APK;a=APK(sys.argv[1]);i=a.get_app_icon();'
            + 'print(json.dumps({"attr":a.get_attribute_value("application","icon"),'
            + '"file":i,"bytes":len(a.get_file(i)) if i else 0}))', apk,
        ], { encoding: 'utf8' }));

        // The reference resolves through OUR resources.arsc to OUR file — the whole
        // chain, read back by something that has never seen this code.
        expect(resolved.attr.toUpperCase()).toBe(`@${ICON_RESOURCE_ID.toString(16).toUpperCase()}`);
        expect(resolved.file).toBe(ICON_PATH);
        expect(resolved.bytes).toBe(readFileSync(DEFAULT_ICON_SOURCE).length);
    });

    it("packages the project's own icon when it has one", () => {
        const mine = Buffer.concat([readFileSync(DEFAULT_ICON_SOURCE), Buffer.from('mine')]);
        const file = path.join(contentDir, 'custom.apk');
        writeFileSync(file, assembleApk({ ...assemblyOptions(), icon: mine }));

        const packaged = readZip(readFileSync(file)).find((e) => e.name === ICON_PATH)!;
        expect(packaged.data.equals(mine)).toBe(true);
    });

    it('is named after the app, so a second project does not replace the first', () => {
        expect(path.basename(build())).toBe('demo.apk');
        expect(apkFileName('com.acme.spaceGame')).toBe('spaceGame.apk');
    });

    it('does not swallow the APK a previous export left in the directory', () => {
        build();
        const again = build();

        const names = execFileSync('unzip', ['-Z1', again], { encoding: 'utf8' });
        expect(names).not.toContain('assets/demo.apk');
    });
});

describe('the v2 signature, checked by an independent implementation', () => {
    it('verifies: the digest covers the file and the certificate carries the signing key', () => {
        if (!hasPython) return;
        const result = verify(build());

        expect(result.signedV2).toBe(true);
        expect(result.entries).toBeGreaterThan(6);
        if (hasAndroguard) {
            expect(result.manifest).toMatchObject({
                package: 'com.example.demo',
                label: 'My Game',
                versionName: '1.2',
                versionCode: '7',
                mainActivity: 'android.app.NativeActivity',
                valid: true,
            });
        }
    });

    it('fails once a single byte of the payload changes', () => {
        if (!hasPython) return;
        const apk = readFileSync(build());
        // Somewhere inside the first entry's data, well before the signing block.
        const tampered = Buffer.from(apk);
        tampered[600] ^= 0xff;
        const file = path.join(scratch, 'tampered.apk');
        writeFileSync(file, tampered);

        expect(() => verify(file)).toThrow();
    });

    it('reuses the development key, so an update installs over the app it replaces', () => {
        const first = debugSigningKey();
        const second = debugSigningKey();

        expect(second.certificate.equals(first.certificate)).toBe(true);
        expect(existsSync(path.join(scratch, 'keys', 'debug.cert.pem'))).toBe(true);
    });

    it('writes a certificate openssl reads back as the identity it claims', () => {
        const pem = path.join(scratch, 'keys', 'debug.cert.pem');
        debugSigningKey();

        const text = execFileSync('openssl', ['x509', '-in', pem, '-noout', '-subject', '-issuer'], { encoding: 'utf8' });

        // Self-signed: the issuer line and the subject line say the same thing.
        // (Spacing differs between OpenSSL and the LibreSSL macOS ships.)
        expect(text).toMatch(/subject=.*CN\s?=\s?Estella Debug/);
        expect(text).toMatch(/issuer=.*CN\s?=\s?Estella Debug/);
    });
});

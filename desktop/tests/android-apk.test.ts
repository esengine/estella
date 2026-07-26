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
import { zipLayout } from '../../build-tools/utils/zip.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERIFIER = path.join(REPO, 'build-tools', 'tests', 'verify-apk.py');
const MANIFEST_TEMPLATE = path.join(REPO, 'native', 'android', 'host', 'AndroidManifest.xml.in');

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
    writeFileSync(path.join(templateDir, 'lib/arm64-v8a/libestella_js_host.so'), Buffer.alloc(120_000, 7));
    writeFileSync(path.join(templateDir, 'lib/arm64-v8a/libwebgpu_dawn.so'), Buffer.alloc(90_000, 9));
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

function build(app = APP): string {
    const apk = assembleApk({ templateDir, contentDir, app, abi: 'arm64-v8a', key: debugSigningKey() });
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
            .replace(/@SCREEN_ORIENTATION@/g, 'sensorPortrait').replace(/@HAS_CODE@/g, 'true')));

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
        expect(checked).toBe(2);
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

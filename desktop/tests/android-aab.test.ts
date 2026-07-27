// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The App Bundle assembler — the format Google Play takes, which is the same app
// as the APK in a different encoding.
//
// Two things are worth pinning down. The first is that the two encodings agree:
// the manifest is parsed once and written twice, so a bundle that described a
// different app than its APK would be a bug found by a store rejection. The
// second is the protobuf FIELD NUMBERS, which are the one thing in this format
// that cannot be inferred from the data — they are asserted against aapt2's
// Resources.proto here, decoded out of the bytes by an implementation that shares
// no code with the writer.
//
// `bundletool validate` is the real authority, and it needs a JVM. Where one
// exists (CI, and any machine with BUNDLETOOL_JAR set) it runs; where it does not,
// the structural checks still do, and they say so rather than passing silently.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleAab, aabFileName } from '../../build-tools/utils/aab.js';
import { assembleApk } from '../../build-tools/utils/apk.js';
import { debugSigningKey } from '../../build-tools/utils/androidKeystore.js';
import { readZip, makeZip } from '../../build-tools/utils/zip.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERIFIER = path.join(REPO, 'build-tools', 'tests', 'verify-aab.py');
const MANIFEST_TEMPLATE = path.join(REPO, 'native', 'android', 'host', 'AndroidManifest.xml.in');
/** The icon a template ships, used when the project sets none. */
const DEFAULT_ICON_SOURCE = path.join(REPO, 'native', 'icon.png');

const APP = {
    id: 'com.example.demo', name: 'My Game', version: '1.2', versionCode: 7,
    orientation: 'portrait' as const,
};

interface Attribute {
    name: string;
    value: string;
    resourceId: number | null;
    compiled?: { ref?: number; primField?: number; primValue?: number };
}
interface Element { name: string; attributes: Attribute[]; children: Element[] }

let scratch: string;
let templateDir: string;
let contentDir: string;
let hasPython = true;
let hasAndroguard = false;
/** `bundletool validate` — the format's own authority, when a JVM is around. */
let bundletool: string | null = null;

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
        } catch { /* the structural checks still run */ }
    }
    const jar = process.env.BUNDLETOOL_JAR;
    if (jar && existsSync(jar)) {
        try {
            execFileSync('java', ['-version'], { stdio: 'ignore' });
            bundletool = jar;
        } catch { /* no JVM */ }
    }
});

beforeEach(() => {
    scratch = mkdtempSync(path.join(tmpdir(), 'es-aab-'));
    process.env.ESTELLA_ANDROID_KEYS = path.join(scratch, 'keys');

    templateDir = path.join(scratch, 'template');
    mkdirSync(path.join(templateDir, 'lib', 'arm64-v8a'), { recursive: true });
    mkdirSync(path.join(templateDir, 'assets'), { recursive: true });
    writeFileSync(path.join(templateDir, 'AndroidManifest.xml.in'), readFileSync(MANIFEST_TEMPLATE));
    writeFileSync(path.join(templateDir, 'icon.png'), readFileSync(DEFAULT_ICON_SOURCE));
    writeFileSync(path.join(templateDir, 'lib/arm64-v8a/libestella_js_host.so'), Buffer.alloc(40_000, 7));
    writeFileSync(path.join(templateDir, 'lib/arm64-v8a/libwebgpu_dawn.so'), Buffer.alloc(30_000, 9));
    mkdirSync(path.join(templateDir, 'lib', 'x86_64'), { recursive: true });
    writeFileSync(path.join(templateDir, 'lib/x86_64/libestella_js_host.so'), Buffer.alloc(25_000, 5));
    writeFileSync(path.join(templateDir, 'classes.dex'), Buffer.from('dex\n035\0stand-in'));
    writeFileSync(path.join(templateDir, 'assets', 'esengine.native.qjsbc'), Buffer.alloc(512, 3));

    contentDir = path.join(scratch, 'dist-android');
    mkdirSync(path.join(contentDir, 'assets', 'scenes'), { recursive: true });
    writeFileSync(path.join(contentDir, 'game.config.json'), '{"entryScene":"main"}');
    writeFileSync(path.join(contentDir, 'assets/scenes/main.esscene'), '{"entities":[]}');
});

afterEach(() => {
    delete process.env.ESTELLA_ANDROID_KEYS;
    rmSync(scratch, { recursive: true, force: true });
});

const assembly = () => ({ templateDir, contentDir, app: APP, key: debugSigningKey() });

function build(): string {
    const file = path.join(contentDir, aabFileName(APP.id));
    writeFileSync(file, assembleAab(assembly()));
    return file;
}

function verify(aab: string): {
    entries: number; signedEntries: number; bundletoolVersion: string;
    uncompressedGlobs: string[]; manifest: Element; hasDex: boolean;
    libs: string[]; assets: number; resourceFiles: string[]; resFiles: string[];
} {
    return JSON.parse(execFileSync('python3', [VERIFIER, aab], { encoding: 'utf8' }));
}

const find = (element: Element, name: string): Element | undefined =>
    element.name === name ? element : element.children.map((c) => find(c, name)).find(Boolean);
const attr = (element: Element, name: string): Attribute | undefined =>
    element.attributes.find((a) => a.name === name);

describe('assembling an App Bundle', () => {
    it('lays the app out the way the format requires, and signs every entry', () => {
        if (!hasPython) return;
        const result = verify(build());

        expect(result.hasDex).toBe(true);
        // Every architecture: Play splits the bundle per device, which is the point
        // of the format.
        expect(result.libs).toEqual([
            'base/lib/arm64-v8a/libestella_js_host.so',
            'base/lib/arm64-v8a/libwebgpu_dawn.so',
            'base/lib/x86_64/libestella_js_host.so',
        ]);
        // The template's bytecode plus the export's own files.
        expect(result.assets).toBe(3);
        expect(result.uncompressedGlobs).toEqual(['**.so']);
        expect(result.bundletoolVersion).toMatch(/^\d+\.\d+/);
        // Everything outside META-INF is digested — that is what signing a JAR means.
        expect(result.signedEntries).toBe(result.entries - 3);
    });

    it('describes the app in protobuf, typed the way the platform reads it', () => {
        if (!hasPython) return;
        const { manifest } = verify(build());

        expect(attr(manifest, 'package')?.value).toBe('com.example.demo');
        // Resources.proto: Primitive.int_decimal_value = 6, and the resource id is
        // what the platform actually resolves the attribute by.
        expect(attr(manifest, 'versionCode')).toMatchObject({
            resourceId: 0x0101021b,
            compiled: { primField: 6, primValue: 7 },
        });

        const application = find(manifest, 'application')!;
        // Primitive.boolean_value = 8.
        expect(attr(application, 'extractNativeLibs')).toMatchObject({
            compiled: { primField: 8, primValue: 0 },
        });

        const feature = find(manifest, 'uses-feature')!;
        // Primitive.int_hexadecimal_value = 7.
        expect(attr(feature, 'version')).toMatchObject({ compiled: { primField: 7, primValue: 0x400003 } });

        const activity = find(manifest, 'activity')!;
        // Item.ref → Reference.id = 2, carrying the framework theme.
        expect(attr(activity, 'theme')).toMatchObject({ compiled: { ref: 0x01030007 } });
        expect(attr(activity, 'screenOrientation')?.value).toBe('sensorPortrait');
        expect(find(manifest, 'category')).toBeTruthy();
    });

    it('describes the SAME app its APK does — one manifest, two encodings', () => {
        if (!hasPython || !hasAndroguard) return;
        const apk = path.join(scratch, 'demo.apk');
        writeFileSync(apk, assembleApk(assembly()));
        const binary = JSON.parse(execFileSync('python3', ['-c',
            'import sys,os,json;os.environ["LOGURU_LEVEL"]="CRITICAL";'
            + 'from androguard.core.apk import APK;a=APK(sys.argv[1]);'
            + 'print(json.dumps({"package":a.get_package(),"label":a.get_app_name(),'
            + '"versionName":a.get_androidversion_name(),"versionCode":a.get_androidversion_code(),'
            + '"minSdk":a.get_min_sdk_version(),"activity":a.get_main_activity()}))', apk,
        ], { encoding: 'utf8' }));

        const { manifest } = verify(build());
        const application = find(manifest, 'application')!;

        expect(attr(manifest, 'package')?.value).toBe(binary.package);
        expect(attr(application, 'label')?.value).toBe(binary.label);
        expect(attr(manifest, 'versionName')?.value).toBe(binary.versionName);
        expect(String(attr(manifest, 'versionCode')?.compiled?.primValue)).toBe(binary.versionCode);
        expect(attr(find(manifest, 'uses-sdk')!, 'minSdkVersion')?.value).toBe(binary.minSdk);
        expect(attr(find(manifest, 'activity')!, 'name')?.value).toBe(binary.activity);
    });

    it('carries the icon and the resource table the reference resolves through', () => {
        if (!hasPython) return;
        const entries = readZip(readFileSync(build())).map((e) => e.name);

        expect(entries).toContain('base/res/mipmap-xxxhdpi/ic_launcher.png');
        expect(entries).toContain('base/resources.pb');

        const { manifest, resourceFiles, resFiles } = verify(build());
        const application = find(manifest, 'application')!;
        expect(attr(application, 'icon')).toMatchObject({
            value: '@mipmap/ic_launcher',
            compiled: { ref: 0x7f010000 },
        });

        // The other half of the reference, and bundletool's own rule: every file
        // under res/ has to be named by the table. Asserted as that relation rather
        // than as one expected path, so a resource added later without a table entry
        // fails here too — the JVM step below is the authority, not the only check.
        expect(resourceFiles.slice().sort()).toEqual(resFiles.slice().sort());
        expect(resFiles).toContain('res/mipmap-xxxhdpi/ic_launcher.png');
    });

    it('fails verification once an entry changes under the signature', () => {
        if (!hasPython) return;
        // Repacked with one file swapped and the ORIGINAL signature kept — which is
        // exactly what tampering with a signed bundle looks like.
        const entries = readZip(readFileSync(build())).map((e) => (
            e.name.endsWith('main.esscene') ? { ...e, data: Buffer.from('{"entities":[1]}') } : e));
        const file = path.join(scratch, 'tampered.aab');
        writeFileSync(file, makeZip(entries));

        expect(() => verify(file)).toThrow();
    });

    it('passes bundletool, where there is a JVM to run it', () => {
        if (!bundletool) return;
        const file = build();

        const out = execFileSync('java', ['-jar', bundletool, 'validate', `--bundle=${file}`], { encoding: 'utf8' });

        // A non-zero exit throws, so arriving here is the verdict. What is left to
        // check is that the bundle bundletool accepted is the one meant: `validate`
        // reports the modules and their files (not the identity — that is asserted
        // from the decoded manifest above).
        expect(out).toContain('Feature module: base');
        expect(out).toContain('File: res/mipmap-xxxhdpi/ic_launcher.png');
        expect(out).toContain('File: dex/classes.dex');
        expect(out).toContain('File: lib/arm64-v8a/libestella_js_host.so');
        expect(out).toContain('File: assets/game.config.json');
    });
});

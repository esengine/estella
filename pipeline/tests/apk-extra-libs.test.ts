// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * An Android package carries what the export built per ABI (its compiled systems)
 * beside the template's own libraries: in lib/<abi>/, stored and page-aligned, so
 * the system linker maps it straight out of the APK and finds it by bare name.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleApk, withExtractNativeLibs } from '../../build-tools/utils/apk.js';
import { readZip } from '../../build-tools/utils/zip.js';
import { debugSigningKey } from '../../build-tools/utils/androidKeystore.js';
import { ANDROID_AOT_LIBRARY } from '../src/export/androidAot';
import { ANDROID_PHYSX_LIBRARY, androidPhysXLibs } from '../../build-tools/utils/nativeTemplate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Compression method and data offset of each entry, from the central directory. */
function layoutOf(apk: Buffer): Map<string, { method: number; dataAt: number }> {
    let end = apk.length - 22;
    while (apk.readUInt32LE(end) !== 0x06054b50) end--;
    const count = apk.readUInt16LE(end + 10);
    let p = apk.readUInt32LE(end + 16);
    const out = new Map<string, { method: number; dataAt: number }>();
    for (let i = 0; i < count; i++) {
        const method = apk.readUInt16LE(p + 10);
        const nameLen = apk.readUInt16LE(p + 28), extraLen = apk.readUInt16LE(p + 30), commentLen = apk.readUInt16LE(p + 32);
        const local = apk.readUInt32LE(p + 42);
        const name = apk.toString('utf8', p + 46, p + 46 + nameLen);
        out.set(name, { method, dataAt: local + 30 + apk.readUInt16LE(local + 26) + apk.readUInt16LE(local + 28) });
        p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
}

describe('an APK with compiled systems', () => {
    it('packages each ABI\'s module in lib/<abi>/, stored and page-aligned, and ignores an ABI it does not carry', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'estella-apk-aot-'));
        try {
            const template = path.join(dir, 'template');
            for (const abi of ['arm64-v8a', 'x86_64']) {
                mkdirSync(path.join(template, 'lib', abi), { recursive: true });
                writeFileSync(path.join(template, 'lib', abi, 'libestella_js_host.so'), Buffer.from(`host ${abi}`));
            }
            copyFileSync(path.join(ROOT, 'native/android/host/AndroidManifest.xml.in'), path.join(template, 'AndroidManifest.xml.in'));
            copyFileSync(path.join(ROOT, 'native/icon.png'), path.join(template, 'icon.png'));
            const content = path.join(dir, 'content');
            mkdirSync(content, { recursive: true });
            writeFileSync(path.join(content, 'game.config.json'), '{}');
            const built: Record<string, string[]> = {};
            for (const abi of ['arm64-v8a', 'x86_64', 'mips']) {
                const file = path.join(dir, 'aot', abi, ANDROID_AOT_LIBRARY);
                mkdirSync(path.dirname(file), { recursive: true });
                writeFileSync(file, Buffer.from(`systems ${abi}`));
                built[abi] = [file];
            }

            const apk = assembleApk({
                templateDir: template, contentDir: content,
                app: { id: 'com.example.aot', name: 'Aot', version: '1.0', versionCode: 1 } as never,
                key: debugSigningKey(), emulatorAbi: true, extraLibs: built, compressNativeLibs: false,
            });

            const entries = new Map(readZip(apk).map((e) => [e.name, e.data]));
            const layout = layoutOf(apk);
            for (const abi of ['arm64-v8a', 'x86_64']) {
                const name = `lib/${abi}/${ANDROID_AOT_LIBRARY}`;
                expect(entries.get(name)?.toString(), name).toBe(`systems ${abi}`);
                expect(layout.get(name)?.method, `${name} stored`).toBe(0);
                expect((layout.get(name)?.dataAt ?? 1) % 4096, `${name} page-aligned`).toBe(0);
            }
            expect([...entries.keys()].some((n) => n.startsWith('lib/mips/'))).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
        }
    });
});

describe('how an APK packs its native libraries', () => {
    const build = (compressNativeLibs?: boolean) => {
        const dir = mkdtempSync(path.join(tmpdir(), 'estella-apk-libs-'));
        try {
            const template = path.join(dir, 'template');
            mkdirSync(path.join(template, 'lib', 'arm64-v8a'), { recursive: true });
            // Compressible like a real library, so deflate has something to win.
            writeFileSync(path.join(template, 'lib', 'arm64-v8a', 'libestella_js_host.so'), Buffer.alloc(64 * 1024, 7));
            copyFileSync(path.join(ROOT, 'native/android/host/AndroidManifest.xml.in'), path.join(template, 'AndroidManifest.xml.in'));
            copyFileSync(path.join(ROOT, 'native/icon.png'), path.join(template, 'icon.png'));
            const content = path.join(dir, 'content');
            mkdirSync(content, { recursive: true });
            writeFileSync(path.join(content, 'game.config.json'), '{}');
            return assembleApk({
                templateDir: template, contentDir: content,
                app: { id: 'com.example.libs', name: 'Libs', version: '1.0', versionCode: 1 } as never,
                key: debugSigningKey(), ...(compressNativeLibs === undefined ? {} : { compressNativeLibs }),
            });
        } finally {
            rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
        }
    };

    it('deflates them by default — an APK is what a player downloads', () => {
        const apk = build();
        expect(layoutOf(apk).get('lib/arm64-v8a/libestella_js_host.so')?.method).toBe(8);
    });

    it('stores them page-aligned when asked, for the loader to map in place', () => {
        const at = layoutOf(build(false)).get('lib/arm64-v8a/libestella_js_host.so')!;
        expect(at.method).toBe(0);
        expect(at.dataAt % 16384).toBe(0);
    });

    it('tells the installer to extract exactly the libraries it compressed, whatever the template wrote', () => {
        const written = '<application android:hasCode="true" android:extractNativeLibs="false">';
        expect(withExtractNativeLibs(written, true)).toContain('android:extractNativeLibs="true"');
        expect(withExtractNativeLibs(written, false)).toContain('android:extractNativeLibs="false"');
        expect(withExtractNativeLibs('<application android:label="x">', true))
            .toContain('<application android:extractNativeLibs="true" android:label="x">');
    });
});

describe('PhysX on Android is in the package only when the project picked it', () => {
    const fixture = () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'estella-apk-physx-'));
        const template = path.join(dir, 'template');
        mkdirSync(path.join(template, 'lib', 'arm64-v8a'), { recursive: true });
        writeFileSync(path.join(template, 'lib', 'arm64-v8a', 'libestella_js_host.so'), Buffer.from('host'));
        // Where the template keeps it: outside lib/, which every package copies.
        mkdirSync(path.join(template, 'plugins', 'arm64-v8a'), { recursive: true });
        writeFileSync(path.join(template, 'plugins', 'arm64-v8a', ANDROID_PHYSX_LIBRARY), Buffer.from('physx'));
        copyFileSync(path.join(ROOT, 'native/android/host/AndroidManifest.xml.in'), path.join(template, 'AndroidManifest.xml.in'));
        copyFileSync(path.join(ROOT, 'native/icon.png'), path.join(template, 'icon.png'));
        const content = path.join(dir, 'content');
        mkdirSync(content, { recursive: true });
        writeFileSync(path.join(content, 'game.config.json'), '{}');
        const apk = (extraLibs?: Record<string, string[]>) => new Map(readZip(assembleApk({
            templateDir: template, contentDir: content,
            app: { id: 'com.example.physx', name: 'PhysX', version: '1.0', versionCode: 1 } as never,
            key: debugSigningKey(), ...(extraLibs ? { extraLibs } : {}),
        })).map((e) => [e.name, e.data]));
        return { dir, template, apk };
    };

    it('leaves it out of the package of a Jolt project', () => {
        const { dir, apk } = fixture();
        try {
            expect([...apk().keys()].filter((n) => n.includes(ANDROID_PHYSX_LIBRARY))).toEqual([]);
        } finally {
            rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
        }
    });

    it('puts it in lib/<abi>/ for a PhysX project, where the host dlopens it by name', () => {
        const { dir, template, apk } = fixture();
        try {
            const libs = androidPhysXLibs(template, ['arm64-v8a', 'x86_64']);
            // Only the ABIs the template built it for.
            expect(Object.keys(libs ?? {})).toEqual(['arm64-v8a']);
            expect(apk(libs!).get(`lib/arm64-v8a/${ANDROID_PHYSX_LIBRARY}`)?.toString()).toBe('physx');
            expect([...apk(libs!).keys()].some((n) => n.startsWith('plugins/'))).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
        }
    });

    it('answers null for a template built without PhysX, so the export can say so', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'estella-apk-nophysx-'));
        try {
            expect(androidPhysXLibs(dir, ['arm64-v8a'])).toBeNull();
        } finally {
            rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
        }
    });
});

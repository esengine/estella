// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The Android Studio project an export writes, checked as the two things it has to
// be: a project Gradle can build (identity where AGP reads it, libraries and assets
// where the conventions put them), and a project a game can OWN — re-exporting
// refreshes the game and leaves the build script the game edited alone.
//
// The APK path is covered next door; what is unique here is that this output is
// source, so it is read as text rather than validated by a packaging tool.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitAndroidGradleProject, gradleManifest } from '../../build-tools/utils/gradleProject.js';
import { androidTemplateSources } from '../../build-tools/utils/nativeTemplate.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST_TEMPLATE = path.join(REPO, 'native', 'android', 'host', 'AndroidManifest.xml.in');
const DEFAULT_ICON_SOURCE = path.join(REPO, 'native', 'icon.png');

const APP = {
    id: 'com.example.demo', name: 'My Game', version: '1.2', versionCode: 7,
    orientation: 'portrait' as const,
};

let scratch: string;
let templateDir: string;
let contentDir: string;

beforeEach(() => {
    scratch = mkdtempSync(path.join(tmpdir(), 'es-agp-'));

    templateDir = path.join(scratch, 'template');
    mkdirSync(path.join(templateDir, 'lib', 'arm64-v8a'), { recursive: true });
    mkdirSync(path.join(templateDir, 'lib', 'x86_64'), { recursive: true });
    mkdirSync(path.join(templateDir, 'java', 'com', 'estella', 'host'), { recursive: true });
    mkdirSync(path.join(templateDir, 'assets'), { recursive: true });
    writeFileSync(path.join(templateDir, 'AndroidManifest.xml.in'), readFileSync(MANIFEST_TEMPLATE));
    writeFileSync(path.join(templateDir, 'icon.png'), readFileSync(DEFAULT_ICON_SOURCE));
    writeFileSync(path.join(templateDir, 'classes.dex'), Buffer.from('dex\n035\0stand-in'));
    for (const abi of ['arm64-v8a', 'x86_64']) {
        writeFileSync(path.join(templateDir, 'lib', abi, 'libestella_js_host.so'), Buffer.alloc(1024, 7));
        writeFileSync(path.join(templateDir, 'lib', abi, 'libwebgpu_dawn.so'), Buffer.alloc(1024, 9));
    }
    writeFileSync(path.join(templateDir, 'java', 'com', 'estella', 'host', 'TextEditor.java'),
        'package com.estella.host;\npublic class TextEditor {}\n');
    writeFileSync(path.join(templateDir, 'assets', 'esengine.native.qjsbc'), Buffer.alloc(64, 3));

    contentDir = path.join(scratch, 'dist-android');
    mkdirSync(path.join(contentDir, 'assets', 'scenes'), { recursive: true });
    writeFileSync(path.join(contentDir, 'game.config.json'), '{"entryScene":"main"}');
    writeFileSync(path.join(contentDir, 'app.config.json'), '{"id":"com.example.demo"}');
    writeFileSync(path.join(contentDir, 'assets/scenes/main.esscene'), '{"entities":[]}');
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

const emit = () => emitAndroidGradleProject(contentDir, APP, androidTemplateSources(templateDir));
const read = (...rel: string[]) => readFileSync(path.join(contentDir, ...rel), 'utf8');
const has = (...rel: string[]) => existsSync(path.join(contentDir, ...rel));

describe('the Android Studio project an export writes', () => {
    it('puts the game where Gradle and the host both look: src/main/assets', async () => {
        await emit();

        expect(has('app', 'src', 'main', 'assets', 'game.config.json')).toBe(true);
        expect(has('app', 'src', 'main', 'assets', 'assets', 'scenes', 'main.esscene')).toBe(true);
        // Moved, not copied — the export directory IS the project, and a second copy
        // of the content would ship in the APK twice.
        expect(has('game.config.json')).toBe(false);
    });

    it('carries the engine, the Java shim and the icon out of the template', async () => {
        await emit();

        for (const abi of ['arm64-v8a', 'x86_64']) {
            expect(has('app', 'src', 'main', 'jniLibs', abi, 'libestella_js_host.so')).toBe(true);
            expect(has('app', 'src', 'main', 'jniLibs', abi, 'libwebgpu_dawn.so')).toBe(true);
        }
        expect(has('app', 'src', 'main', 'java', 'com', 'estella', 'host', 'TextEditor.java')).toBe(true);
        expect(has('app', 'src', 'main', 'res', 'mipmap-xxxhdpi', 'ic_launcher.png')).toBe(true);
        // The precompiled bundle rides along as an asset, or the first launch after
        // an install spends seconds compiling it.
        expect(has('app', 'src', 'main', 'assets', 'esengine.native.qjsbc')).toBe(true);
    });

    it('moves identity out of the manifest, which AGP 8 requires, and into Gradle', async () => {
        await emit();
        const manifest = read('app', 'src', 'main', 'AndroidManifest.xml');
        const gradle = read('app', 'build.gradle.kts');

        // AGP rejects a manifest that declares these, and ignores <uses-sdk>.
        expect(manifest).not.toMatch(/\bpackage=/);
        expect(manifest).not.toMatch(/android:versionCode=/);
        expect(manifest).not.toMatch(/android:versionName=/);
        expect(manifest).not.toContain('<uses-sdk');
        // Removing a line must not pull the next element onto the one before it.
        expect(manifest).toMatch(/<manifest xmlns:android="[^"]+">\r?\n\s+<uses-feature/);

        // What stays is the host: label, orientation, the Vulkan requirement, and
        // hasCode — true here, because a project compiles the shim from source.
        expect(manifest).toContain('android:label="My Game"');
        expect(manifest).toContain('android:screenOrientation="sensorPortrait"');
        expect(manifest).toContain('android:hasCode="true"');

        expect(gradle).toContain('applicationId = "com.example.demo"');
        expect(gradle).toContain('namespace = "com.example.demo"');
        expect(gradle).toContain('versionCode = 7');
        expect(gradle).toContain('versionName = "1.2"');
        // Taken from the manifest template rather than restated, so the two agree.
        expect(gradle).toContain('minSdk = 24');
        expect(gradle).toContain('targetSdk = 33');
    });

    it('filters to the architectures the template actually carries', async () => {
        rmSync(path.join(templateDir, 'lib', 'x86_64'), { recursive: true, force: true });
        await emit();

        const gradle = read('app', 'build.gradle.kts');
        expect(gradle).toContain('abiFilters += listOf("arm64-v8a")');
        expect(gradle).not.toContain('x86_64');
    });

    it('is a Gradle project: settings, root script, properties', async () => {
        await emit();

        expect(read('settings.gradle.kts')).toContain('include(":app")');
        expect(read('settings.gradle.kts')).toContain('rootProject.name = "MyGame"');
        expect(read('build.gradle.kts')).toContain('com.android.application');
        expect(read('gradle.properties')).toContain('org.gradle.jvmargs');
        expect(has('README.md')).toBe(true);
        expect(has('.gitignore')).toBe(true);
    });

    it('re-exporting refreshes the game and keeps what the game owns', async () => {
        await emit();

        // What a game does the moment it needs an SDK.
        const buildScript = path.join(contentDir, 'app', 'build.gradle.kts');
        writeFileSync(buildScript, `${readFileSync(buildScript, 'utf8')}\n// implementation("com.ads:sdk:1.0")\n`);
        // A stale asset from the previous export, and a fresh one to replace it.
        writeFileSync(path.join(contentDir, 'app', 'src', 'main', 'assets', 'gone.json'), '{}');
        mkdirSync(path.join(contentDir, 'assets'), { recursive: true });
        writeFileSync(path.join(contentDir, 'game.config.json'), '{"entryScene":"second"}');

        await emit();

        expect(read('app', 'build.gradle.kts')).toContain('com.ads:sdk:1.0');
        expect(read('app', 'src', 'main', 'assets', 'game.config.json')).toContain('second');
        expect(has('app', 'src', 'main', 'assets', 'gone.json')).toBe(false);
    });

    it('refuses a template with no native libraries rather than writing a project that cannot run', async () => {
        rmSync(path.join(templateDir, 'lib'), { recursive: true, force: true });
        mkdirSync(path.join(templateDir, 'lib'), { recursive: true });

        await expect(emit()).rejects.toThrow(/no native libraries/);
    });
});

describe('gradleManifest', () => {
    it('reads the SDK levels it strips, so the build script can state them', () => {
        const { minSdk, targetSdk } = gradleManifest(readFileSync(MANIFEST_TEMPLATE, 'utf8'), APP);
        expect(minSdk).toBe(24);
        expect(targetSdk).toBe(33);
    });
});

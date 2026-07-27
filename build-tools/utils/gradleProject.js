// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The Android Studio project an Android export ships, written directly — the
// Android side of iosProject.js, and the same bargain: the runtime template
// carries the engine's compiled half, the export carries the game, and what the
// user opens is an ordinary project of their platform's own kind.
//
// It exists because an APK is a dead end for anyone who needs to add an SDK, a
// permission, a service or their own Activity. The one-click package stays for
// everyone who does not.

import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fillTemplate, androidScreenOrientation } from './nativeApp.js';

/** Android Gradle Plugin the emitted project asks for. */
const AGP_VERSION = '8.7.3';
/** compileSdk. min/target come from the manifest template, which owns them. */
const COMPILE_SDK = 34;

/** The Gradle project's own files, which are never mistaken for game content. */
const PROJECT_ENTRIES = [
    'app', 'settings.gradle.kts', 'build.gradle.kts', 'gradle.properties',
    'gradle', 'gradlew', 'gradlew.bat', 'README.md', '.gitignore',
];

/** A Gradle project name (and Android Studio window title) that needs no quoting. */
function projectName(appName) {
    return appName.replace(/[^A-Za-z0-9]+/g, '') || 'EstellaGame';
}

/**
 * Turn the packaging manifest template into the one a Gradle build wants.
 *
 * Same file, same substitutions, so the manifest an APK carries and the manifest
 * a project builds are the same document. What differs is where identity lives:
 * AGP 8 rejects `package` and the version attributes in a manifest and reads them
 * from the build script, and it ignores `<uses-sdk>` in favour of the same. So
 * those move out — and their values move INTO the build script rather than being
 * restated, which is why they are returned here.
 *
 * @returns {{xml: string, minSdk: number, targetSdk: number}}
 */
export function gradleManifest(templateXml, app) {
    const filled = fillTemplate(templateXml, {
        APP_ID: app.id,
        APP_NAME: app.name,
        VERSION_NAME: app.version,
        VERSION_CODE: app.versionCode,
        SCREEN_ORIENTATION: androidScreenOrientation(app.orientation),
        // A project compiles the Java shim from source, so there is always code.
        HAS_CODE: 'true',
    });

    const minSdk = Number(/android:minSdkVersion="(\d+)"/.exec(filled)?.[1] ?? 26);
    const targetSdk = Number(/android:targetSdkVersion="(\d+)"/.exec(filled)?.[1] ?? 33);

    const xml = filled
        // Horizontal whitespace only: `\s*` also eats the next line's indent, which
        // pulls the element after it onto the manifest tag's own line.
        .replace(/^[^\S\n]*<uses-sdk[^>]*\/>[^\S\n]*\r?\n/m, '')
        // The line ending goes with the line: a template with CRLF would otherwise
        // leave its `\r` behind on the tag these were removed from.
        .replace(/\r?\n[^\S\n]*package="[^"]*"/, '')
        .replace(/\r?\n[^\S\n]*android:versionCode="[^"]*"/, '')
        .replace(/\r?\n[^\S\n]*android:versionName="[^"]*"/, '');

    return { xml, minSdk, targetSdk };
}

/** `settings.gradle.kts` — where the plugin and its dependencies come from. */
export function renderSettingsGradle(name) {
    return `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "${name}"
include(":app")
`;
}

/** The root build script: declares the plugin, applies it in :app. */
export function renderRootGradle() {
    return `plugins {
    id("com.android.application") version "${AGP_VERSION}" apply false
}
`;
}

/**
 * `app/build.gradle.kts` — the file a game edits.
 *
 * Identity, SDK levels and the ABI filter live here because AGP owns them; the
 * engine's prebuilt libraries are picked up from jniLibs by convention, so
 * nothing here has to name them.
 */
export function renderAppGradle(o) {
    const abis = o.abis.map((abi) => `"${abi}"`).join(', ');
    return `plugins {
    id("com.android.application")
}

android {
    namespace = "${o.appId}"
    compileSdk = ${COMPILE_SDK}

    defaultConfig {
        applicationId = "${o.appId}"
        minSdk = ${o.minSdk}
        targetSdk = ${o.targetSdk}
        versionCode = ${o.versionCode}
        versionName = "${o.version}"

        // The engine ships as prebuilt libraries under src/main/jniLibs; this is
        // the set of architectures they were built for.
        ndk {
            abiFilters += listOf(${abis})
        }
    }

    // The host maps its libraries out of the installed package, which is also what
    // lets an App Bundle split them per device.
    packaging {
        jniLibs {
            useLegacyPackaging = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Add a signingConfig here to build an upload-ready release. Until then
            // \`assembleRelease\` produces an unsigned APK and \`assembleDebug\` a
            // debug-signed one that installs on a device.
        }
    }
}

dependencies {
    // Your SDKs go here — this project is an ordinary Android application.
}
`;
}

export function renderGradleProperties() {
    return `org.gradle.jvmargs=-Xmx2048m
android.useAndroidX=true
android.nonTransitiveRClass=true
`;
}

export function renderProjectReadme(o) {
    return `# ${o.name}

An Android Studio project exported from Estella. Open this folder in Android
Studio (or run \`gradle :app:assembleDebug\`) — no Android SDK setup beyond the
one Studio installs, and no Estella toolchain.

## What is here

    app/src/main/assets/      the exported game: cooked content + its configs
    app/src/main/jniLibs/     the engine, prebuilt for ${o.abis.join(' and ')}
    app/src/main/java/        the host's Java shim (the IME side of a text field)
    app/src/main/res/         the launcher icon
    app/src/main/AndroidManifest.xml
    app/build.gradle.kts      identity, SDK levels, and where your SDKs go

## Adding an SDK

Add the dependency in \`app/build.gradle.kts\` and whatever the SDK asks of the
manifest. The game itself is native and starts from \`NativeActivity\`; a Java SDK
that needs an entry point can subclass it and name the subclass in the manifest.

## Re-exporting

Exporting again from Estella rewrites \`app/src/main/assets\`, the manifest, the
libraries and the icon — the content, in other words. \`app/build.gradle.kts\` and
anything else you edit is left alone.
`;
}

export function renderGitignore() {
    return `.gradle/
build/
local.properties
.idea/
*.iml
`;
}

/**
 * Write the Android Studio project into an export, in place: the export directory
 * BECOMES the project. The cooked content moves once, into the module's assets —
 * where Gradle expects it and where the host reads it from the installed package,
 * so the layout inside an APK is byte-for-byte what the one-click path produces.
 *
 * Re-exporting overwrites what the export owns and leaves the build scripts alone,
 * so a project that has grown an SDK survives its game being rebuilt.
 *
 * @param {string} contentDir  The export (cooked content + the two configs).
 * @param {{id: string, name: string, version: string, versionCode: number,
 *          orientation: 'landscape'|'portrait'}} app  From `app.config.json`.
 * @param {{libs: string, java: string, manifestIn: string, icon: string,
 *          bytecode?: string}} sources  Out of the installed runtime template.
 * @param {Buffer} [icon] The launcher icon; the template's default when absent.
 * @returns {Promise<string>} The project directory, to reveal or open.
 */
export async function emitAndroidGradleProject(contentDir, app, sources, icon) {
    const name = projectName(app.name);
    const appDir = path.join(contentDir, 'app');
    const mainDir = path.join(appDir, 'src', 'main');
    const assetsDir = path.join(mainDir, 'assets');

    const abis = (await readdir(sources.libs, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    if (abis.length === 0) {
        throw new Error(`The runtime template at ${sources.libs} carries no native libraries.`);
    }

    // Everything the export wrote, before this function adds anything that could be
    // mistaken for it.
    const exported = (await readdir(contentDir, { withFileTypes: true }))
        .filter((e) => !PROJECT_ENTRIES.includes(e.name))
        .map((e) => e.name);

    // The generated half is rewritten wholesale so a re-export cannot inherit the
    // last one's assets, libraries or manifest. The build scripts are not in here:
    // they are the half the user owns.
    await rm(path.join(mainDir, 'assets'), { recursive: true, force: true });
    await rm(path.join(mainDir, 'jniLibs'), { recursive: true, force: true });
    await rm(path.join(mainDir, 'java'), { recursive: true, force: true });
    await rm(path.join(mainDir, 'res'), { recursive: true, force: true });

    await mkdir(assetsDir, { recursive: true });
    for (const entry of exported) {
        await rename(path.join(contentDir, entry), path.join(assetsDir, entry));
    }

    // The SDK bytecode rides along as an asset, where the host's reader finds it —
    // without it the first launch after an install spends seconds compiling.
    if (sources.bytecode && existsSync(sources.bytecode)) {
        await cp(sources.bytecode, path.join(assetsDir, path.basename(sources.bytecode)));
    }

    await cp(sources.libs, path.join(mainDir, 'jniLibs'), { recursive: true });
    if (existsSync(sources.java)) {
        await cp(sources.java, path.join(mainDir, 'java'), { recursive: true });
    }

    const manifest = gradleManifest(await readFile(sources.manifestIn, 'utf8'), app);
    await writeFile(path.join(mainDir, 'AndroidManifest.xml'), manifest.xml);

    const iconDir = path.join(mainDir, 'res', 'mipmap-xxxhdpi');
    await mkdir(iconDir, { recursive: true });
    await writeFile(path.join(iconDir, 'ic_launcher.png'), icon ?? await readFile(sources.icon));

    await writeIfAbsent(path.join(appDir, 'build.gradle.kts'), renderAppGradle({
        appId: app.id,
        version: app.version,
        versionCode: app.versionCode,
        minSdk: manifest.minSdk,
        targetSdk: manifest.targetSdk,
        abis,
    }));
    await writeIfAbsent(path.join(contentDir, 'settings.gradle.kts'), renderSettingsGradle(name));
    await writeIfAbsent(path.join(contentDir, 'build.gradle.kts'), renderRootGradle());
    await writeIfAbsent(path.join(contentDir, 'gradle.properties'), renderGradleProperties());
    await writeIfAbsent(path.join(contentDir, '.gitignore'), renderGitignore());
    await writeIfAbsent(path.join(contentDir, 'README.md'), renderProjectReadme({ name, abis }));

    return contentDir;
}

/** Write a file the user is expected to edit — once, and never over their copy. */
async function writeIfAbsent(file, contents) {
    if (existsSync(file)) return;
    await writeFile(file, contents);
}

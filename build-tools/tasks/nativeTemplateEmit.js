// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Emitting a runtime template — the ONLY step that knows about build trees.
//
// Everything downstream (the editor's iOS project, the APK assembler) reads a
// template and never a build directory, so the toolchain that produced these
// binaries has to exist on exactly one machine: this one. Shipping the result is
// what frees a user from cloning the engine, building Dawn and installing an NDK
// to put a game on a phone.

import path from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { mkdir, rm, cp, readdir } from 'fs/promises';
import config from '../build.config.js';
import * as logger from '../utils/logger.js';
import { runCommand } from '../utils/emscripten.js';
import { buildTool, platformJar, ndkTool, ndkLibcxxShared, jdkTool } from '../utils/android.js';
import { makeZip, zipTree } from '../utils/zip.js';
import {
    templateLayout, templateId, ANDROID_ABIS, templateAbis, writeTemplateManifest,
    missingTemplateFiles, installedTemplateDir, templateZipName, TEMPLATE_INDEX, TEMPLATE_FORMAT,
} from '../utils/nativeTemplate.js';

/** The Java shim's sources — the IME's own side of an editable field, which has to
 *  be Java because only a Java View gets an InputConnection to compose into. */
const JAVA_DIR = path.join('native', 'android', 'java');

/** The NDK triple an ABI's sysroot lives under. */
const ABI_TRIPLE = {
    'arm64-v8a': 'aarch64-linux-android',
    'x86_64': 'x86_64-linux-android',
};

/**
 * The version a template is stamped with — `desktop/package.json`, which is also
 * what `app.getVersion()` reports in the editor. The two must be the same number:
 * matching them is how the editor refuses a template built for another release.
 */
export function readEngineVersion(root = config.paths.root) {
    return JSON.parse(readFileSync(path.join(root, 'desktop', 'package.json'), 'utf8')).version;
}

/**
 * Compile the Java shim to a `classes.dex` in @p outDir. javac + d8 come from the
 * JDK and the build-tools this machine already needed to produce the binaries, so
 * the template carries the dex and no user needs a JDK to package.
 *
 * @returns Whether a dex was produced — false leaves an app whose host reports no
 *          editing surface, rather than one that cannot be built at all.
 */
export async function compileJavaShim(outDir, { sdk, androidPlatform, jdk, root }) {
    const sourceDir = path.join(root, JAVA_DIR);
    if (!existsSync(sourceDir)) return false;
    const sources = (await readdir(sourceDir, { recursive: true }))
        .filter((f) => String(f).endsWith('.java'))
        .map((f) => path.join(sourceDir, String(f)));
    if (sources.length === 0) return false;

    const classes = path.join(outDir, 'classes');
    await mkdir(classes, { recursive: true });
    // Java 8 bytecode: d8 accepts it everywhere, and the shim uses nothing newer.
    await runCommand(jdkTool('javac', jdk), [
        // The sources are UTF-8; javac otherwise reads them in the platform's
        // default charset, which on a Windows build machine is not.
        '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-nowarn',
        '-bootclasspath', platformJar(sdk, androidPlatform),
        '-d', classes, ...sources,
    ]);
    const classFiles = (await readdir(classes, { recursive: true }))
        .filter((f) => String(f).endsWith('.class'))
        .map((f) => path.join(classes, String(f)));
    await runCommand(buildTool(sdk, 'd8'), ['--lib', platformJar(sdk, androidPlatform), '--output', outDir, ...classFiles]);
    await rm(classes, { recursive: true, force: true });
    return existsSync(path.join(outDir, 'classes.dex'));
}

/**
 * Write the index a release publishes beside its template archives: what exists
 * for this version, and what each archive must hash to.
 *
 * A separate step from emitting, because the set spans machines — the iOS archive
 * is built on a Mac and the Android one is not — so only the job that has both
 * can describe them.
 *
 * @param {string} dir Directory holding the archives.
 * @returns {Promise<{file: string, templates: object[]}>}
 */
export async function writeTemplateIndex(dir, options = {}) {
    const engineVersion = options.engineVersion || readEngineVersion(options.root);
    const suffix = `-${engineVersion}.zip`;
    const archives = (await readdir(dir))
        .filter((f) => f.startsWith('estella-native-') && f.endsWith(suffix))
        .sort();
    if (archives.length === 0) {
        throw new Error(`No template archives for v${engineVersion} in ${dir}.`);
    }

    const templates = archives.map((file) => {
        const bytes = readFileSync(path.join(dir, file));
        const id = file.slice('estella-native-'.length, -suffix.length);
        return {
            id,
            platform: id,
            file,
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
        };
    });

    const out = path.join(dir, TEMPLATE_INDEX);
    writeFileSync(out, `${JSON.stringify({
        kind: 'estella-native-templates',
        formatVersion: TEMPLATE_FORMAT,
        engineVersion,
        templates,
    }, null, 2)}\n`, 'utf8');
    logger.success(`Template index: ${out} (${templates.map((t) => t.id).join(', ')})`);
    return { file: out, templates };
}

/**
 * Pack a finished native build into a runtime template.
 *
 * @param {object} options
 * @param {'android'|'ios'} options.platform
 * @param {(abi: string) => string|null} [options.dawnLibrary] Android: where each
 *        ABI's Dawn library is, if it was built.
 * @param {string}  [options.ndk]         Android: for llvm-strip and libc++_shared.
 * @param {string}  [options.sdk]         Android: for d8 (the Java shim).
 * @param {string}  [options.outDir]      Defaults to this machine's template store.
 * @param {string}  [options.zipTo]       Also write the distributable archive here.
 * @returns {Promise<{dir: string, manifest: object, zip: string|null}>}
 */
export async function emitNativeTemplate(options) {
    const root = options.root || config.paths.root;
    const platform = options.platform;
    const engineVersion = readEngineVersion(root);
    const dir = options.outDir || installedTemplateDir(engineVersion, platform);

    const ctx = {
        root,
        dawnLibrary: options.dawnLibrary,
        libcxxShared: (abi) => (platform === 'android' && options.ndk && ABI_TRIPLE[abi]
            ? ndkLibcxxShared(options.ndk, ABI_TRIPLE[abi]) : null),
    };

    // What the previous emit left, so an ABI built on an earlier run survives one
    // that only rebuilt another — and nothing else does. A template that inherited
    // a file from the previous RELEASE is the failure the version stamp prevents;
    // one that keeps an architecture from an hour ago is the point.
    const kept = platform === 'android' && existsSync(dir)
        ? templateAbis(dir).filter((abi) => !options.abis || !options.abis.includes(abi))
        : [];
    const carry = kept.map((abi) => ({ abi, files: templateLayout('android', { abis: [abi] })
        .filter((e) => e.abi === abi)
        .map((e) => ({ rel: e.rel, data: readFileSync(path.join(dir, e.rel)) })) }));

    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    for (const { files } of carry) {
        for (const file of files) {
            await mkdir(path.dirname(path.join(dir, file.rel)), { recursive: true });
            writeFileSync(path.join(dir, file.rel), file.data);
        }
    }

    for (const entry of templateLayout(platform, { abis: options.abis })) {
        if (entry.produced) continue;
        const src = entry.from(ctx);
        const dest = path.join(dir, entry.rel);
        if (!src || !existsSync(src)) {
            if (entry.optional) {
                if (!kept.includes(entry.abi)) {
                    logger.warn(`Template omits ${entry.rel} (not built): ${src ?? 'no source'}`);
                }
                continue;
            }
            throw new Error(`Cannot emit the ${platform} template: ${entry.rel} is missing at ${src ?? '<unset>'}.`);
        }
        await mkdir(path.dirname(dest), { recursive: true });
        if (entry.strip && platform === 'macos') {
            // `strip` happens to re-sign today, but an arm64 binary whose
            // signature does not match its bytes is KILLED at launch — too much to
            // leave to a side effect.
            await cp(src, dest);
            await runCommand('strip', ['-x', dest]);
            await runCommand('codesign', ['--force', '--sign', '-', dest]);
        } else if (entry.strip) {
            await runCommand(ndkTool(options.ndk, 'llvm-strip'), ['--strip-all', '-o', dest, src]);
        } else {
            await cp(src, dest, { recursive: entry.kind === 'dir' });
        }
    }

    if (platform === 'android') {
        if (!await compileJavaShim(dir, { sdk: options.sdk, androidPlatform: options.androidPlatform, jdk: options.jdk, root })) {
            throw new Error('Cannot emit the android template: the Java shim produced no classes.dex '
                + '(the packaged app would have no soft keyboard).');
        }
    }

    const manifest = writeTemplateManifest(dir, {
        platform,
        engineVersion,
        spineVersion: options.spineVersion || '4.2',
        ...(platform === 'ios' ? { deploymentTarget: options.deploymentTarget || '17.0' } : {}),
        ...(platform === 'android'
            ? { androidPlatform: options.androidPlatform || 'android-29', abis: templateAbis(dir) }
            : {}),
    });

    const missing = missingTemplateFiles(dir, platform);
    if (missing.length) throw new Error(`Emitted template is incomplete: ${missing.join(', ')}`);

    logger.success(`Runtime template: ${dir}`);

    let zip = null;
    if (options.zipTo) {
        await mkdir(options.zipTo, { recursive: true });
        zip = path.join(options.zipTo, templateZipName(platform, engineVersion));
        writeFileSync(zip, makeZip(zipTree(dir)));
        logger.success(`Template archive: ${zip} (${(readFileSync(zip).length / 1048576).toFixed(1)} MB)`);
    }
    logger.info(`The editor picks it up as ${templateId(platform)} for v${engineVersion}`
        + `${manifest.abis ? ` (${manifest.abis.join(', ')})` : ''}.`);
    return { dir, manifest, zip };
}

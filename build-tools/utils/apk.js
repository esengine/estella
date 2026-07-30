// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The APK assembler — an installable Android package with no Android SDK.
//
// What packaging actually is, once the engine ships as a prebuilt runtime
// template: compile the manifest, put four kinds of file in a zip, and sign it.
// The tools that used to do those steps (aapt2, zipalign, apksigner, plus a JDK to
// run the last one) are ~6 GB of Android Studio for three well-specified formats,
// and they are the reason a developer with a finished game still could not press
// one button. Each has a written spec; each is implemented here, and each is
// checked against an independent implementation in the tests.
//
// Native libraries are STORED and 16 KiB-aligned, with extractNativeLibs=false:
// the OS maps them straight out of the package, which halves the install and is
// the posture Android 15's 16 KiB page size requires anyway.

import path from 'path';
import { createHash, createPublicKey, sign as cryptoSign } from 'crypto';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { makeZip, zipLayout } from './zip.js';
import { compileManifest } from './androidBinaryXml.js';
import { appResources } from './androidResources.js';
import { DEFAULT_ICON, templateAbis } from './nativeTemplate.js';
import { fillTemplate, androidScreenOrientation } from './nativeApp.js';

/** The boundary a mapped `.so` must start on — a 16 KiB page, which every
 *  smaller page size also divides. */
const PAGE_ALIGNMENT = 16384;

/** APK Signature Scheme v2. minSdk 29 is well past the API 24 that introduced it,
 *  so v1 (JAR signing) would be dead weight — and its PKCS#7 is the only part of
 *  APK signing that is genuinely hard to write. */
const V2_BLOCK_ID = 0x7109871a;
const SIG_ALGO_RSA_PKCS1_SHA256 = 0x0103;
const APK_SIG_BLOCK_MAGIC = Buffer.from('APK Sig Block 42', 'latin1');
const DIGEST_CHUNK = 1048576;

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n), 0); return b; };
const lenPrefixed = (buf) => Buffer.concat([u32(buf.length), buf]);
/** A length-prefixed sequence of length-prefixed items — the shape the spec
 *  repeats at every level. */
const seq = (items) => lenPrefixed(Buffer.concat(items.map(lenPrefixed)));

/**
 * The APK digest: 1 MiB chunks of the three sections, each digested with a 0xa5
 * prefix, then one digest over all of them with 0x5a. Verbatim from the scheme —
 * chunking is what lets a device verify an APK without reading it twice.
 */
function apkDigest(sections) {
    const chunks = [];
    for (const section of sections) {
        for (let at = 0; at < section.length; at += DIGEST_CHUNK) {
            chunks.push(section.subarray(at, Math.min(at + DIGEST_CHUNK, section.length)));
        }
    }
    const digests = chunks.map((chunk) => createHash('sha256')
        .update(Buffer.from([0xa5])).update(u32(chunk.length)).update(chunk).digest());
    return createHash('sha256')
        .update(Buffer.from([0x5a])).update(u32(chunks.length)).update(Buffer.concat(digests)).digest();
}

/**
 * Sign a finished zip, returning the APK.
 *
 * The signing block goes between the entries and the central directory, so the
 * end-of-central-directory record's pointer moves. The digest is taken over the
 * EOCD as if the central directory sat where the block now starts — the verifier
 * makes the same substitution, which is what lets the signature cover a record
 * that the signature's own insertion changes.
 *
 * @param {Buffer} zip
 * @param {{privateKey: import('crypto').KeyObject, certificate: Buffer}} key
 * @returns {Buffer}
 */
export function signApkV2(zip, key) {
    const { centralDirOffset, centralDirSize, eocdOffset } = zipLayout(zip);
    const contents = zip.subarray(0, centralDirOffset);
    const centralDir = zip.subarray(centralDirOffset, centralDirOffset + centralDirSize);
    const eocd = Buffer.from(zip.subarray(eocdOffset));
    eocd.writeUInt32LE(contents.length, 16);

    const digest = apkDigest([contents, centralDir, eocd]);
    const publicKey = createPublicKey(key.privateKey).export({ type: 'spki', format: 'der' });

    const signedData = Buffer.concat([
        seq([Buffer.concat([u32(SIG_ALGO_RSA_PKCS1_SHA256), lenPrefixed(digest)])]),
        seq([key.certificate]),
        seq([]),                                     // no additional attributes
    ]);
    const signature = cryptoSign('sha256', signedData, key.privateKey);
    const signer = Buffer.concat([
        lenPrefixed(signedData),
        seq([Buffer.concat([u32(SIG_ALGO_RSA_PKCS1_SHA256), lenPrefixed(signature)])]),
        lenPrefixed(publicKey),
    ]);

    const pair = Buffer.concat([u64(4 + seq([signer]).length), u32(V2_BLOCK_ID), seq([signer])]);
    const blockSize = pair.length + 8 + APK_SIG_BLOCK_MAGIC.length;
    const block = Buffer.concat([u64(blockSize), pair, u64(blockSize), APK_SIG_BLOCK_MAGIC]);

    const signedEocd = Buffer.from(eocd);
    signedEocd.writeUInt32LE(contents.length + block.length, 16);
    return Buffer.concat([contents, block, centralDir, signedEocd]);
}

/**
 * Every file under `dir`, as `{ name, data }` entries named `<prefix>/<rel>`.
 *
 * Dotfiles stay out — build-machine litter (.DS_Store, .gitkeep) is not something
 * to find out about from a shipped package — and so do packages: the finished .apk
 * and .aab land in the export directory, and a re-export must not swallow the last
 * one. Shared with the bundle assembler, which packs the same content.
 */
export function packageEntries(dir, prefix) {
    const out = [];
    const walk = (abs, rel) => {
        for (const e of readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const child = path.join(abs, e.name);
            const name = `${rel}/${e.name}`;
            if (e.isDirectory()) walk(child, name);
            else if (e.isFile() && !e.name.startsWith('.') && !/\.(apk|aab)$/.test(e.name)) {
                out.push({ name, data: readFileSync(child) });
            }
        }
    };
    walk(dir, prefix);
    return out;
}

/**
 * Assemble a signed APK from a runtime template and an editor export.
 *
 * @param {object} options
 * @param {string} options.templateDir  An installed android runtime template.
 * @param {string} options.contentDir   The export (cooked content + the configs).
 * @param {{id: string, name: string, version: string, versionCode: number,
 *          orientation: 'landscape'|'portrait'}} options.app
 * @param {{privateKey: import('crypto').KeyObject, certificate: Buffer}} options.key
 * @param {Buffer}  [options.icon] The launcher icon; the template's default when absent.
 * @returns {Buffer} the signed package.
 */
export function assembleApk(options) {
    const { templateDir, contentDir, app } = options;
    const dex = path.join(templateDir, 'classes.dex');
    const hasDex = existsSync(dex);
    const resources = appResources(options.icon ?? readFileSync(path.join(templateDir, DEFAULT_ICON)));

    const manifest = compileManifest(fillTemplate(
        readFileSync(path.join(templateDir, 'AndroidManifest.xml.in'), 'utf8'), {
            APP_ID: app.id,
            APP_NAME: app.name,
            VERSION_NAME: app.version,
            VERSION_CODE: app.versionCode,
            SCREEN_ORIENTATION: androidScreenOrientation(app.orientation),
            HAS_CODE: hasDex ? 'true' : 'false',
        }), resources.references);

    // Every architecture the template carries, so one package installs on a phone
    // and in an emulator alike — the device picks the one it can run.
    const abis = templateAbis(templateDir);
    if (abis.length === 0) throw new Error('The runtime template carries no native libraries.');
    const templateAssets = path.join(templateDir, 'assets');

    const entries = [
        { name: 'AndroidManifest.xml', data: manifest },
        // Stored and aligned like the libraries: the resource table is mmapped too.
        { name: 'resources.arsc', data: resources.arsc, store: true, align: 4 },
        ...resources.files,
        ...(hasDex ? [{ name: 'classes.dex', data: readFileSync(dex) }] : []),
        ...abis.flatMap((abi) => packageEntries(path.join(templateDir, 'lib', abi), `lib/${abi}`)
            .map((e) => ({ ...e, store: true, align: PAGE_ALIGNMENT }))),
        // The template's assets (the SDK bytecode) first, so a project cannot
        // shadow them by accident and quietly change what the host boots.
        ...(existsSync(templateAssets) ? packageEntries(templateAssets, 'assets') : []),
        ...packageEntries(contentDir, 'assets'),
    ];

    const seen = new Set();
    for (const entry of entries) {
        if (seen.has(entry.name)) throw new Error(`Two files claim ${entry.name} in the package.`);
        seen.add(entry.name);
    }

    return signApkV2(makeZip(entries), options.key);
}

/** The APK is named after the app it holds, so packaging a second project does not
 *  quietly replace the first one's file. */
export function apkFileName(appId) {
    return `${appId.split('.').pop() || 'estella'}.apk`;
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The Android App Bundle — what Google Play takes.
//
// Play has required an .aab rather than an .apk for new apps since 2021, so
// without this "you can package for Android" stops at sideloading. It is the same
// content as the APK from the same template, rearranged and encoded differently:
//
//   * the manifest is protobuf (androidProtoXml.js) rather than binary XML;
//   * everything lives under `base/`, split by kind — Play recompiles it into
//     per-device APKs, which is the point of the format;
//   * it is a JAR, so it is signed the JAR way rather than with APK Signature
//     Scheme v2.
//
// The store's own server does the final packaging, which is why nothing here is
// installable: `bundletool build-apks` (or Play) turns it into APKs.

import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { makeZip } from './zip.js';
import { packageEntries } from './apk.js';
import { message, bytesField } from './protobuf.js';
import { compileProtoManifest } from './androidProtoXml.js';
import { appResources } from './androidResources.js';
import { DEFAULT_ICON, templateAbis } from './nativeTemplate.js';
import { jarSignatureFiles } from './jarSign.js';
import { fillTemplate, androidScreenOrientation } from './nativeApp.js';

/**
 * BundleConfig.pb — `bundletool { version = 2 }`, `compression { uncompressed_glob = 1 }`.
 *
 * The glob is the same posture the APK takes: native libraries stay uncompressed
 * so the OS can map them out of the installed package.
 */
function bundleConfig() {
    return message(
        bytesField(1, message(bytesField(2, '1.15.6'))),
        bytesField(3, message(bytesField(1, '**.so'))),
    );
}

/**
 * Assemble a signed App Bundle from a runtime template and an editor export.
 *
 * @param {object} options Same shape as {@link import('./apk.js').assembleApk}.
 * @returns {Buffer} the signed bundle.
 */
export function assembleAab(options) {
    const { templateDir, contentDir, app } = options;
    const dex = path.join(templateDir, 'classes.dex');
    const hasDex = existsSync(dex);
    const resources = appResources(options.icon ?? readFileSync(path.join(templateDir, DEFAULT_ICON)));

    const manifest = compileProtoManifest(fillTemplate(
        readFileSync(path.join(templateDir, 'AndroidManifest.xml.in'), 'utf8'), {
            APP_ID: app.id,
            APP_NAME: app.name,
            VERSION_NAME: app.version,
            VERSION_CODE: app.versionCode,
            SCREEN_ORIENTATION: androidScreenOrientation(app.orientation),
            HAS_CODE: hasDex ? 'true' : 'false',
        }), resources.references);

    // Every architecture: Play splits the bundle per device, which is what the
    // format is for.
    const abis = templateAbis(templateDir);
    if (abis.length === 0) throw new Error('The runtime template carries no native libraries.');
    const templateAssets = path.join(templateDir, 'assets');

    const entries = [
        { name: 'BundleConfig.pb', data: bundleConfig() },
        { name: 'base/manifest/AndroidManifest.xml', data: manifest },
        { name: 'base/resources.pb', data: resources.pb },
        ...resources.files.map((f) => ({ ...f, name: `base/${f.name}` })),
        ...(hasDex ? [{ name: 'base/dex/classes.dex', data: readFileSync(dex) }] : []),
        ...abis.flatMap((abi) => packageEntries(path.join(templateDir, 'lib', abi), `base/lib/${abi}`)),
        ...(existsSync(templateAssets) ? packageEntries(templateAssets, 'base/assets') : []),
        ...packageEntries(contentDir, 'base/assets'),
    ];

    // The signature covers the entries, so it is computed over them and added
    // afterwards — and it goes FIRST in the archive, where a JAR reader expects the
    // manifest to be.
    return makeZip([...jarSignatureFiles(entries, options.key), ...entries]);
}

/** The bundle is named after the app it holds, like the APK beside it. */
export function aabFileName(appId) {
    return `${appId.split('.').pop() || 'estella'}.aab`;
}

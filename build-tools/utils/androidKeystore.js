// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The key an APK is signed with.
//
// Android needs every package signed, including one you only sideload to try it.
// That used to mean keytool, a JKS file and a JDK; here it is an RSA key and a
// self-signed certificate in PEM, which Node's crypto reads and writes and which
// `openssl x509 -in cert.pem -text` will show you.
//
// PEM rather than JKS/PKCS#12 deliberately: those are container formats Node
// cannot open, and the one thing worse than an unfamiliar file is one you cannot
// inspect. A developer with an existing store exports it once
// (`keytool -importkeystore` / `openssl pkcs12`) and points --key/--cert at it.

import path from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign as cryptoSign, X509Certificate } from 'crypto';
import { estellaDataDir } from './nativeTemplate.js';
import { selfSignedCertificate } from './asn1.js';

/** Where the generated development key lives. */
export function debugKeyDir() {
    return process.env.ESTELLA_ANDROID_KEYS || path.join(estellaDataDir(), 'android-keys');
}

const PEM_BODY = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/;

/** DER bytes of a PEM certificate (the first one in the file). */
function certificateDer(pem) {
    const body = PEM_BODY.exec(pem);
    if (!body) throw new Error('not a PEM certificate (no -----BEGIN CERTIFICATE-----)');
    return Buffer.from(body[1].replace(/\s+/g, ''), 'base64');
}

/**
 * A signing identity: the private key, and the certificate that goes in the APK.
 *
 * @typedef {{privateKey: import('crypto').KeyObject, certificate: Buffer, name: string}} SigningKey
 */

/**
 * The development key, generated on first use.
 *
 * A game you are testing has to install, and stopping to ask for credentials to
 * do that is how packaging becomes a chore. This key is exactly as trustworthy as
 * Android Studio's debug keystore: fine for a device, never for a store.
 *
 * @returns {SigningKey}
 */
export function debugSigningKey() {
    const dir = debugKeyDir();
    const keyFile = path.join(dir, 'debug.key.pem');
    const certFile = path.join(dir, 'debug.cert.pem');

    if (existsSync(keyFile) && existsSync(certFile)) {
        return {
            privateKey: createPrivateKey(readFileSync(keyFile, 'utf8')),
            certificate: certificateDer(readFileSync(certFile, 'utf8')),
            name: 'Estella debug key',
        };
    }

    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const certificate = selfSignedCertificate(publicKey, {
        commonName: 'Estella Debug',
        organization: 'Estella',
        // Longer than any app that was only ever sideloaded will live, and past
        // the point where a store would accept it anyway.
        days: 365 * 30,
        notBefore: new Date(Date.now() - 86400000),
        sign: (data) => cryptoSign('sha256', data, privateKey),
    });

    mkdirSync(dir, { recursive: true });
    writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    // The key is the app's identity: an update signed by another key is refused by
    // every device that has the old one installed.
    try { chmodSync(keyFile, 0o600); } catch { /* best effort — Windows has no mode */ }
    writeFileSync(certFile, `-----BEGIN CERTIFICATE-----\n${
        certificate.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '')}\n-----END CERTIFICATE-----\n`);
    return { privateKey, certificate, name: 'Estella debug key' };
}

/**
 * A release identity from the developer's own PEM key + certificate.
 *
 * @param {{key: string, cert: string, passphrase?: string}} files
 * @returns {SigningKey}
 */
export function signingKeyFromPem(files) {
    const privateKey = createPrivateKey({
        key: readFileSync(files.key, 'utf8'),
        ...(files.passphrase ? { passphrase: files.passphrase } : {}),
    });
    const certificate = certificateDer(readFileSync(files.cert, 'utf8'));
    // The pair has to match, and finding out on the device ("app not installed")
    // is the worst possible time.
    const cert = new X509Certificate(certificate);
    if (!cert.publicKey.export({ type: 'spki', format: 'der' })
        .equals(createPublicKey(privateKey).export({ type: 'spki', format: 'der' }))) {
        throw new Error(`${path.basename(files.cert)} does not certify the key in ${path.basename(files.key)}.`);
    }
    return { privateKey, certificate, name: cert.subject.replace(/\n/g, ', ') };
}

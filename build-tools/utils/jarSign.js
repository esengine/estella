// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// JAR signing — the scheme an Android App Bundle is signed with.
//
// An APK gets APK Signature Scheme v2, which signs the archive's bytes and is
// simple because of it. A bundle is not an APK: Play takes it as a JAR, so it is
// signed the JAR way — a manifest of per-entry digests, a signature file digesting
// that manifest, and a PKCS#7 block signing the signature file. Three files and
// one ASN.1 structure, and the only reason `jarsigner` (and the JDK under it) used
// to be required.

import { createHash, sign as cryptoSign } from 'crypto';
import { der, sequence, set, integer, octetString, nullValue, oid, explicit, certificateIssuerAndSerial } from './asn1.js';

const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';
const OID_DATA = '1.2.840.113549.1.7.1';
const OID_SHA256 = '2.16.840.1.101.3.4.2.1';
const OID_RSA = '1.2.840.113549.1.1.1';

/** A JAR manifest line, wrapped at 72 bytes with a leading space — mandated by the
 *  format, and reachable here by an asset path a game happens to have. */
function attributeLine(name, value) {
    const line = `${name}: ${value}`;
    let out = line.slice(0, 72);
    for (let at = 72; at < line.length; at += 71) out += `\r\n ${line.slice(at, at + 71)}`;
    return `${out}\r\n`;
}

const base64Digest = (data) => createHash('sha256').update(data).digest('base64');

/**
 * Sign a set of entries the JAR way.
 *
 * @param {ReadonlyArray<{name: string, data: Buffer}>} entries What the archive holds.
 * @param {{privateKey: import('crypto').KeyObject, certificate: Buffer}} key
 * @returns {Array<{name: string, data: Buffer}>} The three META-INF files to add.
 */
export function jarSignatureFiles(entries, key) {
    const manifestHeader = 'Manifest-Version: 1.0\r\nCreated-By: Estella\r\n\r\n';
    // Each entry's section is digested on its own for the signature file, so they
    // are built as sections rather than as one string that would have to be split.
    const sections = entries.map((entry) => attributeLine('Name', entry.name)
        + attributeLine('SHA-256-Digest', base64Digest(entry.data)) + '\r\n');
    const manifest = Buffer.from(manifestHeader + sections.join(''), 'utf8');

    const signatureFile = Buffer.from(
        'Signature-Version: 1.0\r\nCreated-By: Estella\r\n'
        + attributeLine('SHA-256-Digest-Manifest', base64Digest(manifest))
        + '\r\n'
        + entries.map((entry, n) => attributeLine('Name', entry.name)
            + attributeLine('SHA-256-Digest', base64Digest(Buffer.from(sections[n], 'utf8'))) + '\r\n').join(''),
        'utf8');

    const { issuer, serial } = certificateIssuerAndSerial(key.certificate);
    const digestAlgorithm = sequence(oid(OID_SHA256), nullValue());
    const signerInfo = sequence(
        integer(1),
        sequence(issuer, serial),
        digestAlgorithm,
        sequence(oid(OID_RSA), nullValue()),
        // No authenticated attributes, so the signature is over the signature
        // file itself — the simplest form the verifier accepts.
        octetString(cryptoSign('sha256', signatureFile, key.privateKey)),
    );
    const signedData = sequence(
        integer(1),
        set(digestAlgorithm),
        sequence(oid(OID_DATA)),                     // detached: the content is CERT.SF
        der(0xa0, key.certificate),                  // [0] IMPLICIT certificates
        set(signerInfo),
    );
    const block = sequence(oid(OID_SIGNED_DATA), explicit(0, signedData));

    return [
        { name: 'META-INF/MANIFEST.MF', data: manifest },
        { name: 'META-INF/ESTELLA.SF', data: signatureFile },
        { name: 'META-INF/ESTELLA.RSA', data: block },
    ];
}

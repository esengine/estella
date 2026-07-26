// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// DER, and the one certificate we have to write ourselves.
//
// Signing an APK needs a private key AND an X.509 certificate. Node's crypto can
// generate the key and produce the signature, but it cannot make a certificate —
// which is the only reason the whole Java toolchain (keytool, apksigner) used to
// be on the path between an editor and an installable app. A self-signed leaf is
// a few DER structures; they are here.

import { createHash } from 'crypto';

/** A DER TLV: tag, definite length, contents. */
export function der(tag, contents) {
    const body = Buffer.isBuffer(contents) ? contents : Buffer.concat(contents);
    if (body.length < 0x80) return Buffer.concat([Buffer.from([tag, body.length]), body]);
    const len = [];
    for (let n = body.length; n > 0; n >>>= 8) len.unshift(n & 0xff);
    return Buffer.concat([Buffer.from([tag, 0x80 | len.length]), Buffer.from(len), body]);
}

export const sequence = (...items) => der(0x30, items.flat());
export const set = (...items) => der(0x31, items.flat());
export const octetString = (buf) => der(0x04, buf);
export const nullValue = () => der(0x05, Buffer.alloc(0));
export const utf8String = (s) => der(0x0c, Buffer.from(s, 'utf8'));
export const printableString = (s) => der(0x13, Buffer.from(s, 'latin1'));
export const explicit = (n, inner) => der(0xa0 | n, inner);

/** A positive INTEGER; a leading 0x00 keeps it from reading as negative. */
export function integer(value) {
    let bytes = Buffer.isBuffer(value) ? value : (() => {
        const out = [];
        let n = BigInt(value);
        do { out.unshift(Number(n & 0xffn)); n >>= 8n; } while (n > 0n);
        return Buffer.from(out);
    })();
    while (bytes.length > 1 && bytes[0] === 0 && (bytes[1] & 0x80) === 0) bytes = bytes.subarray(1);
    return der(0x02, bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
}

/** A BIT STRING with no unused trailing bits — the only kind a certificate uses. */
export const bitString = (buf) => der(0x03, Buffer.concat([Buffer.from([0]), buf]));

export function oid(dotted) {
    const parts = dotted.split('.').map(Number);
    const bytes = [parts[0] * 40 + parts[1]];
    for (const part of parts.slice(2)) {
        const chunk = [part & 0x7f];
        for (let n = part >>> 7; n > 0; n >>>= 7) chunk.unshift((n & 0x7f) | 0x80);
        bytes.push(...chunk);
    }
    return der(0x06, Buffer.from(bytes));
}

const OID_SHA256_RSA = '1.2.840.113549.1.1.11';
const OID_COMMON_NAME = '2.5.4.3';
const OID_ORGANIZATION = '2.5.4.10';

/** RFC 5280: UTCTime through 2049, GeneralizedTime from 2050. */
function time(date) {
    const p = (n, w = 2) => String(n).padStart(w, '0');
    const y = date.getUTCFullYear();
    const rest = `${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}`
        + `${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
    return y < 2050
        ? der(0x17, Buffer.from(`${p(y % 100)}${rest}`, 'latin1'))
        : der(0x18, Buffer.from(`${p(y, 4)}${rest}`, 'latin1'));
}

const name = (commonName, organization) => sequence(
    set(sequence(oid(OID_COMMON_NAME), utf8String(commonName))),
    set(sequence(oid(OID_ORGANIZATION), utf8String(organization))),
);

/**
 * A self-signed X.509 certificate for @p publicKey, signed with @p privateKey.
 *
 * Deliberately minimal — no extensions. Android identifies an app by the signing
 * certificate's bytes and public key; it does not build or validate a chain, so a
 * basicConstraints/keyUsage set here would be decoration that some other tool
 * might then hold us to.
 *
 * @param {import('crypto').KeyObject} privateKey
 * @param {import('crypto').KeyObject} publicKey
 * @param {{commonName: string, organization: string, days: number, notBefore: Date,
 *          serial?: bigint, sign: (data: Buffer) => Buffer}} options
 * @returns {Buffer} the certificate, DER-encoded.
 */
export function selfSignedCertificate(publicKey, options) {
    const spki = publicKey.export({ type: 'spki', format: 'der' });
    const algorithm = sequence(oid(OID_SHA256_RSA), nullValue());
    const notBefore = options.notBefore;
    const notAfter = new Date(notBefore.getTime() + options.days * 86400000);
    const subject = name(options.commonName, options.organization);

    const tbs = sequence(
        explicit(0, integer(2)),                       // v3
        integer(options.serial ?? BigInt(`0x${createHash('sha256').update(spki).digest('hex').slice(0, 16)}`)),
        algorithm,
        subject,                                       // issuer == subject: self-signed
        sequence(time(notBefore), time(notAfter)),
        subject,
        spki,
    );
    return sequence(tbs, algorithm, bitString(options.sign(tbs)));
}

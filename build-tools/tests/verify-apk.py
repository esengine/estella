# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#
# An independent APK verifier — the oracle for build-tools/utils/apk.js.
#
# We write the signature ourselves, so checking it with our own code would prove
# nothing. This is a second implementation of APK Signature Scheme v2, written
# from the spec and sharing no code with the signer: it finds the signing block,
# re-derives the chunked digest from the file's bytes, and verifies the RSA
# signature by hand (modular exponentiation + PKCS#1 v1.5 unpadding).
#
# Python 3 standard library only, so it runs wherever the tests do. If androguard
# happens to be installed it also decodes the binary manifest, which checks the
# other format we write ourselves.
#
# Usage: python3 verify-apk.py <apk>   → JSON on stdout, non-zero exit on failure.

import hashlib
import json
import struct
import sys

MAGIC = b"APK Sig Block 42"
V2_BLOCK_ID = 0x7109871A
SIG_RSA_PKCS1_SHA256 = 0x0103
CHUNK = 1048576
SHA256_DIGESTINFO = bytes.fromhex("3031300d060960864801650304020105000420")


def find_eocd(data):
    for i in range(len(data) - 22, max(-1, len(data) - 22 - 0xFFFF), -1):
        if data[i:i + 4] == b"PK\x05\x06":
            return i
    raise SystemExit("no end-of-central-directory record")


def read_len_prefixed(buf, at):
    (n,) = struct.unpack_from("<I", buf, at)
    return buf[at + 4:at + 4 + n], at + 4 + n


def iter_sequence(buf):
    at = 0
    while at < len(buf):
        item, at = read_len_prefixed(buf, at)
        yield item


def der_items(buf):
    """Walk DER TLVs, yielding (tag, content, whole TLV)."""
    at = 0
    while at < len(buf):
        start = at
        tag = buf[at]
        length = buf[at + 1]
        at += 2
        if length & 0x80:
            count = length & 0x7F
            length = int.from_bytes(buf[at:at + count], "big")
            at += count
        yield tag, buf[at:at + length], buf[start:at + length]
        at += length


def rsa_public_numbers(spki):
    """(n, e) from a SubjectPublicKeyInfo — the key is a BIT STRING holding
    RSAPublicKey ::= SEQUENCE { modulus INTEGER, publicExponent INTEGER }."""
    _, body, _ = next(der_items(spki))
    bit_string = [c for t, c, _ in der_items(body) if t == 0x03][0]
    _, rsa_key, _ = next(der_items(bit_string[1:]))   # [1:] drops the unused-bit count
    modulus, exponent = [int.from_bytes(c, "big") for t, c, _ in der_items(rsa_key) if t == 0x02][:2]
    return modulus, exponent


def verify_rsa_pkcs1_sha256(spki, signed, signature):
    n, e = rsa_public_numbers(spki)
    size = (n.bit_length() + 7) // 8
    decrypted = pow(int.from_bytes(signature, "big"), e, n).to_bytes(size, "big")
    expected = b"\x00\x01" + b"\xff" * (size - 3 - len(SHA256_DIGESTINFO) - 32) + b"\x00" \
        + SHA256_DIGESTINFO + hashlib.sha256(signed).digest()
    return decrypted == expected


def apk_digest(sections):
    chunks = []
    for section in sections:
        for at in range(0, len(section), CHUNK):
            chunks.append(section[at:at + CHUNK])
    digests = b"".join(
        hashlib.sha256(b"\xa5" + struct.pack("<I", len(c)) + c).digest() for c in chunks)
    return hashlib.sha256(b"\x5a" + struct.pack("<I", len(chunks)) + digests).digest()


def verify(path):
    data = open(path, "rb").read()
    eocd = find_eocd(data)
    cd_offset = struct.unpack_from("<I", data, eocd + 16)[0]
    cd_size = struct.unpack_from("<I", data, eocd + 12)[0]

    if data[cd_offset - 16:cd_offset] != MAGIC:
        raise SystemExit("no APK Signing Block before the central directory")
    block_size = struct.unpack_from("<Q", data, cd_offset - 24)[0]
    block_start = cd_offset - block_size - 8
    if struct.unpack_from("<Q", data, block_start)[0] != block_size:
        raise SystemExit("APK Signing Block size fields disagree")

    v2 = None
    at = block_start + 8
    while at < cd_offset - 24:
        (pair_len,) = struct.unpack_from("<Q", data, at)
        (pair_id,) = struct.unpack_from("<I", data, at + 8)
        if pair_id == V2_BLOCK_ID:
            v2 = data[at + 12:at + 8 + pair_len]
        at += 8 + pair_len
    if v2 is None:
        raise SystemExit("no v2 signature block")

    # The digest covers the entries, the central directory, and the EOCD with its
    # central-directory pointer moved back to where the signing block starts.
    eocd_for_digest = bytearray(data[eocd:])
    struct.pack_into("<I", eocd_for_digest, 16, block_start)
    computed = apk_digest([data[:block_start], data[cd_offset:cd_offset + cd_size], bytes(eocd_for_digest)])

    signers = list(iter_sequence(list(iter_sequence(v2))[0]))
    if len(signers) != 1:
        raise SystemExit(f"expected exactly one signer, got {len(signers)}")

    signer = signers[0]
    signed_data, at = read_len_prefixed(signer, 0)
    signatures, at = read_len_prefixed(signer, at)
    public_key, at = read_len_prefixed(signer, at)

    digests, sat = read_len_prefixed(signed_data, 0)
    certificates, sat = read_len_prefixed(signed_data, sat)

    claimed = None
    for item in iter_sequence(digests):
        (algo,) = struct.unpack_from("<I", item, 0)
        if algo == SIG_RSA_PKCS1_SHA256:
            claimed, _ = read_len_prefixed(item, 4)
    if claimed is None:
        raise SystemExit("no SHA-256/RSA digest in the signed data")
    if claimed != computed:
        raise SystemExit(f"digest mismatch: signed {claimed.hex()} but the file digests to {computed.hex()}")

    verified = False
    for item in iter_sequence(signatures):
        (algo,) = struct.unpack_from("<I", item, 0)
        if algo != SIG_RSA_PKCS1_SHA256:
            continue
        signature, _ = read_len_prefixed(item, 4)
        if not verify_rsa_pkcs1_sha256(public_key, signed_data, signature):
            raise SystemExit("the signature does not verify against the signer's public key")
        verified = True
    if not verified:
        raise SystemExit("no SHA-256/RSA signature in the block")

    certs = list(iter_sequence(certificates))
    # The certificate has to certify the key that signed, or the signature proves
    # nothing about the identity the device records.
    _, certificate, _ = next(der_items(certs[0]))
    tbs = next(c for t, c, _ in der_items(certificate) if t == 0x30)
    # With no extensions, the last SEQUENCE in the TBS is the public key info.
    cert_spki = [f for t, c, f in der_items(tbs) if t == 0x30][-1]
    if rsa_public_numbers(public_key) != rsa_public_numbers(cert_spki):
        raise SystemExit("the certificate does not carry the signer's public key")

    result = {
        "signedV2": True,
        "signers": len(signers),
        "certificates": len(certs),
        "digestBytes": len(computed),
        "entries": struct.unpack_from("<H", data, eocd + 10)[0],
    }

    try:
        import os
        os.environ.setdefault("LOGURU_LEVEL", "CRITICAL")
        from androguard.core.apk import APK
        apk = APK(path)
        result["manifest"] = {
            "package": apk.get_package(),
            "label": apk.get_app_name(),
            "versionName": apk.get_androidversion_name(),
            "versionCode": apk.get_androidversion_code(),
            "minSdk": apk.get_min_sdk_version(),
            "targetSdk": apk.get_target_sdk_version(),
            "mainActivity": apk.get_main_activity(),
            "valid": apk.is_valid_APK(),
        }
    except ImportError:
        result["manifest"] = None
    return result


if __name__ == "__main__":
    print(json.dumps(verify(sys.argv[1]), indent=2))

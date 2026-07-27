# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#
# An independent App Bundle verifier — the oracle for build-tools/utils/aab.js.
#
# Same rule as verify-apk.py: we write the format, so checking it with our own
# code proves nothing. This decodes the protobuf wire format generically (field
# numbers and wire types, no schema), reconstructs the manifest tree from the
# bytes, and verifies the JAR signature the way a JAR verifier does — per-entry
# digests in MANIFEST.MF, the manifest's own digest in the signature file, and the
# PKCS#7 signature over that file, checked by hand.
#
# Python 3 standard library only. It cannot tell a wrong FIELD NUMBER from a right
# one — only bundletool knows the schema — so the numbers it reports are asserted
# against the schema in the test, and CI runs `bundletool validate` where a JVM is.
#
# Usage: python3 verify-aab.py <aab>   → JSON on stdout, non-zero exit on failure.

import base64
import hashlib
import json
import sys
import zipfile

SHA256_DIGESTINFO = bytes.fromhex("3031300d060960864801650304020105000420")


def read_varint(buf, at):
    shift = 0
    value = 0
    while True:
        byte = buf[at]
        at += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, at
        shift += 7


def decode_message(buf):
    """{field_number: [value, ...]} — bytes for length-delimited, int for varint."""
    out = {}
    at = 0
    while at < len(buf):
        key, at = read_varint(buf, at)
        field, wire = key >> 3, key & 7
        if wire == 0:
            value, at = read_varint(buf, at)
        elif wire == 2:
            length, at = read_varint(buf, at)
            value = buf[at:at + length]
            at += length
        elif wire == 5:
            value, at = int.from_bytes(buf[at:at + 4], "little"), at + 4
        elif wire == 1:
            value, at = int.from_bytes(buf[at:at + 8], "little"), at + 8
        else:
            raise SystemExit(f"unsupported protobuf wire type {wire}")
        out.setdefault(field, []).append(value)
    return out


def decode_element(buf):
    """XmlElement { namespace_declaration = 1, name = 3, attribute = 4, child = 5 }."""
    m = decode_message(buf)
    attributes = []
    for raw in m.get(4, []):
        a = decode_message(raw)
        attr = {
            "namespace": a[1][0].decode() if 1 in a else None,
            "name": a[2][0].decode(),
            "value": a[3][0].decode() if 3 in a else "",
            "resourceId": a[5][0] if 5 in a else None,
        }
        if 6 in a:
            item = decode_message(a[6][0])
            if 1 in item:                       # Item.ref
                attr["compiled"] = {"ref": decode_message(item[1][0]).get(2, [0])[0]}
            elif 7 in item:                     # Item.prim
                prim = decode_message(item[7][0])
                field = next(iter(prim))
                attr["compiled"] = {"primField": field, "primValue": prim[field][0]}
        attributes.append(attr)
    return {
        "name": m[3][0].decode(),
        "namespaces": [decode_message(n)[1][0].decode() for n in m.get(1, [])],
        "attributes": attributes,
        "children": [decode_element(decode_message(c)[1][0]) for c in m.get(5, [])],
    }


def jar_verify(zf):
    """The JAR signature: every entry's digest, the manifest's digest, and the
    PKCS#7 signature over the signature file."""
    manifest = zf.read("META-INF/MANIFEST.MF")
    signature_file = zf.read("META-INF/ESTELLA.SF")
    block = zf.read("META-INF/ESTELLA.RSA")

    # Every non-META-INF entry must be digested in the manifest, and match.
    sections = {}
    for section in manifest.split(b"\r\n\r\n")[1:]:
        if not section.strip():
            continue
        body = section if section.endswith(b"\r\n") else section + b"\r\n"
        lines = _unfold(body)
        name = lines["Name"]
        sections[name] = (lines["SHA-256-Digest"], body)

    checked = 0
    for info in zf.infolist():
        if info.filename.startswith("META-INF/"):
            continue
        if info.filename not in sections:
            raise SystemExit(f"{info.filename} is not digested in MANIFEST.MF")
        want, _ = sections[info.filename]
        got = base64.b64encode(hashlib.sha256(zf.read(info.filename)).digest()).decode()
        if got != want:
            raise SystemExit(f"digest mismatch for {info.filename}")
        checked += 1

    sf = _unfold(signature_file.split(b"\r\n\r\n")[0] + b"\r\n")
    want_manifest = sf["SHA-256-Digest-Manifest"]
    got_manifest = base64.b64encode(hashlib.sha256(manifest).digest()).decode()
    if got_manifest != want_manifest:
        raise SystemExit("the signature file does not digest this MANIFEST.MF")

    _verify_pkcs7(block, signature_file)
    return checked


def _unfold(section):
    """JAR attributes, with continuation lines (a leading space) folded back in."""
    out = {}
    key = None
    for line in section.decode().split("\r\n"):
        if not line:
            continue
        if line.startswith(" "):
            out[key] += line[1:]
        else:
            key, _, value = line.partition(": ")
            out[key] = value
    return out


def _der_items(buf):
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


def _verify_pkcs7(block, signed_content):
    """SignedData with no authenticated attributes: the signature is over the
    content itself, and the certificate inside carries the verifying key."""
    _, content_info, _ = next(_der_items(block))
    explicit = [c for t, c, _ in _der_items(content_info) if t == 0xA0][0]
    _, signed_data, _ = next(_der_items(explicit))
    parts = list(_der_items(signed_data))

    certificate = [c for t, c, _ in parts if t == 0xA0][0]
    signer_infos = [c for t, c, _ in parts if t == 0x31][-1]
    _, signer, _ = next(_der_items(signer_infos))
    signature = [c for t, c, _ in _der_items(signer) if t == 0x04][0]

    # The certificate's SubjectPublicKeyInfo is the last SEQUENCE of the TBS.
    _, cert_body, _ = next(_der_items(certificate))
    tbs = next(c for t, c, _ in _der_items(cert_body) if t == 0x30)
    spki = [f for t, c, f in _der_items(tbs) if t == 0x30][-1]
    _, spki_body, _ = next(_der_items(spki))
    bits = [c for t, c, _ in _der_items(spki_body) if t == 0x03][0]
    _, rsa_key, _ = next(_der_items(bits[1:]))
    n, e = [int.from_bytes(c, "big") for t, c, _ in _der_items(rsa_key) if t == 0x02][:2]

    size = (n.bit_length() + 7) // 8
    decrypted = pow(int.from_bytes(signature, "big"), e, n).to_bytes(size, "big")
    expected = b"\x00\x01" + b"\xff" * (size - 3 - len(SHA256_DIGESTINFO) - 32) + b"\x00" \
        + SHA256_DIGESTINFO + hashlib.sha256(signed_content).digest()
    if decrypted != expected:
        raise SystemExit("the JAR signature does not verify against the certificate")


def resource_files(table):
    """Every file path the resource table actually names.

    Walked by field number, which is the half of this format that cannot be
    inferred from the bytes: ResourceTable.package(2) -> Package.type(3) ->
    Type.entry(3) -> Entry.config_value(6) -> ConfigValue.value(2) ->
    Value.item(4) -> Item.file(5) -> FileReference.path(1). A file shipped in the
    bundle that no entry names here is exactly what bundletool rejects.

    Every one of those numbers has a plausible wrong neighbour (config_value 5 is
    overlayable_item, ConfigValue field 3 is RESERVED, Value field 1 is source), and
    a walk that shares a mistake with the writer confirms nothing. They come from
    aapt2's Resources.proto; bundletool, which reads the same schema, is the
    authority the CI step defers to.
    """
    paths = []
    for package in decode_message(table).get(2, []):
        for type_ in decode_message(package).get(3, []):
            for entry in decode_message(type_).get(3, []):
                for config_value in decode_message(entry).get(6, []):
                    for value in decode_message(config_value).get(2, []):
                        for item in decode_message(value).get(4, []):
                            for reference in decode_message(item).get(5, []):
                                for raw in decode_message(reference).get(1, []):
                                    paths.append(raw.decode())
    return paths


def verify(path):
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        for required in ("BundleConfig.pb", "base/manifest/AndroidManifest.xml"):
            if required not in names:
                raise SystemExit(f"the bundle has no {required}")

        signed_entries = jar_verify(zf)
        manifest = decode_element(decode_message(zf.read("base/manifest/AndroidManifest.xml"))[1][0])
        config = decode_message(zf.read("BundleConfig.pb"))

        return {
            "entries": len(names),
            "signedEntries": signed_entries,
            "bundletoolVersion": decode_message(config[1][0])[2][0].decode(),
            "uncompressedGlobs": [g.decode() for g in decode_message(config[3][0])[1]],
            "manifest": manifest,
            "resourceFiles": (resource_files(zf.read("base/resources.pb"))
                              if "base/resources.pb" in names else []),
            "resFiles": sorted(n[len("base/"):] for n in names if n.startswith("base/res/")),
            "hasDex": any(n.startswith("base/dex/") for n in names),
            "libs": sorted(n for n in names if n.startswith("base/lib/")),
            "assets": sum(1 for n in names if n.startswith("base/assets/")),
        }


if __name__ == "__main__":
    print(json.dumps(verify(sys.argv[1]), indent=2))

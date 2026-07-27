// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// AndroidManifest.xml in aapt2's PROTO form — what an App Bundle carries where an
// APK carries binary XML.
//
// The same manifest, the same parsed tree and the same resource ids as
// androidBinaryXml.js; only the encoding differs. That is why the XML reader and
// the id table live there and are imported here rather than copied: a bundle whose
// manifest disagreed with its APK's would be a bug nobody finds until a store
// rejects the upload.
//
// Field numbers are from aapt2's Resources.proto (XmlNode / XmlElement /
// XmlAttribute / Item / Primitive / Reference). They are part of a published wire
// format, but they are also the one thing here that cannot be inferred from the
// data — `desktop/tests/android-aab.test.ts` decodes what this writes and checks
// every one of them, and validates the finished bundle with bundletool wherever a
// JVM exists.

import { message, bytesField, varintField, boolField } from './protobuf.js';
import { parseXml, ANDROID_NS, ANDROID_ATTR_IDS, ANDROID_STYLE_IDS } from './androidBinaryXml.js';

// Resources.proto — Primitive.oneof_value
const PRIM_INT_DECIMAL = 6;
const PRIM_INT_HEX = 7;
const PRIM_BOOLEAN = 8;

// Resources.proto — Item.value
const ITEM_REF = 1;
import { symbolicAttrValue } from './androidAttrValues.js';

const ITEM_STR = 2;
const ITEM_PRIM = 7;

// Resources.proto — Reference
const REF_ID = 2;

/** `Item` for an attribute value, typed the way the platform expects to read it. */
function compiledItem(value, references, name) {
    // Same rule as the binary encoder: a flag or enum attribute is an int, and the
    // App Bundle carries the same manifest the APK does.
    const symbolic = name === undefined ? null : symbolicAttrValue(name, value);
    if (symbolic !== null) {
        return bytesField(ITEM_PRIM, message(varintField(PRIM_INT_DECIMAL, symbolic)));
    }
    const style = /^@android:style\/(.+)$/.exec(value);
    if (style) {
        const id = ANDROID_STYLE_IDS[style[1]];
        if (id === undefined) throw new Error(`Unknown framework style @android:style/${style[1]}`);
        return bytesField(ITEM_REF, message(varintField(REF_ID, id)));
    }
    if (value.startsWith('@')) {
        const id = references[value];
        if (id === undefined) throw new Error(`No resource id for ${value} — the assembler declares what it packages.`);
        return bytesField(ITEM_REF, message(varintField(REF_ID, id >>> 0)));
    }
    if (value === 'true' || value === 'false') {
        return bytesField(ITEM_PRIM, message(boolField(PRIM_BOOLEAN, value === 'true')));
    }
    if (/^0x[0-9a-fA-F]+$/.test(value)) {
        return bytesField(ITEM_PRIM, message(varintField(PRIM_INT_HEX, Number.parseInt(value, 16))));
    }
    if (/^-?\d+$/.test(value)) {
        return bytesField(ITEM_PRIM, message(varintField(PRIM_INT_DECIMAL, Number.parseInt(value, 10))));
    }
    // A plain string: `value` already carries it, and a String item beside it would
    // be the same bytes twice.
    return null;
}

/** XmlAttribute { namespace_uri = 1, name = 2, value = 3, resource_id = 5, compiled_item = 6 } */
function attribute(attr, references) {
    const framework = attr.prefix === 'android';
    const id = framework ? ANDROID_ATTR_IDS[attr.name] : undefined;
    if (framework && id === undefined) {
        throw new Error(`No public resource id known for android:${attr.name} — add it to ANDROID_ATTR_IDS.`);
    }
    const compiled = framework ? compiledItem(attr.value, references, attr.name) : null;
    return message(
        framework ? bytesField(1, ANDROID_NS) : null,
        bytesField(2, attr.name),
        bytesField(3, attr.value),
        id === undefined ? null : varintField(5, id),
        compiled ? bytesField(6, compiled) : null,
    );
}

/** XmlElement { namespace_declaration = 1, namespace_uri = 2, name = 3, attribute = 4, child = 5 } */
function element(node, declareNamespace, references) {
    return message(
        declareNamespace ? bytesField(1, message(bytesField(1, 'android'), bytesField(2, ANDROID_NS))) : null,
        bytesField(3, node.name),
        ...node.attrs
            .filter((a) => a.name !== 'xmlns' && a.prefix !== 'xmlns')
            .map((a) => bytesField(4, attribute(a, references))),
        ...node.children.map((child) => bytesField(5, node_(child, false, references))),
    );
}

/** XmlNode { element = 1 } */
function node_(element_, declareNamespace, references) {
    return message(bytesField(1, element(element_, declareNamespace, references)));
}

/** Compile manifest SOURCE to the protobuf XML an App Bundle carries. */
export function compileProtoManifest(xml, references = {}) {
    return node_(parseXml(xml), true, references);
}

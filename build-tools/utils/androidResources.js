// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The resource table an assembled app declares — one entry, the launcher icon.
//
// `android:icon` must be a RESOURCE REFERENCE; a path is not accepted. So an app
// with its own icon needs a resource table, in both encodings: `resources.arsc`
// (binary) for the APK and `resources.pb` (protobuf) for the bundle.
//
// The alternative was to have the template carry tables aapt2 built, and swap the
// icon's bytes at assembly time — which works, but puts aapt2 back on the path
// (for whoever builds a template) and freezes the table's shape into the release.
// Writing the table is a few hundred lines for something the whole pipeline is
// already doing four times over, and it keeps "no Android SDK anywhere" true
// rather than nearly true.
//
// One package, one type, one entry, and ids we choose, so nothing here has to
// agree with a tool that is not in the build.

import { message, bytesField, varintField } from './protobuf.js';

/** The application package's id — 0x7f is what every app's own resources use
 *  (0x01 is the framework). */
export const APP_PACKAGE_ID = 0x7f;
const TYPE_ID = 1;
const ENTRY_ID = 0;

/** The id `@mipmap/ic_launcher` resolves to: package 7f, type 01, entry 0000. */
export const ICON_RESOURCE_ID = (APP_PACKAGE_ID << 24) | (TYPE_ID << 16) | ENTRY_ID;

/** What the manifest writes to reach it, in either encoding. */
export const ICON_REFERENCE = '@mipmap/ic_launcher';

/**
 * Where the icon file sits. xxxhdpi rather than an unqualified folder: with no
 * density the platform reads a bitmap as mdpi and scales it UP on every modern
 * screen, so a sharp source would arrive blurry.
 */
export const ICON_PATH = 'res/mipmap-xxxhdpi/ic_launcher.png';
const ICON_DENSITY = 640;

// Res_value data types (the same table binary XML uses).
const TYPE_STRING = 0x03;

/** A UTF-16 string pool chunk — the same structure binary XML carries. */
function stringPool(strings) {
    const bodies = strings.map((s) => {
        const chars = Buffer.from(s, 'utf16le');
        const out = Buffer.alloc(2 + chars.length + 2);
        out.writeUInt16LE(chars.length / 2, 0);
        chars.copy(out, 2);
        return out;
    });
    const offsets = Buffer.alloc(strings.length * 4);
    let at = 0;
    bodies.forEach((b, n) => { offsets.writeUInt32LE(at, n * 4); at += b.length; });
    const data = Buffer.concat(bodies);
    const padding = (4 - (data.length % 4)) % 4;
    const headerSize = 28;
    const stringsStart = headerSize + offsets.length;

    const header = Buffer.alloc(headerSize);
    header.writeUInt16LE(0x0001, 0);
    header.writeUInt16LE(headerSize, 2);
    header.writeUInt32LE(stringsStart + data.length + padding, 4);
    header.writeUInt32LE(strings.length, 8);
    header.writeUInt32LE(0, 12);
    header.writeUInt32LE(0, 16);              // UTF-16, unsorted
    header.writeUInt32LE(stringsStart, 20);
    header.writeUInt32LE(0, 24);
    return Buffer.concat([header, offsets, data, Buffer.alloc(padding)]);
}

function chunk(type, headerExtra, body) {
    const headerSize = 8 + headerExtra.length;
    const header = Buffer.alloc(8);
    header.writeUInt16LE(type, 0);
    header.writeUInt16LE(headerSize, 2);
    header.writeUInt32LE(headerSize + body.length, 4);
    return Buffer.concat([header, headerExtra, body]);
}

/** ResTable_config — 28 bytes, everything default except the density the icon is
 *  authored for. */
function configuration() {
    const config = Buffer.alloc(28);
    config.writeUInt32LE(28, 0);
    config.writeUInt16LE(ICON_DENSITY, 14);
    return config;
}

/**
 * `resources.arsc`: a table with one package, one type (`mipmap`) and one entry
 * (`ic_launcher`) whose value is the path in the global string pool.
 */
function binaryTable() {
    const values = stringPool([ICON_PATH]);

    const typeStrings = stringPool(['mipmap']);
    const keyStrings = stringPool(['ic_launcher']);

    // ResTable_typeSpec: one entry, no configuration-varying flags.
    const specExtra = Buffer.alloc(8);
    specExtra.writeUInt8(TYPE_ID, 0);
    specExtra.writeUInt32LE(1, 4);
    const spec = chunk(0x0202, specExtra, Buffer.alloc(4));

    // ResTable_entry + Res_value: the entry names its key and points at the path.
    const entry = Buffer.alloc(16);
    entry.writeUInt16LE(8, 0);                // entry size
    entry.writeUInt16LE(0, 2);                // flags: a simple value
    entry.writeUInt32LE(0, 4);                // key index ("ic_launcher")
    entry.writeUInt16LE(8, 8);                // Res_value size
    entry.writeUInt8(0, 10);
    entry.writeUInt8(TYPE_STRING, 11);
    entry.writeUInt32LE(0, 12);               // index into the value pool
    const offsets = Buffer.alloc(4);          // one entry, at offset 0

    const config = configuration();
    const typeExtra = Buffer.alloc(12 + config.length);
    typeExtra.writeUInt8(TYPE_ID, 0);
    typeExtra.writeUInt32LE(1, 4);            // entryCount
    typeExtra.writeUInt32LE(8 + 12 + config.length + offsets.length, 8);   // entriesStart
    config.copy(typeExtra, 12);
    const type = chunk(0x0201, typeExtra, Buffer.concat([offsets, entry]));

    // ResTable_package: the header carries the two pool offsets, so it is built
    // once the pools' sizes are known.
    const packageHeaderSize = 288;
    const packageExtra = Buffer.alloc(packageHeaderSize - 8);
    packageExtra.writeUInt32LE(APP_PACKAGE_ID, 0);
    Buffer.from('estella.app', 'utf16le').copy(packageExtra, 4);
    packageExtra.writeUInt32LE(packageHeaderSize, 260);                    // typeStrings
    packageExtra.writeUInt32LE(0, 264);                                    // lastPublicType
    packageExtra.writeUInt32LE(packageHeaderSize + typeStrings.length, 268);  // keyStrings
    packageExtra.writeUInt32LE(0, 272);                                    // lastPublicKey
    packageExtra.writeUInt32LE(0, 276);                                    // typeIdOffset
    const pkg = chunk(0x0200, packageExtra, Buffer.concat([typeStrings, keyStrings, spec, type]));

    const tableExtra = Buffer.alloc(4);
    tableExtra.writeUInt32LE(1, 0);           // packageCount
    return chunk(0x0002, tableExtra, Buffer.concat([values, pkg]));
}

/**
 * `resources.pb`: the same table, protobuf.
 *
 * ResourceTable { package = 2 } · Package { package_id = 1, package_name = 2,
 * type = 3 } · Type { type_id = 1, name = 2, entry = 3 } · Entry { entry_id = 1,
 * name = 2, config_value = 5 } · ConfigValue { config = 1, value = 3 } ·
 * Value { item = 1 } · Item { file = 5 } · FileReference { path = 1, type = 2 }.
 *
 * No Configuration is written. Its density field number is the one thing here
 * that no available tool can check, and a wrong number would not be ignored — it
 * would set some OTHER dimension, and the icon would reach only the devices that
 * happened to match. An absent configuration is simply "every device", which is
 * correct, just not density-aware.
 */
function protoTable() {
    const fileReference = message(bytesField(1, ICON_PATH), varintField(2, 1));   // Type.PNG
    const value = message(bytesField(1, message(bytesField(5, fileReference))));
    const configValue = message(bytesField(3, value));
    const entry = message(
        bytesField(1, message(varintField(1, ENTRY_ID))),
        bytesField(2, 'ic_launcher'),
        bytesField(5, configValue),
    );
    const type = message(
        bytesField(1, message(varintField(1, TYPE_ID))),
        bytesField(2, 'mipmap'),
        bytesField(3, entry),
    );
    const pkg = message(
        bytesField(1, message(varintField(1, APP_PACKAGE_ID))),
        bytesField(2, 'estella.app'),
        bytesField(3, type),
    );
    return message(bytesField(2, pkg));
}

/**
 * The resources an assembled app carries: the icon file, the table in both
 * encodings, and the reference the manifest resolves through.
 *
 * @param {Buffer} iconPng The launcher icon, as PNG.
 */
export function appResources(iconPng) {
    return {
        references: { [ICON_REFERENCE]: ICON_RESOURCE_ID },
        files: [{ name: ICON_PATH, data: iconPng }],
        arsc: binaryTable(),
        pb: protoTable(),
    };
}

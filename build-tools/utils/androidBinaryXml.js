// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// AndroidManifest.xml, compiled — the format aapt2 produces and the platform
// parses (binary XML: a string pool, a resource map, and one chunk per node).
//
// Written rather than shelled out to, because `aapt2` is the reason packaging an
// APK used to need the whole Android SDK. Everything else the assembler does is a
// zip and a signature; this was the last external tool in the path between an
// editor export and an installable app.
//
// The scope is deliberately OUR manifest: elements, attributes, and the four value
// kinds it uses. Nothing here compiles resources — an APK with no resources of its
// own is what the native host ships, and the one reference it makes
// (@android:style/Theme.NoTitleBar.Fullscreen) is a FRAMEWORK id, resolved by the
// platform rather than by a table we would have to emit.
//
// The platform resolves a framework attribute BY ITS RESOURCE ID, not by the name
// string — a wrong id is silently ignored rather than rejected — so the ids below
// are pinned against AOSP's public.xml by `desktop/tests/android-manifest.test.ts`.

/** The namespace every framework attribute lives in. */
export const ANDROID_NS = 'http://schemas.android.com/apk/res/android';

/** AOSP public attribute ids, for the attributes our manifest uses. */
export const ANDROID_ATTR_IDS = {
    theme: 0x01010000,
    label: 0x01010001,
    icon: 0x01010002,
    name: 0x01010003,
    hasCode: 0x0101000c,
    exported: 0x01010010,
    screenOrientation: 0x0101001e,
    configChanges: 0x0101001f,
    value: 0x01010024,
    minSdkVersion: 0x0101020c,
    versionCode: 0x0101021b,
    versionName: 0x0101021c,
    targetSdkVersion: 0x01010270,
    required: 0x0101028e,
    extractNativeLibs: 0x010104ea,
    version: 0x01010519,
};

/** AOSP public style ids, for the `@android:style/...` a manifest may name. */
export const ANDROID_STYLE_IDS = {
    'Theme.NoTitleBar': 0x01030006,
    'Theme.NoTitleBar.Fullscreen': 0x01030007,
};

// Res_value data types.
const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_INT_BOOLEAN = 0x12;

const NO_ENTRY = 0xffffffff;

// =============================================================================
// A very small XML reader
// =============================================================================

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescape(text) {
    return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, ref) => {
        if (ref[0] === '#') return String.fromCodePoint(parseInt(ref[1] === 'x' ? ref.slice(2) : ref.slice(1), ref[1] === 'x' ? 16 : 10));
        return ref in ENTITIES ? ENTITIES[ref] : m;
    });
}

/**
 * Parse the XML subset a manifest is written in: elements, attributes, comments
 * and the declaration. Text nodes are ignored — a manifest has none that matter,
 * and accepting them silently would hide a typo.
 *
 * @returns {{name: string, attrs: Array<{prefix: string|null, name: string, value: string}>,
 *            children: Array<object>, line: number}} the root element
 */
export function parseXml(text) {
    let i = 0;
    let line = 1;
    const advance = (to) => {
        for (let k = i; k < to; k++) if (text[k] === '\n') line++;
        i = to;
    };
    const skipSpace = () => { while (i < text.length && /\s/.test(text[i])) { if (text[i] === '\n') line++; i++; } };

    let root = null;
    const stack = [];
    const attach = (node) => {
        if (stack.length > 0) stack[stack.length - 1].children.push(node);
        else if (!root) root = node;
        else throw new Error(`XML: a second root element <${node.name}> (line ${node.line})`);
    };

    while (i < text.length) {
        const lt = text.indexOf('<', i);
        if (lt < 0) break;
        advance(lt);
        if (text.startsWith('<?', i)) { advance(text.indexOf('?>', i) + 2); continue; }
        if (text.startsWith('<!--', i)) { advance(text.indexOf('-->', i) + 3); continue; }
        if (text.startsWith('</', i)) {
            const end = text.indexOf('>', i);
            const name = text.slice(i + 2, end).trim();
            const open = stack.pop();
            if (!open || open.name !== name) throw new Error(`XML: </${name}> does not close <${open?.name}> (line ${line})`);
            advance(end + 1);
            continue;
        }

        // <name attr="value" ... > or <name ... />
        advance(i + 1);
        const nameStart = i;
        while (i < text.length && !/[\s/>]/.test(text[i])) i++;
        const node = { name: text.slice(nameStart, i), attrs: [], children: [], line };
        for (;;) {
            skipSpace();
            if (text.startsWith('/>', i)) { advance(i + 2); attach(node); break; }
            if (text[i] === '>') { advance(i + 1); attach(node); stack.push(node); break; }
            const attrStart = i;
            while (i < text.length && !/[\s=]/.test(text[i])) i++;
            const qualified = text.slice(attrStart, i);
            skipSpace();
            if (text[i] !== '=') throw new Error(`XML: attribute ${qualified} has no value (line ${line})`);
            advance(i + 1);
            skipSpace();
            const quote = text[i];
            if (quote !== '"' && quote !== "'") throw new Error(`XML: unquoted value for ${qualified} (line ${line})`);
            const valueEnd = text.indexOf(quote, i + 1);
            const value = unescape(text.slice(i + 1, valueEnd));
            advance(valueEnd + 1);
            const colon = qualified.indexOf(':');
            node.attrs.push(colon < 0
                ? { prefix: null, name: qualified, value }
                : { prefix: qualified.slice(0, colon), name: qualified.slice(colon + 1), value });
        }
    }
    if (stack.length > 0) throw new Error(`XML: <${stack[stack.length - 1].name}> is never closed`);
    if (!root) throw new Error('XML: no root element');
    return root;
}

// =============================================================================
// The string pool
// =============================================================================

class StringPool {
    constructor() {
        this.strings = [];
        this.index = new Map();
    }

    /** @returns the pool index, adding the string if it is new. */
    add(s) {
        const known = this.index.get(s);
        if (known !== undefined) return known;
        const at = this.strings.length;
        this.strings.push(s);
        this.index.set(s, at);
        return at;
    }

    /**
     * UTF-16 rather than UTF-8: every parser accepts it, and its length rules have
     * no surrogate-vs-code-unit subtlety to get wrong. A manifest is a few hundred
     * bytes either way.
     */
    encode() {
        const bodies = this.strings.map((s) => {
            const chars = Buffer.from(s, 'utf16le');
            const units = chars.length / 2;
            if (units > 0x7fff) throw new Error('string pool entry too long');
            const out = Buffer.alloc(2 + chars.length + 2);
            out.writeUInt16LE(units, 0);
            chars.copy(out, 2);
            return out;   // trailing UTF-16 NUL is the zero-filled tail
        });
        const offsets = Buffer.alloc(this.strings.length * 4);
        let at = 0;
        bodies.forEach((b, n) => { offsets.writeUInt32LE(at, n * 4); at += b.length; });
        const data = Buffer.concat(bodies);
        const padding = (4 - (data.length % 4)) % 4;
        const headerSize = 28;
        const stringsStart = headerSize + offsets.length;
        const size = stringsStart + data.length + padding;

        const header = Buffer.alloc(headerSize);
        header.writeUInt16LE(0x0001, 0);          // RES_STRING_POOL_TYPE
        header.writeUInt16LE(headerSize, 2);
        header.writeUInt32LE(size, 4);
        header.writeUInt32LE(this.strings.length, 8);
        header.writeUInt32LE(0, 12);              // no styles
        header.writeUInt32LE(0, 16);              // flags: UTF-16, unsorted
        header.writeUInt32LE(stringsStart, 20);
        header.writeUInt32LE(0, 24);              // stylesStart
        return Buffer.concat([header, offsets, data, Buffer.alloc(padding)]);
    }
}

// =============================================================================
// Values
// =============================================================================

/** How a manifest attribute's text is typed. Order matters: `@android:style/...`
 *  before anything, then the two integer spellings, then booleans, then string. */
function typedValue(value, pool) {
    const style = /^@android:style\/(.+)$/.exec(value);
    if (style) {
        const id = ANDROID_STYLE_IDS[style[1]];
        if (id === undefined) throw new Error(`Unknown framework style @android:style/${style[1]}`);
        return { type: TYPE_REFERENCE, data: id, raw: NO_ENTRY };
    }
    if (value === 'true' || value === 'false') {
        return { type: TYPE_INT_BOOLEAN, data: value === 'true' ? 0xffffffff : 0, raw: NO_ENTRY };
    }
    if (/^0x[0-9a-fA-F]+$/.test(value)) {
        return { type: TYPE_INT_HEX, data: Number.parseInt(value, 16) >>> 0, raw: NO_ENTRY };
    }
    if (/^-?\d+$/.test(value)) {
        return { type: TYPE_INT_DEC, data: Number.parseInt(value, 10) >>> 0, raw: NO_ENTRY };
    }
    const at = pool.add(value);
    return { type: TYPE_STRING, data: at, raw: at };
}

// =============================================================================
// The encoder
// =============================================================================

function chunk(type, headerExtra, body) {
    const headerSize = 8 + headerExtra.length;
    const header = Buffer.alloc(8);
    header.writeUInt16LE(type, 0);
    header.writeUInt16LE(headerSize, 2);
    header.writeUInt32LE(headerSize + body.length, 4);
    return Buffer.concat([header, headerExtra, body]);
}

/** The 8 bytes every XML node chunk carries after its header: line + comment. */
function nodeHeaderExtra(line) {
    const extra = Buffer.alloc(8);
    extra.writeUInt32LE(line, 0);
    extra.writeUInt32LE(NO_ENTRY, 4);
    return extra;
}

/**
 * Compile a parsed manifest to binary XML.
 *
 * Attribute-name strings are pooled FIRST, in the order the resource map lists
 * their ids: the platform reads an attribute's id by its position in that map, so
 * the two are one structure written as two.
 *
 * @param {object} root The element from {@link parseXml}.
 * @returns {Buffer}
 */
export function encodeBinaryXml(root) {
    const pool = new StringPool();

    // Pass 1: every framework attribute name, in first-use order.
    const attrIds = [];
    const walkNames = (node) => {
        for (const attr of node.attrs) {
            if (attr.prefix !== 'android') continue;
            const id = ANDROID_ATTR_IDS[attr.name];
            if (id === undefined) {
                throw new Error(`No public resource id known for android:${attr.name} — add it to `
                    + 'ANDROID_ATTR_IDS (the platform resolves attributes by id, so guessing is not an option).');
            }
            if (pool.index.has(attr.name)) continue;
            pool.add(attr.name);
            attrIds.push(id);
        }
        node.children.forEach(walkNames);
    };
    walkNames(root);
    // Nothing else may take a slot the resource map covers.
    const mapSize = pool.strings.length;

    const nsPrefix = pool.add('android');
    const nsUri = pool.add(ANDROID_NS);

    // Pass 2: the node chunks. Values and element names join the pool as they are
    // reached, which is why the map's slots had to be claimed first.
    const nodes = [];
    const emit = (node) => {
        const attrs = node.attrs
            .filter((a) => a.name !== 'xmlns' && a.prefix !== 'xmlns')
            .map((a) => ({
                ns: a.prefix === 'android' ? nsUri : NO_ENTRY,
                name: pool.add(a.name),
                value: typedValue(a.value, pool),
            }));
        const name = pool.add(node.name);

        const ext = Buffer.alloc(20 + attrs.length * 20);
        ext.writeUInt32LE(NO_ENTRY, 0);           // element namespace
        ext.writeUInt32LE(name, 4);
        ext.writeUInt16LE(20, 8);                 // attributeStart
        ext.writeUInt16LE(20, 10);                // attributeSize
        ext.writeUInt16LE(attrs.length, 12);
        ext.writeUInt16LE(0, 14);                 // idIndex — no android:id in a manifest
        ext.writeUInt16LE(0, 16);                 // classIndex
        ext.writeUInt16LE(0, 18);                 // styleIndex
        attrs.forEach((a, n) => {
            const at = 20 + n * 20;
            ext.writeUInt32LE(a.ns, at);
            ext.writeUInt32LE(a.name, at + 4);
            ext.writeUInt32LE(a.value.raw, at + 8);
            ext.writeUInt16LE(8, at + 12);        // Res_value size
            ext.writeUInt8(0, at + 14);           // res0
            ext.writeUInt8(a.value.type, at + 15);
            ext.writeUInt32LE(a.value.data, at + 16);
        });
        nodes.push(chunk(0x0102, nodeHeaderExtra(node.line), ext));

        node.children.forEach(emit);

        const end = Buffer.alloc(8);
        end.writeUInt32LE(NO_ENTRY, 0);
        end.writeUInt32LE(name, 4);
        nodes.push(chunk(0x0103, nodeHeaderExtra(node.line), end));
    };

    const namespace = (type) => {
        const body = Buffer.alloc(8);
        body.writeUInt32LE(nsPrefix, 0);
        body.writeUInt32LE(nsUri, 4);
        return chunk(type, nodeHeaderExtra(root.line), body);
    };

    const startNs = namespace(0x0100);
    emit(root);
    const endNs = namespace(0x0101);

    const map = Buffer.alloc(mapSize * 4);
    attrIds.forEach((id, n) => map.writeUInt32LE(id, n * 4));

    const body = Buffer.concat([pool.encode(), chunk(0x0180, Buffer.alloc(0), map), startNs, ...nodes, endNs]);
    return chunk(0x0003, Buffer.alloc(0), body);   // RES_XML_TYPE
}

/** Compile manifest SOURCE (the filled template) to the bytes an APK carries. */
export function compileManifest(xml) {
    return encodeBinaryXml(parseXml(xml));
}

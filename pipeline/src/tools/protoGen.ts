// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  protoGen.ts — TypeScript from a protobuf descriptor set.
 *
 * `protoc` parses the .proto files (that is its job, and the part that must agree with every other protobuf
 * tool); this turns what it parsed into plain interfaces and a codec per message, written against the
 * small runtime beside them (protoRuntime.ts). Nothing here reads a .proto file itself.
 *
 * What is supported is proto3: scalars, enums, nested messages, `repeated`, `optional`, `oneof` and `map`.
 * proto2 (required, groups, extensions, defaults) is refused by name instead of generated wrongly.
 */
import path from 'node:path';

// ── the descriptor, read straight off the wire ──────────────────────────────────────────────────────────────────

class Wire {
    pos = 0;
    constructor(private readonly buf: Uint8Array) {}
    get done(): boolean { return this.pos >= this.buf.length; }
    varint(): number {
        let result = 0;
        let mul = 1;
        for (;;) {
            const b = this.buf[this.pos++];
            if (b === undefined) throw new Error('the descriptor set is truncated');
            result += (b & 127) * mul;
            if (!(b & 128)) return result;
            mul *= 128;
        }
    }
    bytes(): Uint8Array {
        const n = this.varint();
        const out = this.buf.subarray(this.pos, this.pos + n);
        this.pos += n;
        return out;
    }
    skip(wireType: number): void {
        if (wireType === 0) this.varint();
        else if (wireType === 1) this.pos += 8;
        else if (wireType === 2) this.bytes();
        else if (wireType === 5) this.pos += 4;
        else throw new Error(`unsupported wire type ${wireType} in the descriptor set`);
    }
}

const text = (b: Uint8Array): string => new TextDecoder().decode(b);

/** Walk the fields of one message: `visit(fieldNumber, wireType, reader)` must consume the value or return false. */
function fields(buf: Uint8Array, visit: (field: number, wireType: number, r: Wire) => boolean | void): void {
    const r = new Wire(buf);
    while (!r.done) {
        const tag = r.varint();
        if (visit(tag >>> 3, tag & 7, r) === false) r.skip(tag & 7);
    }
}

export interface FieldInfo {
    name: string;
    number: number;
    repeated: boolean;
    /** FieldDescriptorProto.Type */
    type: number;
    /** `.pkg.Outer.Inner` for a message or enum. */
    typeName: string;
    oneof: number | null;
    optional: boolean;
}
export interface EnumInfo { name: string; values: Array<{ name: string; number: number }> }
export interface MessageInfo {
    name: string;
    fields: FieldInfo[];
    oneofs: string[];
    nested: MessageInfo[];
    enums: EnumInfo[];
    mapEntry: boolean;
}
export interface FileInfo {
    name: string;
    package: string;
    imports: string[];
    messages: MessageInfo[];
    enums: EnumInfo[];
    syntax: string;
}

function readEnum(buf: Uint8Array): EnumInfo {
    const e: EnumInfo = { name: '', values: [] };
    fields(buf, (f, wt, r) => {
        if (f === 1 && wt === 2) { e.name = text(r.bytes()); return; }
        if (f === 2 && wt === 2) {
            const v = { name: '', number: 0 };
            fields(r.bytes(), (g, w, rr) => {
                if (g === 1 && w === 2) { v.name = text(rr.bytes()); return; }
                // An enum number is a signed int32 on the wire.
                if (g === 2 && w === 0) { v.number = rr.varint() | 0; return; }
                return false;
            });
            e.values.push(v);
            return;
        }
        return false;
    });
    return e;
}

function readField(buf: Uint8Array): FieldInfo {
    const f: FieldInfo = { name: '', number: 0, repeated: false, type: 0, typeName: '', oneof: null, optional: false };
    fields(buf, (n, wt, r) => {
        if (n === 1 && wt === 2) { f.name = text(r.bytes()); return; }
        if (n === 3 && wt === 0) { f.number = r.varint(); return; }
        if (n === 4 && wt === 0) { const label = r.varint(); f.repeated = label === 3; if (label === 2) throw new Error(`field "${f.name}" is "required", which is proto2`); return; }
        if (n === 5 && wt === 0) { f.type = r.varint(); return; }
        if (n === 6 && wt === 2) { f.typeName = text(r.bytes()); return; }
        if (n === 9 && wt === 0) { f.oneof = r.varint(); return; }
        if (n === 17 && wt === 0) { f.optional = r.varint() !== 0; return; }
        return false;
    });
    return f;
}

function readMessage(buf: Uint8Array): MessageInfo {
    const m: MessageInfo = { name: '', fields: [], oneofs: [], nested: [], enums: [], mapEntry: false };
    fields(buf, (n, wt, r) => {
        if (wt !== 2) return false;
        if (n === 1) { m.name = text(r.bytes()); return; }
        if (n === 2) { m.fields.push(readField(r.bytes())); return; }
        if (n === 3) { m.nested.push(readMessage(r.bytes())); return; }
        if (n === 4) { m.enums.push(readEnum(r.bytes())); return; }
        if (n === 7) { fields(r.bytes(), (g, w, rr) => { if (g === 7 && w === 0) { m.mapEntry = rr.varint() !== 0; return; } return false; }); return; }
        if (n === 8) { fields(r.bytes(), (g, w, rr) => { if (g === 1 && w === 2) { m.oneofs.push(text(rr.bytes())); return; } return false; }); return; }
        return false;
    });
    return m;
}

/** The files in a `FileDescriptorSet` (what `protoc --descriptor_set_out --include_imports` writes), imports first. */
export function readDescriptorSet(buf: Uint8Array): FileInfo[] {
    const files: FileInfo[] = [];
    fields(buf, (n, wt, r) => {
        if (n !== 1 || wt !== 2) return false;
        const file: FileInfo = { name: '', package: '', imports: [], messages: [], enums: [], syntax: 'proto2' };
        fields(r.bytes(), (f, w, rr) => {
            if (w !== 2) return false;
            if (f === 1) { file.name = text(rr.bytes()); return; }
            if (f === 2) { file.package = text(rr.bytes()); return; }
            if (f === 3) { file.imports.push(text(rr.bytes())); return; }
            if (f === 4) { file.messages.push(readMessage(rr.bytes())); return; }
            if (f === 5) { file.enums.push(readEnum(rr.bytes())); return; }
            if (f === 12) { file.syntax = text(rr.bytes()); return; }
            return false;
        });
        files.push(file);
    });
    return files;
}

// ── TypeScript ──────────────────────────────────────────────────────────────────────────────────────────────────

interface Scalar { ts: string; wire: number; op: string; zero: string }

const SCALARS: Record<number, Scalar> = {
    1: { ts: 'number', wire: 1, op: 'double', zero: '0' },
    2: { ts: 'number', wire: 5, op: 'float', zero: '0' },
    3: { ts: 'number', wire: 0, op: 'int64', zero: '0' },
    4: { ts: 'number', wire: 0, op: 'uint64', zero: '0' },
    5: { ts: 'number', wire: 0, op: 'int32', zero: '0' },
    6: { ts: 'number', wire: 1, op: 'fixed64', zero: '0' },
    7: { ts: 'number', wire: 5, op: 'fixed32', zero: '0' },
    8: { ts: 'boolean', wire: 0, op: 'bool', zero: 'false' },
    9: { ts: 'string', wire: 2, op: 'string', zero: "''" },
    12: { ts: 'Uint8Array', wire: 2, op: 'bytes', zero: 'new Uint8Array(0)' },
    13: { ts: 'number', wire: 0, op: 'uint32', zero: '0' },
    15: { ts: 'number', wire: 5, op: 'sfixed32', zero: '0' },
    16: { ts: 'number', wire: 1, op: 'sfixed64', zero: '0' },
    17: { ts: 'number', wire: 0, op: 'sint32', zero: '0' },
    18: { ts: 'number', wire: 0, op: 'sint64', zero: '0' },
};
const T_MESSAGE = 11;
const T_ENUM = 14;
const T_GROUP = 10;

const RESERVED = new Set(['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'implements', 'interface', 'package', 'private', 'protected', 'public', 'await']);

const camel = (s: string): string => s.replace(/_+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase()).replace(/^[A-Z]/, (c) => c.toLowerCase());
const member = (s: string): string => { const c = camel(s); return RESERVED.has(c) ? `${c}_` : c; };

interface Named { file: string; ts: string; kind: 'message' | 'enum'; info: MessageInfo | EnumInfo }

export interface GeneratedFile { path: string; content: string }

/**
 * One TypeScript file per .proto (same relative path, `.ts`), plus `_runtime.ts`. The imports a descriptor set carries
 * along (google/protobuf/timestamp.proto and the like) are generated too, because project files refer to them.
 */
export function generateTypeScript(files: FileInfo[], runtimeText: string): GeneratedFile[] {
    const registry = new Map<string, Named>();
    const register = (file: FileInfo, prefix: string, scope: string, m: MessageInfo | EnumInfo, kind: 'message' | 'enum'): void => {
        const ts = prefix ? `${prefix}_${m.name}` : m.name;
        registry.set(`${scope}.${m.name}`, { file: file.name, ts, kind, info: m });
        if (kind === 'message') {
            const msg = m as MessageInfo;
            for (const n of msg.nested) register(file, ts, `${scope}.${m.name}`, n, 'message');
            for (const e of msg.enums) register(file, ts, `${scope}.${m.name}`, e, 'enum');
        }
    };
    for (const file of files) {
        if (file.syntax !== 'proto3') throw new Error(`${file.name}: only proto3 is supported (it says ${file.syntax === 'proto2' ? 'proto2, or nothing' : file.syntax})`);
        const scope = file.package ? `.${file.package}` : '';
        for (const m of file.messages) register(file, '', scope, m, 'message');
        for (const e of file.enums) register(file, '', scope, e, 'enum');
    }

    const out: GeneratedFile[] = [{ path: '_runtime.ts', content: runtimeText }];
    for (const file of files) out.push({ path: file.name.replace(/\.proto$/, '.ts'), content: emitFile(file, registry) });
    return out;
}

function emitFile(file: FileInfo, registry: Map<string, Named>): string {
    const here = file.name.replace(/\.proto$/, '');
    const rel = (to: string): string => {
        const r = path.posix.relative(path.posix.dirname(here), to.replace(/\.proto$/, '')) || '.';
        return r.startsWith('.') ? r : `./${r}`;
    };
    const used = new Map<string, Set<string>>();
    const ref = (typeName: string): Named => {
        const named = registry.get(typeName);
        if (!named) throw new Error(`${file.name}: unknown type ${typeName}`);
        if (named.file !== file.name) {
            if (!used.has(named.file)) used.set(named.file, new Set());
            used.get(named.file)!.add(named.ts);
        }
        return named;
    };

    const body: string[] = [];
    const emitEnum = (e: EnumInfo, ts: string): void => {
        body.push(`export enum ${ts} {`);
        for (const v of e.values) body.push(`    ${/^[A-Za-z_]/.test(v.name) ? v.name : JSON.stringify(v.name)} = ${v.number},`);
        body.push('}', '');
    };
    const emitMessage = (m: MessageInfo, ts: string, where: string): void => {
        if (m.mapEntry) return;
        for (const e of m.enums) emitEnum(e, `${ts}_${e.name}`);
        for (const n of m.nested) emitMessage(n, `${ts}_${n.name}`, `${where}.${n.name}`);
        body.push(...message(m, ts, `${prefixOf(file)}.${where}`, ref, registry));
    };
    for (const e of file.enums) emitEnum(e, e.name);
    for (const m of file.messages) emitMessage(m, m.name, m.name);

    const head = ['// Generated by Estella from ' + file.name + '. Do not edit: it is rewritten on every run.', '/* eslint-disable */',
        `import { Reader, Writer, b64, jArr, jBool, jBytes, jInt, jMapBool, jMapInt, jNum, jObj, jStr } from '${rel('_runtime')}';`];
    for (const [from, names] of [...used].sort((a, b) => (a[0] < b[0] ? -1 : 1))) head.push(`import { ${[...names].sort().join(', ')} } from '${rel(from)}';`);
    return [...head, '', ...body].join('\n').replace(/\n+$/, '\n');
}

function message(m: MessageInfo, ts: string, fullName: string, ref: (t: string) => Named, registry: Map<string, Named>): string[] {
    const entryOf = (f: FieldInfo): MessageInfo | null => {
        if (!f.repeated || f.type !== T_MESSAGE) return null;
        const named = registry.get(f.typeName);
        return named && named.kind === 'message' && (named.info as MessageInfo).mapEntry ? (named.info as MessageInfo) : null;
    };
    const tsType = (f: FieldInfo): string => {
        if (f.type === T_GROUP) throw new Error(`${ts}.${f.name}: groups are proto2`);
        if (f.type === T_MESSAGE || f.type === T_ENUM) return ref(f.typeName).ts;
        const s = SCALARS[f.type];
        if (!s) throw new Error(`${ts}.${f.name}: unsupported field type ${f.type}`);
        return s.ts;
    };
    const wireOf = (f: FieldInfo): number => (f.type === T_MESSAGE ? 2 : f.type === T_ENUM ? 0 : SCALARS[f.type]!.wire);
    const writeOne = (w: string, f: FieldInfo, v: string): string => {
        if (f.type === T_MESSAGE) return `${w}.bytes(${ref(f.typeName).ts}.encode(${v}));`;
        if (f.type === T_ENUM) return `${w}.int32(${v});`;
        return `${w}.${SCALARS[f.type]!.op}(${v});`;
    };
    const readOne = (f: FieldInfo): string => {
        if (f.type === T_MESSAGE) { const t = ref(f.typeName).ts; return `${t}.read(r, r.end())`; }
        if (f.type === T_ENUM) return 'r.int32()';
        return `r.${SCALARS[f.type]!.op}()`;
    };
    const zeroOf = (f: FieldInfo): string => (f.type === T_ENUM ? '0' : f.type === T_MESSAGE ? 'undefined' : SCALARS[f.type]!.zero);
    const packable = (f: FieldInfo): boolean => f.type !== T_MESSAGE && f.type !== 9 && f.type !== 12;

    const lines: string[] = [];
    const iface: string[] = [];
    const create: string[] = [];
    const write: string[] = [];
    const read: string[] = [];

    for (const f of m.fields) {
        const name = f.oneof !== null && !f.optional ? '' : member(f.name);
        const entry = entryOf(f);
        if (f.oneof !== null && !f.optional) continue; // grouped below
        if (entry) {
            const [k, v] = entry.fields;
            const kt = tsType(k!);
            const vt = tsType(v!);
            iface.push(`    ${name}: Map<${kt}, ${vt}>;`);
            create.push(`${name}: new Map()`);
            write.push(`for (const [k, v] of m.${name}) {`,
                '    const e = new Writer();',
                `    e.tag(1, ${wireOf(k!)}); ${writeOne('e', k!, 'k')}`,
                `    e.tag(2, ${wireOf(v!)}); ${writeOne('e', v!, 'v')}`,
                `    w.tag(${f.number}, 2); w.bytes(e.finish());`, '}');
            read.push(`case ${f.number}: if (wt !== 2) { r.skip(wt); break; } {`,
                `    const end = r.end(); let k: ${kt} = ${zeroOf(k!)}; let v: ${vt} = ${v!.type === T_MESSAGE ? `${ref(v!.typeName).ts}.create()` : zeroOf(v!)};`,
                '    while (r.pos < end) {',
                '        const et = r.tag();',
                `        if ((et >>> 3) === 1 && (et & 7) === ${wireOf(k!)}) k = ${readOne(k!)};`,
                `        else if ((et >>> 3) === 2 && (et & 7) === ${wireOf(v!)}) v = ${readOne(v!)};`,
                '        else r.skip(et & 7);',
                '    }',
                `    m.${name}.set(k, v);`, '} break;');
        } else if (f.repeated) {
            iface.push(`    ${name}: ${tsType(f)}[];`);
            create.push(`${name}: []`);
            if (packable(f)) {
                write.push(`if (m.${name}.length > 0) { const p = new Writer(); for (const v of m.${name}) ${writeOne('p', f, 'v')} w.tag(${f.number}, 2); w.bytes(p.finish()); }`);
                read.push(`case ${f.number}:`,
                    `    if (wt === 2) { const end = r.end(); while (r.pos < end) m.${name}.push(${readOne(f)}); }`,
                    `    else if (wt === ${wireOf(f)}) m.${name}.push(${readOne(f)});`,
                    '    else r.skip(wt);', '    break;');
            } else {
                write.push(`for (const v of m.${name}) { w.tag(${f.number}, 2); ${writeOne('w', f, 'v')} }`);
                read.push(`case ${f.number}: if (wt === 2) m.${name}.push(${readOne(f)}); else r.skip(wt); break;`);
            }
        } else if (f.type === T_MESSAGE || f.optional) {
            iface.push(`    ${name}?: ${tsType(f)} | undefined;`);
            write.push(`if (m.${name} !== undefined) { w.tag(${f.number}, ${wireOf(f)}); ${writeOne('w', f, `m.${name}`)} }`);
            read.push(`case ${f.number}: if (wt === ${wireOf(f)}) m.${name} = ${readOne(f)}; else r.skip(wt); break;`);
        } else {
            iface.push(`    ${name}: ${tsType(f)};`);
            create.push(`${name}: ${zeroOf(f)}`);
            const unset = f.type === 12 ? `m.${name}.length > 0` : `m.${name} !== ${zeroOf(f)}`;
            write.push(`if (${unset}) { w.tag(${f.number}, ${wireOf(f)}); ${writeOne('w', f, `m.${name}`)} }`);
            read.push(`case ${f.number}: if (wt === ${wireOf(f)}) m.${name} = ${readOne(f)}; else r.skip(wt); break;`);
        }
    }

    // A oneof is one field holding which member is set and its value.
    m.oneofs.forEach((oneofName, index) => {
        const members = m.fields.filter((f) => f.oneof === index && !f.optional);
        if (members.length === 0) return; // a synthetic oneof behind an `optional` field
        const name = member(oneofName);
        const cases = members.map((f) => `{ case: '${member(f.name)}'; value: ${tsType(f)} }`);
        iface.push(`    ${name}?: ${cases.join(' | ')} | undefined;`);
        write.push(`if (m.${name} !== undefined) {`, `    switch (m.${name}.case) {`);
        for (const f of members) write.push(`        case '${member(f.name)}': w.tag(${f.number}, ${wireOf(f)}); ${writeOne('w', f, `m.${name}.value`)} break;`);
        write.push('    }', '}');
        for (const f of members) read.push(`case ${f.number}: if (wt === ${wireOf(f)}) m.${name} = { case: '${member(f.name)}', value: ${readOne(f)} }; else r.skip(wt); break;`);
    });

    const jsonOut: string[] = [];
    const jsonIn: string[] = [];
    const INT_RANGE: Record<number, [string, string]> = {
        5: ['-2147483648', '2147483647'], 17: ['-2147483648', '2147483647'], 15: ['-2147483648', '2147483647'],
        13: ['0', '4294967295'], 7: ['0', '4294967295'],
        3: ['-9007199254740991', '9007199254740991'], 18: ['-9007199254740991', '9007199254740991'], 16: ['-9007199254740991', '9007199254740991'],
        4: ['0', '9007199254740991'], 6: ['0', '9007199254740991'],
    };
    const jsonTo = (f: FieldInfo, v: string): string => (f.type === 12 ? `b64(${v})` : f.type === T_MESSAGE ? `${ref(f.typeName).ts}.toJSON(${v})` : v);
    const jsonFrom = (f: FieldInfo, v: string, path: string): string => {
        const q = JSON.stringify(path);
        if (f.type === T_MESSAGE) return `${ref(f.typeName).ts}.fromJSON(${v})`;
        if (f.type === T_ENUM) return `jInt(${v}, ${q}, -2147483648, 2147483647)`;
        if (f.type === 1 || f.type === 2) return `jNum(${v}, ${q})`;
        if (f.type === 8) return `jBool(${v}, ${q})`;
        if (f.type === 9) return `jStr(${v}, ${q})`;
        if (f.type === 12) return `jBytes(${v}, ${q})`;
        const [lo, hi] = INT_RANGE[f.type]!;
        return `jInt(${v}, ${q}, ${lo}, ${hi})`;
    };
    for (const f of m.fields) {
        if (f.oneof !== null && !f.optional) continue;
        const name = member(f.name);
        const path = `${ts}.${name}`;
        const entry = entryOf(f);
        if (entry) {
            const [k, v] = entry.fields;
            const key = k!.type === 9 ? 'k' : k!.type === 8 ? `jMapBool(k, ${JSON.stringify(path)})` : `jMapInt(k, ${JSON.stringify(path)}, ${INT_RANGE[k!.type]![0]}, ${INT_RANGE[k!.type]![1]})`;
            jsonOut.push(`{ const e: Record<string, unknown> = {}; for (const [k, v] of m.${name}) e[String(k)] = ${jsonTo(v!, 'v')}; o.${name} = e; }`);
            jsonIn.push(`if (o.${name} != null) { const e = jObj(o.${name}, ${JSON.stringify(path)}); for (const k of Object.keys(e)) m.${name}.set(${key}, ${jsonFrom(v!, 'e[k]', path)}); }`);
        } else if (f.repeated) {
            jsonOut.push(`o.${name} = m.${name}.map((v) => ${jsonTo(f, 'v')});`);
            jsonIn.push(`if (o.${name} != null) m.${name} = jArr(o.${name}, ${JSON.stringify(path)}).map((v) => ${jsonFrom(f, 'v', path)});`);
        } else if (f.type === T_MESSAGE || f.optional) {
            jsonOut.push(`if (m.${name} !== undefined) o.${name} = ${jsonTo(f, `m.${name}`)};`);
            jsonIn.push(`if (o.${name} != null) m.${name} = ${jsonFrom(f, `o.${name}`, path)};`);
        } else {
            jsonOut.push(`o.${name} = ${jsonTo(f, `m.${name}`)};`);
            jsonIn.push(`if (o.${name} != null) m.${name} = ${jsonFrom(f, `o.${name}`, path)};`);
        }
    }
    m.oneofs.forEach((oneofName, index) => {
        const members = m.fields.filter((f) => f.oneof === index && !f.optional);
        if (members.length === 0) return;
        const name = member(oneofName);
        const path = `${ts}.${name}`;
        jsonOut.push(`if (m.${name} !== undefined) { switch (m.${name}.case) {`);
        for (const f of members) jsonOut.push(`    case '${member(f.name)}': o.${name} = { case: '${member(f.name)}', value: ${jsonTo(f, `m.${name}.value`)} }; break;`);
        jsonOut.push('} }');
        jsonIn.push(`if (o.${name} != null) { const p = jObj(o.${name}, ${JSON.stringify(path)}); switch (p.case) {`);
        for (const f of members) jsonIn.push(`    case '${member(f.name)}': m.${name} = { case: '${member(f.name)}', value: ${jsonFrom(f, 'p.value', path)} }; break;`);
        jsonIn.push(`    default: throw new RangeError(${JSON.stringify(path + ': unknown case ')} + String(p.case));`, '} }');
    });

    lines.push(`export interface ${ts} {`, ...iface, '}', '');
    lines.push(`export const ${ts} = {`);
    lines.push(`    create(init: Partial<${ts}> = {}): ${ts} {`,
        `        return { ${[...create, '...init'].join(', ')} };`, '    },');
    lines.push(`    write(m: ${ts}, w: Writer): void {`, ...write.map((l) => `        ${l}`), '    },');
    lines.push(`    read(r: Reader, end: number): ${ts} {`, `        const m = ${ts}.create();`,
        '        while (r.pos < end) {', '            const t = r.tag(); const wt = t & 7;', '            switch (t >>> 3) {',
        ...read.map((l) => `                ${l}`), '                default: r.skip(wt);', '            }', '        }', '        return m;', '    },');
    lines.push(`    toJSON(m: ${ts}): unknown {`, '        const o: Record<string, unknown> = {};', ...jsonOut.map((l) => `        ${l}`), '        return o;', '    },');
    lines.push(`    fromJSON(j: unknown): ${ts} {`, `        const o = jObj(j, ${JSON.stringify(ts)});`, `        const m = ${ts}.create();`, ...jsonIn.map((l) => `        ${l}`), '        return m;', '    },');
    lines.push(`    shape: ${JSON.stringify(shapeOf(fullName, registry))},`);
    lines.push(`    encode(m: ${ts}): Uint8Array { const w = new Writer(); ${ts}.write(m, w); return w.finish(); },`,
        `    decode(bytes: Uint8Array): ${ts} { return ${ts}.read(new Reader(bytes), bytes.length); },`, '};', '');
    return lines;
}

const prefixOf = (file: FileInfo): string => (file.package ? file.package : '');

const TYPE_NAMES: Record<number, string> = {
    1: 'double', 2: 'float', 3: 'int64', 4: 'uint64', 5: 'int32', 6: 'fixed64', 7: 'fixed32', 8: 'bool', 9: 'string',
    12: 'bytes', 13: 'uint32', 15: 'sfixed32', 16: 'sfixed64', 17: 'sint32', 18: 'sint64',
};

/**
 * A text naming a message's fields and, behind them, every message and enum it reaches, so two builds
 * can tell whether they agree on the shape of what is sent. `fullName` is `package.Outer.Inner`.
 */
function shapeOf(fullName: string, registry: Map<string, Named>): string {
    const seen = new Set<string>();
    const parts: string[] = [];
    const visit = (name: string): void => {
        if (seen.has(name)) return;
        seen.add(name);
        const named = registry.get(name);
        if (!named) return;
        if (named.kind === 'enum') {
            const e = named.info as EnumInfo;
            parts.push(`enum ${named.ts}{${e.values.map((v) => `${v.name}=${v.number}`).join(',')}}`);
            return;
        }
        const msg = named.info as MessageInfo;
        const fieldText = msg.fields.map((f) => {
            const kind = f.type === T_MESSAGE || f.type === T_ENUM ? (registry.get(f.typeName)?.ts ?? f.typeName) : TYPE_NAMES[f.type] ?? String(f.type);
            const label = f.repeated ? 'repeated ' : f.optional ? 'optional ' : '';
            const oneof = f.oneof !== null && !f.optional ? `@${msg.oneofs[f.oneof]}` : '';
            return `${f.number}:${label}${kind}${oneof} ${f.name}`;
        });
        parts.push(`${named.ts}{${fieldText.join(',')}}`);
        for (const f of msg.fields) if (f.type === T_MESSAGE || f.type === T_ENUM) visit(f.typeName);
    };
    visit(`.${fullName}`.replace(/^\.\./, '.'));
    return parts.join(';');
}

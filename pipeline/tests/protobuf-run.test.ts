// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installTool, toolStatus } from '../src/tools/externalTools';
import { PROTOBUF_DEFAULTS, parseProjectTools, type ProtobufSetting } from '../src/tools/projectTools';
import { protocErrors, protobufStalenessReport, runProtobuf } from '../src/tools/protobufRun';

describe('the project setting', () => {
    it('is off until named, fills in the defaults, and refuses a path that leaves the project', () => {
        expect(parseProjectTools({ protobuf: {} })!.protobuf).toEqual({ enabled: false, ...PROTOBUF_DEFAULTS });
        expect(parseProjectTools({ protobuf: { enabled: true, outDir: './src\\wire/' } })!.protobuf).toMatchObject({ enabled: true, outDir: 'src/wire' });
        expect(() => parseProjectTools({ protobuf: { protoDir: '../x' } })).toThrow(/tools\.protobuf\.protoDir must be a path inside the project/);
        expect(() => parseProjectTools({ protobuf: { enabled: 1 } })).toThrow(/true or false/);
        expect(parseProjectTools({ luban: {}, protobuf: {} })).toHaveProperty('luban');
    });
});

describe('protoc missing', () => {
    it('says what to run, and does not try', async () => {
        const root = mkdtempSync(path.join(tmpdir(), 'estella-proto-proj-'));
        const store = mkdtempSync(path.join(tmpdir(), 'estella-proto-store-'));
        try {
            let ran = false;
            const result = await runProtobuf({
                projectDir: root, store, platform: 'win-x64', setting: { enabled: true, ...PROTOBUF_DEFAULTS },
                run: async () => { ran = true; return { code: 0, output: '' }; },
            });
            expect(ran).toBe(false);
            expect(result).toMatchObject({ ok: false, reason: 'missing-tool' });
            expect(result.errors[0]).toMatch(/Protocol Buffers compiler 36\.2 is not installed.*estella tools install protoc/);
        } finally {
            rmSync(root, { recursive: true, force: true });
            rmSync(store, { recursive: true, force: true });
        }
    });

    it('keeps the complaints of protoc and drops its warnings', () => {
        expect(protocErrors('game.proto:3:9: "Foo" is not defined.\nwarning: unused import\n')).toEqual(['game.proto:3:9: "Foo" is not defined.']);
    });
});

const base = process.env.ESTELLA_TEST_TOOLS_BASE ? path.resolve(fileURLToPath(new URL('../..', import.meta.url)), process.env.ESTELLA_TEST_TOOLS_BASE) : '';
describe.skipIf(!base || !existsSync(path.join(base, 'external-tools.json')))('protoc, installed from the release files and run for real', () => {
    let store: string;
    let root: string;
    const setting: ProtobufSetting = { enabled: true, ...PROTOBUF_DEFAULTS };

    beforeAll(async () => {
        store = mkdtempSync(path.join(tmpdir(), 'estella-proto-store-'));
        root = mkdtempSync(path.join(tmpdir(), 'estella-proto-proj-'));
        const got = await installTool('protoc', { store, env: { ESTELLA_TOOLS_BASE: base } as NodeJS.ProcessEnv });
        expect(got.error).toBeUndefined();
        mkdirSync(path.join(root, 'proto/common'), { recursive: true });
        writeFileSync(path.join(root, 'proto/common/ids.proto'), 'syntax = "proto3";\npackage common;\nmessage Ref { string id = 1; }\n');
        writeFileSync(path.join(root, 'proto/game.proto'), `syntax = "proto3";
package game;
import "common/ids.proto";
enum Season { SPRING = 0; SUMMER = 1; AUTUMN = 2; WINTER = 3; }
message Order {
  string id = 1;
  int64 stamp = 2;
  sint32 delta = 3;
  repeated int32 counts = 4;
  repeated string tags = 5;
  map<string, int32> stock = 6;
  Season season = 7;
  optional uint32 note = 8;
  Inner inner = 9;
  oneof payload { string text = 10; double amount = 11; }
  bytes blob = 12;
  bool flag = 13;
  common.Ref ref = 14;
  float ratio = 15;
  sfixed64 big = 16;
  fixed32 f32 = 17;
  sint64 zig = 18;
  repeated Inner trail = 19;
  message Inner { int32 depth = 1; enum Mode { NONE = 0; FAST = 1; } Mode mode = 2; }
}
`);
    }, 120_000);
    afterAll(() => {
        rmSync(store, { recursive: true, force: true });
        rmSync(root, { recursive: true, force: true });
    });

    const run = (extra: Partial<Parameters<typeof runProtobuf>[0]> = {}) => runProtobuf({ projectDir: root, setting, store, ...extra });
    const protoc = () => path.join(toolStatus('protoc', { store }).dir!, process.platform === 'win32' ? 'bin/protoc.exe' : 'bin/protoc');
    const viaProtoc = (mode: '--encode' | '--decode', input: string | Buffer): Buffer => {
        const r = spawnSync(protoc(), [`${mode}=game.Order`, '-I', path.join(root, 'proto'), 'game.proto'], { input, cwd: path.join(root, 'proto') });
        expect(r.stderr.toString()).toBe('');
        return r.stdout;
    };
    const load = async () => (await import(/* @vite-ignore */ pathToFileURL(path.join(root, 'src/proto/game.ts')).href)).Order;

    it('writes TypeScript for every file, and a second run and a check find nothing to do', async () => {
        const first = await run();
        expect(first.errors).toEqual([]);
        expect(first.changed.sort()).toEqual(['src/proto/_runtime.ts', 'src/proto/common/ids.ts', 'src/proto/game.ts']);
        const game = readFileSync(path.join(root, 'src/proto/game.ts'), 'utf8');
        expect(game).toMatch(/import \{ Ref \} from '\.\/common\/ids'/);
        expect(game).toMatch(/export enum Order_Inner_Mode/);
        expect((await run()).changed).toEqual([]);
        expect((await run({ check: true })).ok).toBe(true);
        expect(protobufStalenessReport(root, setting).state).toBe('fresh');
    }, 60_000);

    it('reads what protoc writes and writes what protoc reads, for every kind of field', async () => {
        const text = `id: "o1" stamp: -5 delta: -3 counts: [1, -2, 300] tags: "a" tags: "b" stock { key: "w" value: 3 } season: WINTER note: 7
            inner { depth: 2 mode: FAST } text: "hi" blob: "\\001\\002" flag: true ref { id: "r" } ratio: 1.5 big: -9007199254740991 f32: 4000000000
            zig: -77 trail { depth: 1 } trail { depth: 3 mode: FAST }`;
        const theirs = viaProtoc('--encode', text);
        const Order = await load();
        const expected = {
            id: 'o1', stamp: -5, delta: -3, counts: [1, -2, 300], tags: ['a', 'b'], stock: new Map([['w', 3]]), season: 3, note: 7,
            inner: { depth: 2, mode: 1 }, payload: { case: 'text', value: 'hi' }, blob: new Uint8Array([1, 2]), flag: true,
            ref: { id: 'r' }, ratio: 1.5, big: -9007199254740991, f32: 4000000000, zig: -77,
            trail: [{ depth: 1, mode: 0 }, { depth: 3, mode: 1 }],
        };
        expect(Order.decode(new Uint8Array(theirs))).toEqual(expected);
        // Ours, read back by protoc and written again by protoc, is theirs byte for byte.
        const ours = Buffer.from(Order.encode(expected));
        expect(viaProtoc('--encode', viaProtoc('--decode', ours).toString()).equals(theirs)).toBe(true);
    }, 60_000);

    it('leaves defaults off the wire, keeps an unset optional unset, and skips fields it does not know', async () => {
        const Order = await load();
        const empty = Order.encode(Order.create());
        expect(empty.length).toBe(0);
        const back = Order.decode(empty);
        expect(back.note).toBeUndefined();
        expect(back.inner).toBeUndefined();
        expect(back.payload).toBeUndefined();
        expect(Order.decode(Order.encode(Order.create({ note: 0 }))).note).toBe(0);
        // field 99 (varint) and 98 (length-delimited) are ignored
        const unknown = Uint8Array.from([...Order.encode(Order.create({ id: 'x' })), 0x98, 0x06, 0x05, 0x92, 0x06, 0x01, 0x41]);
        expect(Order.decode(unknown).id).toBe('x');
        expect(() => Order.decode(Uint8Array.from([0x0a, 0x09, 0x41]))).toThrow(/truncated/);
        expect(() => Order.encode(Order.create({ stamp: 2 ** 60 }))).toThrow(/out of range/);
    }, 60_000);

    it('reports a mistake in a .proto file as protoc says it, and leaves the generated files as they were', async () => {
        const before = readFileSync(path.join(root, 'src/proto/game.ts'), 'utf8');
        writeFileSync(path.join(root, 'proto/bad.proto'), 'syntax = "proto3";\nmessage B { Missing m = 1; }\n');
        const result = await run();
        rmSync(path.join(root, 'proto/bad.proto'));
        expect(result).toMatchObject({ ok: false, reason: 'failed' });
        expect(result.errors.join('\n')).toMatch(/bad\.proto:2:\d+: "Missing" is not defined/);
        expect(readFileSync(path.join(root, 'src/proto/game.ts'), 'utf8')).toBe(before);
    }, 60_000);

    it('refuses proto2 by name', async () => {
        writeFileSync(path.join(root, 'proto/old.proto'), 'syntax = "proto2";\nmessage Old { optional int32 a = 1; }\n');
        const result = await run();
        rmSync(path.join(root, 'proto/old.proto'));
        expect(result.ok).toBe(false);
        expect(result.errors[0]).toMatch(/old\.proto: only proto3 is supported/);
    }, 60_000);

    it('goes stale when a .proto is saved after the last run', async () => {
        await run();
        expect(protobufStalenessReport(root, setting).state).toBe('fresh');
        await new Promise((r) => setTimeout(r, 30));
        writeFileSync(path.join(root, 'proto/common/ids.proto'), readFileSync(path.join(root, 'proto/common/ids.proto')));
        expect(protobufStalenessReport(root, setting).state).toBe('stale');
    }, 60_000);
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    aot-context.test.ts
 * @brief   A compiled system, called by the SDK, over the SDK's own rows.
 *
 * @details Everything before this tested one link. This runs the chain: emcc
 *          builds the module, `ScriptPool` holds the components in the same
 *          linear memory, `AotContext` lays out the SysCtx there, and the
 *          exported symbol is called with it. What comes back is compared to the
 *          same loop written in TypeScript.
 *
 *          The module imports the engine's memory and nothing else, so the
 *          memory here stands in for the engine's exactly.
 *
 *          Loud skip without emsdk: a gate that never saw its subject is worse
 *          than a missing one.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ScriptPool, poolShape } from '../src/ecs/ScriptPool';
import { WasmPoolMemory, type WasmHeap } from '../src/ecs/WasmPoolMemory';
import { AotContext, CMD_DESPAWN } from '../src/ecs/aot/AotContext';
import { AotResources } from '../src/ecs/aot/AotResources';
import type { Entity } from '../src/types';
import { emccPath } from '../../build-tools/utils/emscripten.js';
import { FakeEngine } from './fakeEngine';
import { WASM_LINK_FLAGS } from '../../compiler/src/codegen';

const e = (n: number): Entity => n as unknown as Entity;
const N = 16;

/**
 * The rows as the dispatcher hands them over: one flat block in query order,
 * with where each query starts and how many it has. Packing them is
 * `AotDispatch`'s job in a running world; this is the same shape by hand, which
 * is what keeps this test about the ARENA and not about the packer.
 */
function packed(rows: readonly (readonly number[])[]): {
    words: Uint32Array; rowWords: number; offsets: Uint32Array; counts: Uint32Array;
} {
    const width = rows.length > 0 ? rows[0]!.length : 0;
    const words = new Uint32Array(rows.length * width);
    rows.forEach((r, i) => words.set(r, i * width));
    return {
        words, rowWords: rows.length * width,
        offsets: new Uint32Array([0]), counts: new Uint32Array([rows.length]),
    };
}
const FRAMES = 8;

const EMCC = emccPath();

/**
 * The engine, as far as this test needs one: a linear memory and a bump
 * allocator over it. A real module differs in size, not in kind.
 */
/**
 * A hand-written system in the shape the compiler emits. Written out rather than
 * taken from the corpus so the test says what it is testing; the corpus version
 * is held to the same bytes by compiler/tests.
 */
const SYSTEM_C = `#include <stdint.h>
#include <string.h>

typedef uint32_t es_addr_t;
#define ES_PTR(a) ((unsigned char *)(a))

typedef struct EsQueryRows { es_addr_t rows; es_addr_t count; } EsQueryRows;
typedef struct EsCmd { uint32_t kind, a, b, c; } EsCmd;
typedef struct EsSysCtx {
    es_addr_t queries, resources, cmdBuf, cmdCap, cmdCount, events;
} EsSysCtx;

static double ld(const unsigned char *p) { double v; memcpy(&v, p, 8); return v; }
static void st(unsigned char *p, double v) { memcpy(p, &v, 8); }

/* One Mut(Mover) query and one Res(Time): remaining -= delta, and despawn at 0. */
void es_sys_Decay(es_addr_t ctx) {
    const EsSysCtx *c = (const EsSysCtx *)ES_PTR(ctx);
    const EsQueryRows *q = (const EsQueryRows *)ES_PTR(c->queries);
    const es_addr_t *res = (const es_addr_t *)ES_PTR(c->resources);
    unsigned char *time = ES_PTR(res[0]);
    EsCmd *cmds = (EsCmd *)ES_PTR(c->cmdBuf);
    uint32_t *count = (uint32_t *)ES_PTR(c->cmdCount);
    uint32_t n = *count;
    const es_addr_t *rows = (const es_addr_t *)ES_PTR(q[0].rows);
    for (es_addr_t i = 0; i < q[0].count; ++i) {
        const es_addr_t *row = rows + i * 2u;
        unsigned char *m = ES_PTR(row[1]);
        st(m, ld(m) - ld(time));               /* remaining is field 0 */
        if (ld(m) <= 0.0 && n < (uint32_t)c->cmdCap) {
            cmds[n].kind = 1u; cmds[n].a = (uint32_t)row[0];
            cmds[n].b = 0u; cmds[n].c = 0u;
            n += 1u;
        }
    }
    *count = n;
}
`;

function buildModule(): Uint8Array {
    const dir = mkdtempSync(path.join(tmpdir(), 'estella-sdk-aot-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'sys.c'), SYSTEM_C);
    const out = path.join(dir, 'sys.wasm');
    const built = spawnSync(EMCC!, [
        '-std=c11', '-O2', '-ffp-contract=off', '-Wall', '-Wextra',
        ...WASM_LINK_FLAGS, '-sEXPORTED_FUNCTIONS=_es_sys_Decay',
        '-o', out, path.join(dir, 'sys.c'),
    ], { encoding: 'utf8', cwd: dir, shell: process.platform === 'win32' });
    if (built.status !== 0) throw new Error(`emcc failed:\n${built.stderr}`);
    return readFileSync(out);
}

const DEFAULTS = { remaining: 0, rate: 1 };

describe('a compiled system, called by the SDK', () => {
    it('reports whether this gate could run at all', () => {
        if (EMCC) console.log('[aot-context] built and ran a real module');
        else console.warn('[aot-context] NO EMSDK — the chain did NOT run (pnpm emsdk:setup).');
        expect(true).toBe(true);
    });

    it.skipIf(!EMCC)('moves the SDK\'s own rows, exactly as TypeScript does', async () => {
        const engine = new FakeEngine();
        const memory = new WasmPoolMemory(engine);
        const instance = await WebAssembly.instantiate(
            new WebAssembly.Module(buildModule() as unknown as BufferSource),
            { env: { memory: engine.memory } });
        const api = instance.exports as unknown as Record<string, unknown>;
        (api['_initialize'] as (() => void) | undefined)?.();
        const decay = api['es_sys_Decay'] as (ctx: number) => void;

        // The world: rows in the engine's memory, and the same values in a plain
        // object per entity for TypeScript to walk.
        const pool = new ScriptPool(poolShape(DEFAULTS)!, 8, memory);
        const byHand = new Map<number, { remaining: number }>();
        const live: number[] = [];
        for (let i = 1; i <= N; i++) {
            pool.put(e(i), DEFAULTS, { remaining: i * 0.05 });
            byHand.set(i, { remaining: i * 0.05 });
            live.push(i);
        }

        // Time is a host record too, so it needs an address like anything else —
        // and the mirror is what gives it one, in the layout both sides derive
        // from the SDK's own declaration.
        const delta = 1 / 30;
        const time = { delta, elapsed: 0, frameCount: 0, fixedDelta: 1 / 60,
            fixedAlpha: 0, fixedTick: 0, scale: 1, unscaledDelta: 0 };
        const resources = new AotResources(memory, (name) => (name === 'Time' ? time : undefined));

        const ctx = new AotContext(memory);
        for (let f = 0; f < FRAMES; f++) {
            const rows = packed(live.map((id) => [id, pool.address(e(id))!]));
            const at = ctx.build(rows.words, rows.rowWords, rows.offsets, rows.counts,
                [resources.addressOf('Time')!]);
            decay(at);

            // The same loop, in TypeScript, over the plain objects.
            const dead: number[] = [];
            for (const id of live) {
                const row = byHand.get(id)!;
                row.remaining -= delta;
                if (row.remaining <= 0) dead.push(id);
            }

            const commands = ctx.commands();
            expect(commands.map((c) => c.a).sort((a, b) => a - b), `frame ${f} despawns`)
                .toEqual(dead.sort((a, b) => a - b));
            for (const c of commands) expect(c.kind).toBe(CMD_DESPAWN);

            for (const id of live) {
                expect(pool.get(e(id))!['remaining'], `frame ${f} entity ${id}`)
                    .toBe(byHand.get(id)!.remaining);
            }
            // The host applies the commands; the compiled code only records them.
            for (const id of dead) {
                pool.delete(e(id));
                byHand.delete(id);
                live.splice(live.indexOf(id), 1);
            }
        }

        expect(live.length, 'nothing despawned, so the commands proved nothing')
            .toBeLessThan(N);
        expect(live.length, 'everything despawned, so the reads proved nothing')
            .toBeGreaterThan(0);
        ctx.dispose();
    });

    it.skipIf(!EMCC)('a call with no rows is a call, not a crash', async () => {
        const engine = new FakeEngine();
        const memory = new WasmPoolMemory(engine);
        const instance = await WebAssembly.instantiate(
            new WebAssembly.Module(buildModule() as unknown as BufferSource),
            { env: { memory: engine.memory } });
        const api = instance.exports as unknown as Record<string, unknown>;
        (api['_initialize'] as (() => void) | undefined)?.();

        const resources = new AotResources(memory, () => ({ delta: 1 / 30 }));
        const ctx = new AotContext(memory);
        // An empty query still needs a well-formed table: `count` is zero and
        // `rows` must point somewhere the code will not read.
        const none = packed([]);
        (api['es_sys_Decay'] as (c: number) => void)(ctx.build(
            none.words, none.rowWords, none.offsets, none.counts,
            [resources.addressOf('Time')!]));
        expect(ctx.commands()).toEqual([]);
    });
});

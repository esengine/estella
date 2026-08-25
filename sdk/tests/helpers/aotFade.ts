// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    aotFade.ts
 * @brief   One compiled system, in the shape the compiler emits it.
 *
 * @details `Fade` is the smallest thing that exercises the whole path: an
 *          all-scalar script component, so its rows live in the pool a module
 *          can address, and a body that only reads and writes them. Shared so
 *          the runner-level gate and the App-level one run the same artifact.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { WASM_LINK_FLAGS } from '../../../compiler/src/codegen';
import { engineAbiDigest, projectShapeDigest } from '../../src/ecs/aot/abiDigest';
import { resourceMethodBit } from '../../src/ecs/resourceShapes';
import type { AotManifest } from '../../src/ecs/aot/AotSystems';

/** `Fade`: alpha -= step, addressed the way the ABI lays a call out. */
export const FADE_C = `#include <stdint.h>
#include <string.h>
typedef uint32_t es_addr_t;
#define ES_PTR(a) ((unsigned char *)(a))
typedef struct { es_addr_t rows, count; } EsQueryRows;
typedef struct { es_addr_t queries, resources, cmdBuf, cmdCap, cmdCount, events; } EsSysCtx;
static double ld(const unsigned char *p) { double v; memcpy(&v, p, 8); return v; }
static void st(unsigned char *p, double v) { memcpy(p, &v, 8); }

void es_sys_Fade(es_addr_t ctx) {
    const EsSysCtx *c = (const EsSysCtx *)ES_PTR(ctx);
    const EsQueryRows *q = (const EsQueryRows *)ES_PTR(c->queries);
    const es_addr_t *rows = (const es_addr_t *)ES_PTR(q[0].rows);
    for (es_addr_t i = 0; i < q[0].count; ++i) {
        unsigned char *f = ES_PTR(rows[i * 2u + 1u]);
        st(f, ld(f) - ld(f + 8));           /* alpha -= step */
    }
}
`;

/**
 * The same system, writing a value the author's closure cannot produce. A
 * differential proves a twin computes the right thing; it cannot prove the
 * twin RAN, because an interpreter that ran instead agrees with it. This can:
 * see the sentinel and dispatch happened.
 */
export const FADE_PROBE_C = FADE_C.replace(
    'st(f, ld(f) - ld(f + 8));           /* alpha -= step */',
    'st(f, -1.0);                        /* only a twin writes this */');

/** What the probe writes. No closure here produces a negative alpha. */
export const FADE_PROBE_ALPHA = -1;

export const FADE_FIELDS = ['alpha', 'step'];

export function buildAotModule(emcc: string, source: string, symbol: string): Uint8Array {
    const dir = mkdtempSync(path.join(tmpdir(), 'estella-aot-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'sys.c'), source);
    const out = path.join(dir, 'sys.wasm');
    const built = spawnSync(emcc, [
        '-std=c11', '-O2', '-ffp-contract=off', '-Wall', '-Wextra',
        ...WASM_LINK_FLAGS, `-sEXPORTED_FUNCTIONS=_${symbol}`,
        '-o', out, path.join(dir, 'sys.c'),
    ], { encoding: 'utf8', cwd: dir, shell: process.platform === 'win32' });
    if (built.status !== 0) throw new Error(`emcc failed:\n${built.stderr}`);
    return readFileSync(out);
}

export function buildFadeModule(emcc: string, source: string = FADE_C): Uint8Array {
    return buildAotModule(emcc, source, 'es_sys_Fade');
}

/**
 * A system that writes a RESOURCE: `Time.scale = 2`. Time is the resource with
 * a layout, and `scale` is slot 6 of it — the order in `resourceShapes.ts` IS
 * the layout, which is why both sides read that one file.
 */
export const TIME_SCALE_C = `#include <stdint.h>
#include <string.h>
typedef uint32_t es_addr_t;
#define ES_PTR(a) ((unsigned char *)(a))
typedef struct { es_addr_t queries, resources, cmdBuf, cmdCap, cmdCount, events; } EsSysCtx;
static void st(unsigned char *p, double v) { memcpy(p, &v, 8); }

void es_sys_Speed(es_addr_t ctx) {
    const EsSysCtx *c = (const EsSysCtx *)ES_PTR(ctx);
    const es_addr_t *res = (const es_addr_t *)ES_PTR(c->resources);
    st(ES_PTR(res[0]) + 6u * 8u, 2.0);      /* Time.scale = 2 */
}
`;

/**
 * A system that asks a SERVICE: `alpha = input.isKeyDown('KeyW') ? 1 : 0`. The
 * bit offsets come from the shared layout rather than being written down here,
 * because a third opinion about where the bit is would pass while the runtime
 * and the compiler disagreed.
 */
export function keyProbeC(): string {
    const at = resourceMethodBit('Input', 'isKeyDown', 'KeyW');
    if (!at) throw new Error('Input.isKeyDown(KeyW) is not a declared service question');
    return `#include <stdint.h>
#include <string.h>
typedef uint32_t es_addr_t;
#define ES_PTR(a) ((unsigned char *)(a))
typedef struct { es_addr_t rows, count; } EsQueryRows;
typedef struct { es_addr_t queries, resources, cmdBuf, cmdCap, cmdCount, events; } EsSysCtx;
static void st(unsigned char *p, double v) { memcpy(p, &v, 8); }

void es_sys_KeyProbe(es_addr_t ctx) {
    const EsSysCtx *c = (const EsSysCtx *)ES_PTR(ctx);
    const EsQueryRows *q = (const EsQueryRows *)ES_PTR(c->queries);
    const es_addr_t *rows = (const es_addr_t *)ES_PTR(q[0].rows);
    const es_addr_t *res = (const es_addr_t *)ES_PTR(c->resources);
    const int down = (ES_PTR(res[0])[${at.offset}u] >> ${at.bit}u) & 1u;
    for (es_addr_t i = 0; i < q[0].count; ++i) {
        st(ES_PTR(rows[i * 2u + 1u]), down ? 1.0 : 0.0);
    }
}
`;
}

/**
 * The same fade, but the query also filters on a TAG. A tag has no bytes, so
 * its row slot carries a filler the code never reads — and a host that treated
 * a missing address as a missing row would drop every row instead.
 */
export const FADE_TAGGED_C = FADE_C
    .replace('void es_sys_Fade', 'void es_sys_FadeTagged')
    .replace('rows[i * 2u + 1u]', 'rows[i * 3u + 1u]');

export function fadeTaggedManifest(): AotManifest {
    return {
        engineAbi: engineAbiDigest(4),
        projectShapes: projectShapeDigest([{ name: 'Fade', fields: FADE_FIELDS }, { name: 'Lit', fields: [] }]),
        systems: [{
            name: 'FadeTagged', symbol: 'es_sys_FadeTagged',
            queries: [[{ comp: 'Fade', mut: true }, { comp: 'Lit', mut: false }]], resources: [],
        }],
    };
}

/** What a build writes for the probe above. */
export function keyProbeManifest(): AotManifest {
    return {
        engineAbi: engineAbiDigest(4),
        projectShapes: projectShapeDigest([{ name: 'Fade', fields: FADE_FIELDS }]),
        systems: [{
            name: 'KeyProbe', symbol: 'es_sys_KeyProbe',
            queries: [[{ comp: 'Fade', mut: true }]], resources: [{ name: 'Input', mut: false }],
        }],
    };
}

/** What a build writes for that one, with Time declared writable or not. */
export function timeScaleManifest(mut: boolean): AotManifest {
    return {
        engineAbi: engineAbiDigest(4),
        projectShapes: projectShapeDigest([]),
        systems: [{ name: 'Speed', symbol: 'es_sys_Speed', queries: [], resources: [{ name: 'Time', mut }] }],
    };
}

/** What a build would have written beside that module, for THIS engine. */
export function fadeManifest(
    shapes = projectShapeDigest([{ name: 'Fade', fields: FADE_FIELDS }]),
): AotManifest {
    return {
        engineAbi: engineAbiDigest(4),
        projectShapes: shapes,
        systems: [{
            name: 'Fade', symbol: 'es_sys_Fade',
            queries: [[{ comp: 'Fade', mut: true }]], resources: [],
        }],
    };
}

#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  bench/lod/run.mjs — what LODGroup costs and what it saves, at scale.
 *
 * Two scenes with the same geometry, the same camera and the same lattice:
 * `lod-field` carries a group on every prop, `lod-field-flat` carries none and
 * so draws level 0 always. Everything below is measured on the SAME frame path
 * as the pixel gates, through the engine's own counters and scope timers.
 *
 *   node bench/lod/run.mjs                 1k and 10k, both scenes
 *   node bench/lod/run.mjs --counts 1000   one size
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const flag = (name, fallback) => {
    const at = process.argv.indexOf(`--${name}`);
    return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};

/** The lattice keeps ONE footprint across the sizes, so ten times the props is
 *  ten times as dense rather than a field ten times as wide. */
const LAYOUTS = {
    1000: { copies: 1024, cols: 32, spacing: [120, 300] },
    10000: { copies: 10000, cols: 100, spacing: [38.4, 96] },
};

/** The pair that differs in one component: a group on every prop, or none at all. */
const SCENES = ['lod-field.esscene', 'lod-field-flat.esscene'];

const COUNTS = flag('counts', '1000,10000').split(',').map((s) => Number(s.trim()));
const FRAMES = Number(flag('frames', '60'));
const WIDTH = flag('w', '512');
const HEIGHT = flag('h', '512');

function drive(sceneId, layout) {
    const run = spawnSync('pnpm', ['exec', 'electron', 'tools/render-host/run.mjs'], {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
            ...process.env,
            ESTELLA_VERIFY_SCENE: `/scenes/${sceneId}`,
            ESTELLA_VERIFY_W: WIDTH,
            ESTELLA_VERIFY_H: HEIGHT,
            ESTELLA_VERIFY_STEPS: '8',
            ESTELLA_VERIFY_SCALE: JSON.stringify(layout),
            ESTELLA_VERIFY_PROFILE: String(FRAMES),
        },
    });
    const line = (run.stdout ?? '').split('\n').find((l) => l.startsWith('DRIVE_RESULT '));
    if (!line) {
        throw new Error(`${sceneId}: the host produced no result\n${run.stdout}\n${run.stderr}`);
    }
    const out = JSON.parse(line.slice('DRIVE_RESULT '.length));
    const frames = out.profile?.frames ?? [];
    if (!frames.length) throw new Error(`${sceneId}: the recorder captured no frame`);
    return frames;
}

/** Median of a per-frame series — a mean is one stall away from a lie. */
function median(values) {
    const clean = values.filter((v) => typeof v === 'number');
    if (!clean.length) return NaN;
    const sorted = [...clean].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

const counter = (frames, name) => median(frames.map((f) => (f.counters ?? {})[name]));
const scope = (frames, name) => median(frames.map(
    (f) => (f.nativeScopes ?? []).find((s) => s.name === name)?.ms));

const rows = [];
for (const count of COUNTS) {
    const layout = LAYOUTS[count];
    if (!layout) throw new Error(`no lattice declared for ${count} props`);
    for (const sceneId of SCENES) {
        const frames = drive(sceneId, layout);
        rows.push({
            props: layout.copies,
            scene: sceneId === SCENES[0] ? 'LODGroup' : 'alwaysLOD0',
            selections: counter(frames, 'render.lod.groups'),
            lod0: counter(frames, 'render.lod.level0'),
            lod1: counter(frames, 'render.lod.level1'),
            lod2: counter(frames, 'render.lod.level2'),
            lodCulled: counter(frames, 'render.lod.culled'),
            drawn: counter(frames, 'render.meshes'),
            culled: counter(frames, 'render.culled'),
            triangles: counter(frames, 'render.triangles'),
            draws: counter(frames, 'batch.draws'),
            collectMs: scope(frames, 'render.collect'),
            graphMs: scope(frames, 'render.graph'),
            gpuMs: median(frames.map((f) => f.gpuMs)),
        });
    }
}

const cols = Object.keys(rows[0]);
const width = Object.fromEntries(cols.map((k) => [k,
    Math.max(k.length, ...rows.map((r) => String(fmt(r[k])).length))]));
function fmt(v) {
    return typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(3) : String(v);
}
console.log(cols.map((k) => k.padStart(width[k])).join('  '));
for (const r of rows) console.log(cols.map((k) => fmt(r[k]).padStart(width[k])).join('  '));

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Run the SDK embedded in a built desktop host: node bench/scene-validation.mjs <host>
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requireNativeHostSuccess } from '../tools/lib/nativeHostResult.mjs';

// This function runs as the project's scripts.js, inside the host.
function measure() {
    const { validateScene, SCENE_FORMAT_VERSION } = globalThis.ESEngine;
    function scene(firstId, step) {
        const entities = [];
        for (let i = 0; i < 2048; i++) {
            const id = firstId + i * step;
            const parent = i % 32 ? entities[i - 1] : null;
            entities.push({ id, name: 'Node ' + i, parent: parent?.id ?? null, children: [], components: [
                { type: 'Transform', data: {} },
                { type: i % 2 ? 'MeshRenderer' : 'Sprite', data: {} },
            ] });
            if (parent) parent.children.push(id);
        }
        return { version: SCENE_FORMAT_VERSION, name: 'Validation', entities };
    }

    const dense = scene(1, 1);
    const sparse = scene(10000003, 17);
    function time(input) {
        const start = performance.now();
        for (let i = 0; i < 4; i++) {
            const issues = validateScene(input);
            if (issues.length) throw new Error(JSON.stringify(issues[0]));
        }
        return (performance.now() - start) / 4;
    }
    // A no-op validator would satisfy the timing comparison.
    const duplicate = { ...dense, entities: [dense.entities[0], dense.entities[0]] };
    if (!validateScene(duplicate).some(issue => issue.code === 'duplicate-id')) {
        throw new Error('missing duplicate ID diagnostic');
    }
    time(dense);
    time(sparse);
    const ratios = [];
    for (let pass = 0; pass < 7; pass++) {
        const first = time(pass % 2 ? sparse : dense);
        const second = time(pass % 2 ? dense : sparse);
        ratios.push(pass % 2 ? second / first : first / second);
    }
    const ratio = ratios.sort((a, b) => a - b)[3];
    console.log('SCENE_ID_RATIO ' + JSON.stringify(ratio));
}

const host = process.argv[2];
if (!host) throw new Error('Usage: node bench/scene-validation.mjs <desktop-host>');
const dir = mkdtempSync(path.join(tmpdir(), 'estella-scene-validation-'));
try {
    const entryScene = 'main.esscene';
    writeFileSync(path.join(dir, 'game.config.json'), JSON.stringify({
        entryScene, scenes: [{ name: 'main', path: entryScene }], scripts: 'scripts.js',
    }));
    writeFileSync(path.join(dir, entryScene), JSON.stringify({ version: 4, name: 'main', entities: [] }));
    writeFileSync(path.join(dir, 'asset-manifest.json'), JSON.stringify({ version: '2.0', groups: {} }));
    writeFileSync(path.join(dir, 'scripts.js'), '(' + measure.toString() + ')();');
    const run = spawnSync(path.resolve(host), [dir], {
        argv0: path.join(path.dirname(path.resolve(host)), 'estella-scene-validation'),
        encoding: 'utf8', timeout: 120000,
        env: { ...process.env, ESTELLA_HIDDEN_WINDOW: '1', SDL_MAC_BACKGROUND_APP: '1',
            ESTELLA_BENCH_FRAMES: '4', ESTELLA_BENCH_WARMUP: '0', ESTELLA_BENCH_QUIT: '1' },
    });
    requireNativeHostSuccess(run, 'scene validation');
    const log = run.stdout + run.stderr;
    const match = /SCENE_ID_RATIO ([^\s]+)/.exec(log);
    if (!match) throw new Error('No scene validation timings from the host:\n' + log.slice(-2500));
    const ratio = Number(match[1]);
    // Both documents describe the same forest. The old runtime took over 10x
    // longer for sequential IDs. Compare within this host, independent of CPU speed.
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 5) {
        throw new Error('Scene validation with sequential IDs took ' + match[1] + 'x the sparse-ID time (limit 5x)');
    }
    console.log('Scene validation, sequential / sparse entity IDs: ' + ratio.toFixed(2) + 'x');
} finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

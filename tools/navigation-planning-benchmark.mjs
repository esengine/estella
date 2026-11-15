// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { ROOT as root } from './lib/repo.mjs';
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const bundle = await build({ entryPoints: [path.join(root, 'tools/fixtures/navigation-planning-corpus.ts')],
    bundle: true, platform: 'browser', format: 'iife', globalName: 'NavPlanningCorpus', write: false });
const code = bundle.outputFiles[0].text;
const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(() => window.NavPlanningCorpus.runNavigationPlanningCorpus());
    const report = { source, bundleSha256: createHash('sha256').update(code).digest('hex'), recordedAt: new Date().toISOString(),
        sourceDirtyFiles: execFileSync('git', ['status', '--porcelain=1', '--untracked-files=all', '--', 'sdk/src/ai/nav'], { cwd: root, encoding: 'utf8', windowsHide: true }).split('\n').filter(Boolean),
        platform: process.platform, cpu: os.cpus()[0]?.model, browser: browser.version(),
        scope: 'Same current agent system and building maps, unlimited versus default planning budgets. Includes grid obstacle marking, agent planning, movement and avoidance over an in-memory World. Zero movement speed keeps all query inputs identical. Genuine headless Chromium rAF callback gaps; no rendering, physics, editor or full game frame. Budget is soft between indivisible synchronous queries; latency and total CPU are reported separately.',
        ...result };
    const destination = path.resolve(root, process.argv[2] ?? 'output/navigation-planning.json');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, JSON.stringify(report, null, 2));
    for (const r of result.records) for (const m of r.modes) console.log(`${r.size} ${m.mode}: peak-step-p95=${m.peakStepP95Ms.toFixed(2)}ms peak-plan-p95=${m.peakPlanningP95Ms.toFixed(2)}ms total-cpu-p95=${m.totalCpuP95Ms.toFixed(2)}ms batch-latency-p95=${m.latencyP95Ms.toFixed(2)}ms over-budget=${m.batchesOverFrameBudget}/16`);
    console.log(destination);
} finally { await browser.close(); }

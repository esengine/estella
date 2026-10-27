// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  lubanRun.ts — run Luban over a project's tables: write the JSON and TypeScript, or check them.
 *
 * Luban is a .NET program; the engine runs the exact runtime and Luban it pinned (externalTools.ts),
 * never a `dotnet` that happens to be on the machine. It writes into a scratch folder first and the
 * result is copied in only where it differs, so a run that fails leaves the project's files as they
 * were and a run that changes nothing touches nothing (no needless rebuilds, no noisy diffs).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveInside } from '../fs/pathSandbox';
import { hostPlatform, installPlan, toolReady, toolStatus, toolsManifest, type ToolPlatform } from './externalTools';
import type { LubanSetting } from './projectTools';

/** Files a run wrote, remembered so the next one can remove what is no longer produced. */
const LEDGER = '.esengine/luban-generated.json';

export interface LubanRunOptions {
    projectDir: string;
    setting: LubanSetting;
    /** Compare instead of write: succeeds only when the project's files are what Luban would write. */
    check?: boolean;
    store?: string;
    platform?: ToolPlatform | null;
    /** What to tell a person to do when the tool is missing, in the words of the place they are (a command line, the editor). */
    installHint?: string;
    /** For tests: how a process is run. */
    run?: (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<{ code: number | null; output: string }>;
}

export interface LubanRunResult {
    ok: boolean;
    /** Why it did not work, as sentences a designer can act on. */
    errors: string[];
    /** `missing-tool` when Luban is switched on and not installed: the caller offers the download. */
    reason?: 'missing-tool' | 'failed' | 'drift';
    /** Files written (or, when checking, found out of date). */
    changed: string[];
    log: string;
}

export function defaultRun(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd: options.cwd, env: options.env, windowsHide: true });
        let output = '';
        const limit = setTimeout(() => { child.kill(); reject(new Error('Luban did not finish in five minutes')); }, 5 * 60_000);
        child.stdout.on('data', (d) => { output += d; });
        child.stderr.on('data', (d) => { output += d; });
        child.on('error', (err) => { clearTimeout(limit); reject(err); });
        child.on('close', (code) => { clearTimeout(limit); resolve({ code, output }); });
    });
}

/** The lines Luban marked as errors, without its timestamp and level. */
export function lubanErrors(output: string): string[] {
    const out: string[] = [];
    for (const line of output.split(/\r?\n/)) {
        const m = /\|ERROR\|\s*(.*)$/.exec(line);
        if (!m) continue;
        const message = m[1]!.replace(/^===>\s*"?/, '').replace(/"$/, '').trim();
        if (message && message !== '运行失败!!!') out.push(message);
    }
    return out;
}

export function listFiles(dir: string, rel = ''): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const name = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), name));
        else if (entry.isFile()) out.push(name);
    }
    return out;
}

export function sameBytes(a: string, b: string): boolean {
    return existsSync(a) && existsSync(b) && statSync(a).size === statSync(b).size && readFileSync(a).equals(readFileSync(b));
}

/** Within the project, whatever the setting says. */
export function inside(root: string, rel: string): string {
    return resolveInside(root, rel, 'project');
}

export async function runLuban(options: LubanRunOptions): Promise<LubanRunResult> {
    const root = path.resolve(options.projectDir);
    const platform = options.platform === undefined ? hostPlatform() : options.platform;
    const where = { platform, store: options.store };
    const status = toolStatus('luban', where);
    if (!toolReady(status)) {
        const plan = installPlan('luban', where);
        const what = plan.items.map((i) => `${i.name} ${i.version}`).join(' and ');
        return { ok: false, reason: 'missing-tool', changed: [], log: '', errors: [what
            ? `Luban is switched on for this project but ${what} ${plan.items.length > 1 ? 'are' : 'is'} not installed. ${options.installHint ?? 'Run: estella tools install luban'}`
            : `Luban cannot run here: ${status.problem ?? status.needs.find((n) => !toolReady(n))?.problem ?? 'unavailable'}`] };
    }
    const manifest = toolsManifest();
    const dotnetDir = status.needs.find((n) => n.id === 'dotnet')!.dir!;
    const dotnet = path.join(dotnetDir, manifest.tools.dotnet!.executables?.[platform!]?.[0] ?? 'dotnet');
    const dll = path.join(status.dir!, manifest.tools.luban!.entry!);

    const s = options.setting;
    const conf = inside(root, s.conf);
    if (!existsSync(conf)) return { ok: false, reason: 'failed', changed: [], log: '', errors: [`${s.conf} does not exist`] };
    const finalCode = inside(root, s.codeDir);
    const finalData = inside(root, s.dataDir);

    // Taken before the run reads anything: a table saved while Luban works is newer than this, so it is seen next time
    // instead of being counted as already generated.
    const startedAt = Date.now();
    const scratch = mkdtempSync(path.join(tmpdir(), 'estella-luban-'));
    try {
        const outCode = path.join(scratch, 'code');
        const outData = path.join(scratch, 'data');
        mkdirSync(outCode, { recursive: true });
        mkdirSync(outData, { recursive: true });
        const args = [dll, '--conf', conf, '-t', s.target, '-c', s.codeTarget, '-d', s.dataTarget,
            '-x', `outputCodeDir=${outCode}`, '-x', `outputDataDir=${outData}`];
        const env: NodeJS.ProcessEnv = { ...process.env, DOTNET_ROOT: dotnetDir, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_gcServer: '0' };
        const run = options.run ?? defaultRun;
        const { code, output } = await run(dotnet, args, { cwd: path.dirname(conf), env });
        const errors = lubanErrors(output);
        if (code !== 0 || errors.length > 0) {
            return { ok: false, reason: 'failed', changed: [], log: output, errors: errors.length ? errors : [`Luban exited with code ${code}`] };
        }

        const made: Array<{ from: string; to: string; rel: string }> = [
            ...listFiles(outCode).map((rel) => ({ from: path.join(outCode, rel), to: path.join(finalCode, rel), rel: `${s.codeDir}/${rel}` })),
            ...listFiles(outData).map((rel) => ({ from: path.join(outData, rel), to: path.join(finalData, rel), rel: `${s.dataDir}/${rel}` })),
        ];
        if (made.length === 0) return { ok: false, reason: 'failed', changed: [], log: output, errors: ['Luban wrote nothing; check the targets in the project\'s tools.luban settings'] };

        const ledgerFile = path.join(root, LEDGER);
        const before: string[] = existsSync(ledgerFile) ? (JSON.parse(readFileSync(ledgerFile, 'utf8')) as { files: string[] }).files : [];
        const stale = before.filter((rel) => !made.some((m) => m.rel === rel) && existsSync(path.join(root, rel)));
        const differing = made.filter((m) => !sameBytes(m.from, m.to));

        if (options.check) {
            const drift = [...differing.map((m) => m.rel), ...stale];
            return drift.length === 0
                ? { ok: true, errors: [], changed: [], log: output }
                : { ok: false, reason: 'drift', changed: drift, log: output, errors: [`These files are not what the tables produce: ${drift.join(', ')}. Run: estella luban gen`] };
        }

        for (const m of differing) {
            mkdirSync(path.dirname(m.to), { recursive: true });
            writeFileSync(m.to, readFileSync(m.from));
        }
        for (const rel of stale) rmSync(path.join(root, rel), { force: true });
        mkdirSync(path.dirname(ledgerFile), { recursive: true });
        writeFileSync(ledgerFile, JSON.stringify({ note: 'Written by estella luban gen. Files listed here are replaced or removed by the next run.', generatedAt: startedAt, files: made.map((m) => m.rel) }, null, 2) + '\n');
        return { ok: true, errors: [], changed: [...differing.map((m) => m.rel), ...stale], log: output };
    } finally {
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
}

export type Staleness = 'fresh' | 'stale' | 'never';

/** Files an editor or Excel leaves beside a document while it is open: not something a designer wrote. */
const SCRATCH = /^(~\$|\.~lock\.|\.#|.*\.(tmp|bak)$)/i;

export function newestInput(dir: string): number {
    let newest = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (SCRATCH.test(entry.name)) continue;
        const full = path.join(dir, entry.name);
        newest = Math.max(newest, entry.isDirectory() ? newestInput(full) : statSync(full).mtimeMs);
    }
    return newest;
}

export interface StalenessReport {
    state: Staleness;
    /** When the newest file under the Luban folder was saved (ms), 0 when there is none. A caller that remembers a failed run by this can tell "still the same mistake" from "edited since". */
    newest: number;
}

/**
 * Do the project's generated files still say what its tables say? A look at modification times, no Luban run:
 * cheap enough to ask every time a window is focused. `never` means no run has been recorded (or a file it wrote is
 * gone); `stale` means something under the Luban folder was saved after the last run began. A run that changed
 * nothing still counts as a run, so saving an Excel file without changing a value is answered once, not for ever.
 */
export function lubanStalenessReport(projectDir: string, setting: LubanSetting): StalenessReport {
    const root = path.resolve(projectDir);
    return ledgerStaleness(root, LEDGER, path.dirname(inside(root, setting.conf)));
}

/** The look both generators share: the newest input against the ledger the last run left. */
export function ledgerStaleness(root: string, ledgerRel: string, inputDir: string): StalenessReport {
    const newest = existsSync(inputDir) ? newestInput(inputDir) : 0;
    const ledgerFile = path.join(root, ledgerRel);
    if (!existsSync(ledgerFile) || !existsSync(inputDir)) return { state: 'never', newest };
    let ledger: { files?: string[]; generatedAt?: number };
    try { ledger = JSON.parse(readFileSync(ledgerFile, 'utf8')); } catch { return { state: 'never', newest }; }
    if (typeof ledger.generatedAt !== 'number' || !Array.isArray(ledger.files)) return { state: 'never', newest };
    if (ledger.files.some((rel) => !existsSync(path.join(root, rel)))) return { state: 'never', newest };
    return { state: newest > ledger.generatedAt ? 'stale' : 'fresh', newest };
}

export function lubanStaleness(projectDir: string, setting: LubanSetting): Staleness {
    return lubanStalenessReport(projectDir, setting).state;
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  protobufRun.ts — turn a project's .proto files into TypeScript: write it, or check it.
 *
 * The same shape as lubanRun.ts: the pinned `protoc` (never one that happens to be on the PATH) parses the files into
 * a descriptor set in a scratch folder, protoGen.ts writes the TypeScript there, and the result is copied into the
 * project only where it differs, so a run that fails leaves the project's files as they were.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hostPlatform, installPlan, toolReady, toolStatus, toolsManifest, type ToolPlatform } from './externalTools';
import { defaultRun, inside, ledgerStaleness, listFiles, sameBytes, type StalenessReport } from './lubanRun';
import { generateTypeScript, readDescriptorSet } from './protoGen';
import { PROTO_RUNTIME } from './protoRuntime';
import type { ProtobufSetting } from './projectTools';

const LEDGER = '.esengine/protobuf-generated.json';

export interface ProtobufRunOptions {
    projectDir: string;
    setting: ProtobufSetting;
    check?: boolean;
    store?: string;
    platform?: ToolPlatform | null;
    installHint?: string;
    run?: (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<{ code: number | null; output: string }>;
}

export interface ProtobufRunResult {
    ok: boolean;
    errors: string[];
    reason?: 'missing-tool' | 'failed' | 'drift';
    changed: string[];
    log: string;
}

function protoFiles(dir: string): string[] {
    return listFiles(dir).filter((f) => f.endsWith('.proto'));
}

/** protoc's complaints, one per line, without the path of the scratch folder it was run from. */
export function protocErrors(output: string): string[] {
    return output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^warning:/i.test(l) && !/: warning:/i.test(l));
}

export async function runProtobuf(options: ProtobufRunOptions): Promise<ProtobufRunResult> {
    const root = path.resolve(options.projectDir);
    const platform = options.platform === undefined ? hostPlatform() : options.platform;
    const where = { platform, store: options.store };
    const status = toolStatus('protoc', where);
    if (!toolReady(status)) {
        const plan = installPlan('protoc', where);
        const what = plan.items.map((i) => `${i.name} ${i.version}`).join(' and ');
        return { ok: false, reason: 'missing-tool', changed: [], log: '', errors: [what
            ? `Protobuf is switched on for this project but ${what} ${plan.items.length > 1 ? 'are' : 'is'} not installed. ${options.installHint ?? 'Run: estella tools install protoc'}`
            : `Protobuf cannot run here: ${status.problem ?? 'unavailable'}`] };
    }
    const protoc = path.join(status.dir!, toolsManifest().tools.protoc!.executables?.[platform!]?.[0] ?? 'bin/protoc');

    const s = options.setting;
    const protoDir = inside(root, s.protoDir);
    const finalOut = inside(root, s.outDir);
    if (!existsSync(protoDir)) return { ok: false, reason: 'failed', changed: [], log: '', errors: [`${s.protoDir} does not exist`] };
    const sources = protoFiles(protoDir);
    if (sources.length === 0) return { ok: false, reason: 'failed', changed: [], log: '', errors: [`There are no .proto files under ${s.protoDir}`] };

    const startedAt = Date.now();
    const scratch = mkdtempSync(path.join(tmpdir(), 'estella-proto-'));
    try {
        const setFile = path.join(scratch, 'set.bin');
        const args = ['-I', protoDir, '-I', path.join(status.dir!, 'include'), '--include_imports', `--descriptor_set_out=${setFile}`, ...sources];
        const run = options.run ?? defaultRun;
        const { code, output } = await run(protoc, args, { cwd: protoDir, env: process.env });
        if (code !== 0) {
            const errors = protocErrors(output);
            return { ok: false, reason: 'failed', changed: [], log: output, errors: errors.length ? errors : [`protoc exited with code ${code}`] };
        }
        let generated;
        try {
            generated = generateTypeScript(readDescriptorSet(readFileSync(setFile)), PROTO_RUNTIME);
        } catch (err) {
            return { ok: false, reason: 'failed', changed: [], log: output, errors: [(err as Error).message] };
        }
        // Only what the project's own files, and what they import, need.
        const made = generated.map((g) => {
            const from = path.join(scratch, 'out', g.path);
            mkdirSync(path.dirname(from), { recursive: true });
            writeFileSync(from, g.content);
            return { from, to: path.join(finalOut, g.path), rel: `${s.outDir}/${g.path}` };
        });

        const ledgerFile = path.join(root, LEDGER);
        const before: string[] = existsSync(ledgerFile) ? (JSON.parse(readFileSync(ledgerFile, 'utf8')) as { files: string[] }).files : [];
        const stale = before.filter((rel) => !made.some((m) => m.rel === rel) && existsSync(path.join(root, rel)));
        const differing = made.filter((m) => !sameBytes(m.from, m.to));

        if (options.check) {
            const drift = [...differing.map((m) => m.rel), ...stale];
            return drift.length === 0
                ? { ok: true, errors: [], changed: [], log: output }
                : { ok: false, reason: 'drift', changed: drift, log: output, errors: [`These files are not what the .proto files produce: ${drift.join(', ')}. Run: estella proto gen`] };
        }
        for (const m of differing) {
            mkdirSync(path.dirname(m.to), { recursive: true });
            writeFileSync(m.to, readFileSync(m.from));
        }
        for (const rel of stale) rmSync(path.join(root, rel), { force: true });
        mkdirSync(path.dirname(ledgerFile), { recursive: true });
        writeFileSync(ledgerFile, JSON.stringify({ note: 'Written by estella proto gen. Files listed here are replaced or removed by the next run.', generatedAt: startedAt, files: made.map((m) => m.rel) }, null, 2) + '\n');
        return { ok: true, errors: [], changed: [...differing.map((m) => m.rel), ...stale], log: output };
    } finally {
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
}

export function protobufStalenessReport(projectDir: string, setting: ProtobufSetting): StalenessReport {
    const root = path.resolve(projectDir);
    return ledgerStaleness(root, LEDGER, inside(root, setting.protoDir));
}

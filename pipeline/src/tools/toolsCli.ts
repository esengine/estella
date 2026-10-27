// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  toolsCli.ts — `estella tools …` and `estella luban …`, and the step an export takes for a project that uses Luban.
 *
 * Every function here returns an exit code and prints what a person needs; none of it exits the
 * process, so the editor can reuse the pieces beneath (externalTools.ts, lubanRun.ts) the same way.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
    hostPlatform, installPlan, installTool, removeTool, toolIds, toolStatus,
    type InstallPlan, type ToolStatus,
} from './externalTools';
import { runLuban } from './lubanRun';
import { runProtobuf } from './protobufRun';
import { parseManifest } from '../project/format';

const mb = (bytes: number) => (bytes >= 10 * 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)} MB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

function line(status: ToolStatus, indent = ''): string[] {
    const state = status.installed ? 'installed' : status.problem ?? 'not installed';
    const out = [`${indent}${status.id.padEnd(8)} ${status.version.padEnd(8)} ${status.license.padEnd(4)} ${state}${status.dir && status.installed ? `  (${status.dir})` : ''}`];
    for (const need of status.needs) out.push(...line(need, `${indent}  needs `));
    return out;
}

export function toolsStatus(options: { json?: boolean; store?: string } = {}): number {
    const all = toolIds().map((id) => toolStatus(id, { store: options.store }));
    if (options.json) {
        console.log(JSON.stringify({ platform: hostPlatform(), tools: all }, null, 2));
        return 0;
    }
    console.log(`platform: ${hostPlatform() ?? `${process.platform}/${process.arch} (no tools are pinned for it)`}`);
    for (const status of all) for (const text of line(status)) console.log(text);
    return 0;
}

/** What would be downloaded, as the words put in front of a person before they agree. */
export function describePlan(plan: InstallPlan): string[] {
    const out: string[] = [];
    for (const item of plan.items) {
        out.push(`  ${item.name} ${item.version} (${item.license})  about ${mb(item.upstreamBytes)}`);
        out.push(`    the vendor's file: ${item.upstreamUrl}`);
    }
    out.push(`  from: ${plan.sources.join(', ')}`);
    out.push('  Every file is checked against the size and SHA-256 this engine pins before it is used.');
    return out;
}

export async function toolsInstall(id: string, options: { yes?: boolean; base?: string; store?: string } = {}): Promise<number> {
    if (!toolIds().includes(id)) {
        console.error(`unknown tool "${id}"; known: ${toolIds().join(', ')}`);
        return 2;
    }
    const env = options.base ? { ...process.env, ESTELLA_TOOLS_BASE: options.base } : process.env;
    const plan = installPlan(id, { store: options.store, env });
    if (!hostPlatform()) {
        console.error(`no ${id} build is pinned for ${process.platform}/${process.arch}`);
        return 1;
    }
    if (plan.items.length === 0) {
        console.log(`${id} is already installed.`);
        return 0;
    }
    console.log(`Installing ${id} needs:`);
    for (const text of describePlan(plan)) console.log(text);
    if (!options.yes) {
        if (!process.stdin.isTTY) {
            console.error('Not downloading: nothing can be asked here. Run again with --yes to agree.');
            return 2;
        }
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = (await rl.question('Download and install? [y/N] ')).trim().toLowerCase();
        rl.close();
        if (answer !== 'y' && answer !== 'yes') {
            console.log('Nothing was downloaded.');
            return 1;
        }
    }
    let shown = 0;
    const result = await installTool(id, {
        store: options.store, env,
        onProgress: ({ tool, received, total }) => {
            const pct = Math.floor((received / total) * 100);
            if (pct >= shown + 10 || received === total) { shown = pct; process.stdout.write(`  ${tool}: ${pct}%\r`); }
            if (received === total) { shown = 0; process.stdout.write('\n'); }
        },
    });
    if (!result.ok) {
        console.error(`Installing ${id} failed: ${result.error}`);
        if (result.installed.length) console.error(`(installed before the failure: ${result.installed.join(', ')})`);
        return 1;
    }
    console.log(`Installed: ${result.installed.join(', ')}`);
    return 0;
}

export function toolsRemove(id: string, options: { store?: string } = {}): number {
    if (!toolIds().includes(id)) { console.error(`unknown tool "${id}"`); return 2; }
    console.log(removeTool(id, options.store) ? `Removed ${id}.` : `${id} was not installed.`);
    return 0;
}

function readProjectManifest(projectDir: string) {
    const file = path.join(projectDir, 'project.esproject');
    if (!existsSync(file)) throw new Error(`no project.esproject in ${projectDir}`);
    return parseManifest(JSON.parse(readFileSync(file, 'utf8')));
}

/** `estella luban gen|check <project>`: build the tables, or check they are built. */
export async function lubanCommand(sub: 'gen' | 'check', projectDir: string, options: { store?: string } = {}): Promise<number> {
    const manifest = readProjectManifest(projectDir);
    const setting = manifest.tools?.luban;
    if (!setting?.enabled) {
        console.error('Luban is off for this project. Switch it on in project.esproject:\n  "tools": { "luban": { "enabled": true } }');
        return 2;
    }
    const result = await runLuban({ projectDir, setting, check: sub === 'check', store: options.store });
    if (result.ok) {
        console.log(sub === 'check' ? 'The tables are up to date.' : result.changed.length ? `Wrote ${result.changed.length} file(s):\n  ${result.changed.join('\n  ')}` : 'Nothing changed.');
        return 0;
    }
    for (const error of result.errors) console.error(error);
    return result.reason === 'missing-tool' ? 3 : 1;
}

/** `estella proto gen|check <project>`: generate TypeScript from the .proto files, or check it is generated. */
export async function protoCommand(sub: 'gen' | 'check', projectDir: string, options: { store?: string } = {}): Promise<number> {
    const setting = readProjectManifest(projectDir).tools?.protobuf;
    if (!setting?.enabled) {
        console.error('Protobuf is off for this project. Switch it on in project.esproject:\n  "tools": { "protobuf": { "enabled": true } }');
        return 2;
    }
    const result = await runProtobuf({ projectDir, setting, check: sub === 'check', store: options.store });
    if (result.ok) {
        console.log(sub === 'check' ? 'The generated protobuf code is up to date.' : result.changed.length ? `Wrote ${result.changed.length} file(s):\n  ${result.changed.join('\n  ')}` : 'Nothing changed.');
        return 0;
    }
    for (const error of result.errors) console.error(error);
    return result.reason === 'missing-tool' ? 3 : 1;
}

/**
 * What an export does first for a project that has Luban or Protobuf on: bring the generated files up to date, so a game
 * is never packaged from stale JSON or stale code. A tool that is off is not touched, and nothing is looked for.
 * Returns the message to stop with, or null to go on.
 */
export async function prepareProjectTools(projectDir: string, options: { store?: string; installHint?: string } = {}): Promise<string | null> {
    const tools = readProjectManifest(projectDir).tools;
    const problems: string[] = [];
    if (tools?.luban?.enabled) {
        const result = await runLuban({ projectDir, setting: tools.luban, store: options.store, installHint: options.installHint });
        if (!result.ok) problems.push(`Luban: ${result.errors.join('\n')}`);
    }
    if (tools?.protobuf?.enabled) {
        const result = await runProtobuf({ projectDir, setting: tools.protobuf, store: options.store, installHint: options.installHint });
        if (!result.ok) problems.push(`Protobuf: ${result.errors.join('\n')}`);
    }
    return problems.length ? problems.join('\n') : null;
}

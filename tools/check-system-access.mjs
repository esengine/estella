// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-system-access.mjs — the escape hatch says what it reaches for.
 *
 * A system's parameters are also its declaration of what it touches, and the
 * schedule reads them to answer two questions: whether the order of two systems
 * was ever decided by anyone, and whether they could ever run at the same time.
 * `GetWorld()` answers neither — a system holding the World may touch anything,
 * so it conflicts with everything and takes those questions off the table.
 *
 * That is a fair price for an escape hatch and a bad default for a subsystem. A
 * system that uses it either declares `touches` (the claim it makes about what
 * it reaches for) or is listed here with the reason it cannot yet.
 *
 *   node tools/check-system-access.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'sdk', 'src');

/** A system whose reach genuinely cannot be named says so above itself:
 *  `// system-access: <why>` on one of the lines before `defineSystem(`. */
const OPT_OUT = /system-access:\s*\S/;

function walk(dir, out = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules') continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) walk(abs, out);
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.generated.ts')) out.push(abs);
    }
    return out;
}

/** The text of each `defineSystem(...)` call in `src`, parentheses balanced. */
function defineSystemCalls(src) {
    const calls = [];
    const re = /\bdefineSystem\s*\(/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        let depth = 0;
        let i = m.index + m[0].length - 1;
        for (; i < src.length; i++) {
            const c = src[i];
            if (c === '(') depth++;
            else if (c === ')') {
                depth--;
                if (depth === 0) break;
            }
        }
        calls.push({ text: src.slice(m.index, i + 1), index: m.index });
    }
    return calls;
}

const nameOf = (call) => /\bname:\s*['"]([^'"]+)['"]/.exec(call)?.[1] ?? null;
const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** Whether the three lines above the call carry the opt-out and its reason. */
function optedOut(lines, callLine) {
    return lines.slice(Math.max(0, callLine - 4), callLine - 1).some((l) => OPT_OUT.test(l));
}

const findings = [];
let declared = 0;
let excused = 0;

for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('GetWorld()')) continue;
    const lines = src.split('\n');
    for (const { text, index } of defineSystemCalls(src)) {
        if (!text.includes('GetWorld()')) continue;
        const line = lineOf(src, index);
        if (/\btouches\s*:/.test(text)) { declared++; continue; }
        if (optedOut(lines, line)) { excused++; continue; }
        findings.push({
            where: `${path.relative(ROOT, file)}:${line}`,
            name: nameOf(text) ?? '(unnamed)',
        });
    }
}

if (findings.length === 0) {
    console.log(`check-system-access: ${declared} declared, ${excused} opted out — no system holds the World without saying so.`);
    process.exit(0);
}
for (const f of findings) {
    console.error(`${f.where}  ${f.name} takes GetWorld() without saying what it reaches for.`);
}
console.error('\nDeclare it with `touches`, or write `// system-access: <why>` above the call.');
process.exit(1);

#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-reload-identity.mjs — what a project DECLARES is addressed by name.
 *
 * A hot reload re-EVALUATES the project bundle, so every `define*` at its module
 * level runs a second time. Whatever those calls mint is an address into a World
 * that is still alive, so the second evaluation has to land on the first one's
 * storage — which it can only do if the address is derived from the declared
 * NAME rather than minted fresh.
 *
 * Components were interned that way from the start. Resources and events were
 * not, and issue #60 is what that looks like from the outside: one edit to a
 * script while the game was running, and every system in the project began
 * reading `null` from every resource, every frame — because a resource read that
 * MISSES does not throw, it materialises the default. Nothing failed; the game
 * just stopped being the game.
 *
 * So the rule guarded here is not "resources are interned" — it is that every
 * public `define*` door has an ANSWER about the second evaluation:
 *
 *   1. Every `define*` on the governed public surface appears below. A new door
 *      is a new address a project can mint, and it does not get to be silent.
 *   2. A door dispositioned `interned` routes its `_id` through a name-keyed
 *      `Map<string, symbol>` — read from its source, not from this table.
 *   3. A door dispositioned `fresh` does the opposite, and owes the reason why
 *      re-evaluating it is supposed to produce a new thing.
 *   4. A door dispositioned `delegates` mints nothing of its own; it must call
 *      one of the interned doors, or it is minting an address unexamined.
 *
 * The behaviour itself is held by sdk/tests/hot-reload-resource-identity.test.ts,
 * which re-declares each door and reads the live value back. This gate is the
 * half a test cannot do: notice a door that does not exist yet.
 *
 * Run: node tools/check-reload-identity.mjs   (exit 1 on violation)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'sdk', 'src');
const ETC = path.join(ROOT, 'sdk', 'etc');

/**
 * What each public declaration door does about a second evaluation.
 *
 * `interned` — the id comes from the name, so the re-imported declaration is the
 * same declaration. `fresh` — a new one every call, and `why` says what makes
 * that right. `delegates` — no id of its own; `via` is the door it mints through.
 */
const DISPOSITIONS = {
    defineComponent: { kind: 'interned' },
    defineTag: { kind: 'interned' },
    defineResource: { kind: 'interned' },
    defineEvent: { kind: 'interned' },
    defineSystem: {
        kind: 'fresh',
        why: 'a system IS the code being replaced — App.hotSwapSystems swaps the bodies '
            + 'wholesale, so a stable id would only let a stale body be mistaken for a live one',
    },
    defineSystemSet: { kind: 'no-id', why: 'a set is addressed by its _name; it mints no symbol' },
    defineInputMap: { kind: 'no-id', why: 'a plain action table — nothing addresses a World through it' },
    defineBehavior: { kind: 'delegates', via: 'defineComponent' },
};

const problems = [];

// ---------------------------------------------------------------------------
// 1. The doors, from the governed surface rather than from a list here.
// ---------------------------------------------------------------------------
const publicDoors = new Set();
for (const file of readdirSync(ETC).filter((f) => f.endsWith('.api.md'))) {
    const text = readFileSync(path.join(ETC, file), 'utf8');
    for (const m of text.matchAll(/^## (define[A-Za-z0-9_]*) — function/gm)) publicDoors.add(m[1]);
}
if (publicDoors.size === 0) {
    console.error('check-reload-identity: read no define* doors out of sdk/etc/*.api.md — '
        + 'the snapshot moved or changed shape, and this gate was passing on an empty world.');
    process.exit(1);
}
for (const door of publicDoors) {
    if (!DISPOSITIONS[door]) {
        problems.push(`${door} is public and has no disposition. A project can declare one at module `
            + 'level, so a hot reload re-runs it: say whether its address is derived from the name '
            + '(interned), deliberately new each time (fresh, with why), or not an address at all.');
    }
}
for (const door of Object.keys(DISPOSITIONS)) {
    if (!publicDoors.has(door)) {
        problems.push(`${door} has a disposition here but is no longer on the public surface — `
            + 'drop the entry rather than leave this gate guarding something that left.');
    }
}

// ---------------------------------------------------------------------------
// 2-4. …held against what the source actually does.
// ---------------------------------------------------------------------------
const files = [];
(function walk(dir) {
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.ts')) files.push(full);
    }
})(SRC);

/**
 * The block a function signature starting at `at` opens.
 *
 * Not "the next `{`": a return type can carry one (`ComponentDef<{}>`), and
 * taking that as the body read defineTag as a function that does nothing — a
 * gate reporting a clean door because it never saw the door.
 */
function braced(text, at) {
    let i = text.indexOf('(', at);
    if (i < 0) return null;
    for (let depth = 0; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')' && --depth === 0) { i++; break; }
    }
    let angle = 0;
    for (; i < text.length; i++) {
        if (text[i] === '<') angle++;
        else if (text[i] === '>') angle--;
        else if (text[i] === '{' && angle === 0) break;
    }
    const open = i;
    if (open >= text.length) return null;
    let depth = 0;
    for (let j = open; j < text.length; j++) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}' && --depth === 0) return text.slice(open, j + 1);
    }
    return null;
}

/** The body of a function declared in `source`, exported or not. */
function functionBody(source, name) {
    const at = source.search(new RegExp(`^(export )?function ${name}\\b`, 'm'));
    return at < 0 ? null : braced(source, at);
}

/** The body of `export function <name>`, and the file it lives in. */
function bodyOf(name) {
    for (const file of files) {
        const whole = readFileSync(file, 'utf8');
        const at = whole.search(new RegExp(`^export function ${name}\\b`, 'm'));
        if (at < 0) continue;
        const text = braced(whole, at);
        if (text) return { text, file, whole };
    }
    return null;
}

const idsIn = (body) => [...body.matchAll(/_id:\s*([^,\n]+)/g)].map((m) => m[1].trim());

/**
 * Every `_id` expression this door can mint. A door usually hands the work to a
 * local factory (`createComponentDef`), so following one hop is what makes the
 * question "what address does `defineComponent` mint" answerable at all.
 */
function mintSites(found) {
    const direct = idsIn(found.text);
    if (direct.length > 0) return direct;
    const out = [];
    for (const call of new Set([...found.text.matchAll(/\b([a-z][A-Za-z0-9_]*)\s*\(/g)].map((m) => m[1]))) {
        const body = functionBody(found.whole, call);
        if (body) out.push(...idsIn(body));
    }
    return out;
}

/** Does `fn`, declared in `source`, hand back a symbol it keeps in a name-keyed map? */
function isNameInterner(fn, source) {
    const at = source.search(new RegExp(`function ${fn}\\s*\\(`, 'm'));
    if (at < 0) return false;
    const open = source.indexOf('{', at);
    let depth = 0;
    let body = '';
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) { body = source.slice(open, i + 1); break; }
    }
    const registry = body.match(/([A-Za-z0-9_]+)\.get\(name\)/)?.[1];
    if (!registry) return false;
    return body.includes(`${registry}.set(name,`)
        && new RegExp(`(const|let) ${registry}\\s*(:[^=]*)?=\\s*new Map<string, symbol>`).test(source);
}

for (const [door, disposition] of Object.entries(DISPOSITIONS)) {
    if (!publicDoors.has(door)) continue;
    const found = bodyOf(door);
    if (!found) {
        problems.push(`${door} is dispositioned here but no 'export function ${door}' was found under sdk/src.`);
        continue;
    }
    const assignments = mintSites(found);

    if (disposition.kind === 'no-id' || disposition.kind === 'delegates') {
        if (assignments.length > 0) {
            problems.push(`${door} is dispositioned '${disposition.kind}' but assigns _id: ${assignments.join(' / ')}. `
                + 'It mints an address of its own — say how that address survives a re-import.');
        }
        if (disposition.kind === 'delegates' && !new RegExp(`\\b${disposition.via}\\b`).test(found.text)) {
            problems.push(`${door} is dispositioned 'delegates' via ${disposition.via}, which it does not call.`);
        }
        continue;
    }

    if (assignments.length === 0) {
        problems.push(`${door} is dispositioned '${disposition.kind}' but assigns no _id at all — `
            + "either it delegates (say so) or this gate is reading the wrong function.");
        continue;
    }
    // A ternary is two answers; both halves are an address somebody can hold.
    const branches = assignments.flatMap((a) => a.split(/[?:]/).map((b) => b.trim()).filter(Boolean));
    for (const branch of branches) {
        const bare = /^Symbol\s*\(/.test(branch);
        const helper = branch.match(/^([A-Za-z0-9_]+)\s*\(/)?.[1];
        const interned = !bare && helper !== undefined && isNameInterner(helper, found.whole);
        // A `fresh` door may mint anonymously; an `interned` one may too, but only
        // where there is no name to intern by (an unnamed resource has no address).
        if (disposition.kind === 'interned' && !interned && !/name === undefined/.test(assignments.join(' '))) {
            problems.push(`${door} is dispositioned 'interned' but its _id comes from \`${branch}\`, which is not a `
                + 'name-keyed symbol registry. A re-imported bundle would address storage nothing ever filled, '
                + 'and a miss materialises the DEFAULT rather than failing.');
        }
        if (disposition.kind === 'fresh' && interned) {
            problems.push(`${door} is dispositioned 'fresh' (${disposition.why}) but its _id is interned by name.`);
        }
    }
}

if (problems.length > 0) {
    console.error('check-reload-identity: what a project declares must survive a re-import.\n');
    for (const p of problems) console.error(`  - ${p}`);
    console.error(`\n${problems.length} problem(s).`);
    process.exit(1);
}
console.log(`check-reload-identity: ${publicDoors.size} public declaration door(s), each with an answer about a second evaluation.`);

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-aot-duties — every road performs each duty, or refuses the
 *        systems that need it. There is no third answer.
 *
 * Holds `tools/lib/aotDuties.mjs` against what the two dispatchers actually
 * call, so the ledger cannot claim a duty the code stopped doing and a call it
 * has never heard of is a finding.
 *
 * The excuse is checked too: a duty a road skips must name a capability
 * `executorCapabilities.ts` really turns OFF, or the systems it was supposed to
 * keep away are being taken.
 *
 *   node tools/check-aot-duties.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DUTIES, BOOKKEEPING, ROADS, CAPABILITIES_AT } from './lib/aotDuties.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const findings = [];

/**
 * Every effectful call a class body makes, as `receiver.method`.
 *
 * `this.thing_(...)` is an own helper, and its body is in this same slice so
 * whatever IT calls is already counted. Anything else that looks like one is
 * REPORTED: the convention is what makes this scan complete.
 */
function callsIn(rel, className) {
    const src = read(rel);
    const at = src.indexOf(`class ${className}`);
    if (at < 0) return null;
    const body = src.slice(at);
    const out = new Set();
    for (const m of body.matchAll(/\bthis\.([A-Za-z_][\w]*)((?:\.[A-Za-z_][\w]*)*)\s*\(/g)) {
        if (m[2] === '') {
            if (!m[1].endsWith('_')) {
                findings.push(`${rel}: this.${m[1]}() is neither a field call nor a `
                    + 'trailing-underscore helper — this scan cannot classify it.');
            }
            continue;
        }
        out.add(m[1] + m[2]);
    }
    // The twin is handed in rather than held, and calling it is the duty this
    // whole file is about.
    for (const m of body.matchAll(/\btwin\.([A-Za-z_][\w]*)\s*\(/g)) out.add(`twin.${m[1]}`);
    return out;
}

/** The capability set a road declares, read out of the model it is declared in. */
function capabilitiesOf(name) {
    const src = read(CAPABILITIES_AT);
    const block = new RegExp(`export const ${name}[^=]*=\\s*\\{([^}]*)\\}`).exec(src);
    if (block === null) return null;
    const out = {};
    for (const m of block[1].matchAll(/([A-Za-z_][\w]*)\s*:\s*(true|false)/g)) out[m[1]] = m[2] === 'true';
    return out;
}

const made = new Map();
for (const road of ROADS) {
    const calls = callsIn(road.path, road.className);
    if (calls === null) {
        findings.push(`${road.path} no longer declares class ${road.className} — this gate reads it.`);
        continue;
    }
    made.set(road.id, calls);
}

const claimed = new Set(Object.keys(BOOKKEEPING));
for (const duty of DUTIES) {
    for (const road of ROADS) {
        const performs = duty[road.id];
        const calls = made.get(road.id);
        if (calls === undefined) continue;

        if (performs === null || performs === undefined) {
            // The whole point: not performing is only allowed with a reason the
            // model actually enforces.
            if (!duty.excusedBy) {
                findings.push(`${duty.id}: the ${road.id} road does not perform it and names no `
                    + 'capability that keeps such a system off this road.');
                continue;
            }
            const caps = capabilitiesOf(road.capabilities);
            if (caps === null) {
                findings.push(`${CAPABILITIES_AT} no longer declares ${road.capabilities} as a `
                    + 'literal this gate can read.');
            } else if (caps[duty.excusedBy] === undefined) {
                findings.push(`${duty.id}: excused by '${duty.excusedBy}', which ${road.capabilities} `
                    + 'does not declare.');
            } else if (caps[duty.excusedBy] !== false) {
                findings.push(`${duty.id}: excused by '${duty.excusedBy}', but ${road.capabilities} has `
                    + 'it ON — the systems this duty serves are being taken by a road that skips it.');
            }
            continue;
        }

        for (const call of performs) {
            claimed.add(call);
            if (!calls.has(call)) {
                findings.push(`${duty.id}: the ${road.id} road is said to perform it with `
                    + `\`${call}\`, which ${road.className} no longer calls.`);
            }
        }
    }
}

/**
 * The other half: is what a road performs held against the INTERPRETER anywhere?
 *
 * `resource-write-back` was implemented on both roads and accounted for here
 * while no source form existed that both lowered the same way. An expectation
 * test agrees with whatever the road happens to do; only a differential does not.
 */
for (const duty of DUTIES) {
    for (const road of ROADS) {
        // A road that REFUSES the duty owes nothing: the systems that would need
        // it never reach this road at all.
        if (duty[road.id] === null || duty[road.id] === undefined) continue;
        const held = duty.differential?.[road.id] ?? [];
        const owed = duty.owed?.[road.id];
        if (held.length === 0) {
            if (!owed) {
                findings.push(`${duty.id}: the ${road.id} road performs it and no differential holds `
                    + 'it against the interpreter, with no `owed` saying so. A duty checked only for '
                    + 'presence is a duty nothing verifies.');
            }
            continue;
        }
        if (owed) {
            findings.push(`${duty.id}: \`owed.${road.id}\` says nothing holds it, and ${held.length} `
                + 'differential(s) are named. One of the two has stopped being true.');
        }
        for (const at of held) {
            let src = null;
            try { src = read(at.path); } catch { src = null; }
            if (src === null) {
                findings.push(`${duty.id}: ${at.path} is gone, and it is named as holding it.`);
            } else if (!at.probe.test(src)) {
                findings.push(`${duty.id}: ${at.path} no longer matches ${at.probe} — the `
                    + 'differential this list points at has moved or been dropped.');
            }
        }
    }
}

// A call nothing accounts for. This is the direction all three known bugs came
// from — one road grew a step and the other did not.
for (const road of ROADS) {
    for (const call of made.get(road.id) ?? []) {
        if (!claimed.has(call)) {
            findings.push(`${road.className} calls \`${call}\`, and no duty names it — either it is a `
                + 'duty this list owes an entry, or bookkeeping that has to say so.');
        }
    }
}

// An excuse nobody uses stops being true.
const everyCall = new Set([...made.values()].flatMap((s) => [...s]));
for (const [call, why] of Object.entries(BOOKKEEPING)) {
    if (!everyCall.has(call)) {
        findings.push(`BOOKKEEPING names \`${call}\` (${why}), which no road makes any more.`);
    }
}

// And a capability that gates nothing is a capability that means nothing: it
// would read as a promise while refusing systems for no duty at all.
for (const road of ROADS) {
    const caps = capabilitiesOf(road.capabilities) ?? {};
    for (const [name, on] of Object.entries(caps)) {
        if (on) continue;
        if (!DUTIES.some((d) => d.excusedBy === name)) {
            findings.push(`${road.capabilities}.${name} is off, and no duty is excused by it — it `
                + 'refuses systems for a step nothing says this road skips.');
        }
    }
}

if (findings.length > 0) {
    console.error(`check-aot-duties: ${findings.length} finding(s).`);
    for (const f of findings) console.error(`  ${f}`);
    process.exit(1);
}
const skipped = DUTIES.filter((d) => ROADS.some((r) => d[r.id] === null)).length;
// Counted per ROAD, because a duty held on one road and owed on the other is
// exactly the state a single number would round away.
const pairs = DUTIES.flatMap((d) => ROADS
    .filter((r) => d[r.id] !== null && d[r.id] !== undefined)
    .map((r) => ({ id: d.id, road: r.id, owed: d.owed?.[r.id] })));
const owed = pairs.filter((p) => p.owed);
console.log(`check-aot-duties: ${DUTIES.length} duties across ${ROADS.length} roads — `
    + `${DUTIES.length - skipped} performed by both, ${skipped} refused by capability, `
    + `${everyCall.size} call(s) accounted for.`);
console.log(`  ${pairs.length - owed.length} of ${pairs.length} duty/road pairs held against the `
    + `interpreter by a differential; ${owed.length} owed one:`);
for (const p of owed) console.log(`    ${p.id} (${p.road}): ${p.owed}`);

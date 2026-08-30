// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spineSceneDiagnostics.ts
 * @brief   Why this scene's spine costs what it does, answered from what the
 *          frame already knew.
 *
 * @details Everything here is DERIVED. No counter is added, no clock is read,
 *          and nothing is remembered between calls: a report is the frame
 *          metrics and the residency facts, read at the moment somebody asks.
 *          A diagnostic that kept its own tally would be a second authority
 *          about the same frame, and the first thing to go wrong with one is
 *          that it disagrees with the thing it is explaining.
 *
 *          What makes it worth having is the join. The runtime knows what a
 *          frame paid; the residencies know who was ALLOWED to skip and which
 *          of the two proofs they were missing. Neither answers "why is this
 *          scene expensive" alone — 800 unresolved world poses is a number, and
 *          "150 entities across two assets resolve every frame because nothing
 *          certified their extent" is somewhere to go.
 *
 *          The split between the two blockers is the editorial part, and it is
 *          deliberate: an asset that also carries state across its world pose is
 *          NOT reported as wanting a certificate, because certifying it would
 *          change nothing. Only the assets a promise would actually unlock are
 *          offered as work.
 */
import type { SpineVersion } from '../sideModules/registry';
import type { SpineCullingEnvelope } from './spineBounds';
import type { SpineFrameMetrics } from './spineMetrics';

/**
 * One residency as a diagnostic reads it: the two proofs AND what they came to.
 * Kept as three fields rather than the verdict alone, because "this asset is not
 * deferring" is not something anyone can act on and "nothing certified its
 * extent" is.
 */
export interface SpineResidencyFacts {
    era: string;
    /** Its refcount — entities posed by it, disabled ones included. */
    entities: number;
    culling: SpineCullingEnvelope;
    requiresContinuousWorldPose: boolean;
    mayDefer: boolean;
}

/**
 * The slice of a runtime a report reads, declared HERE rather than taken as a
 * runtime — everything the diagnostic needs is a read, and a view that cannot
 * reach `loadEntity` cannot become a second answer to which runtime poses an
 * entity. That answer is the manager's alone (tools/check-spine-lifetimes).
 */
export interface SpineDiagnosticRuntime {
    readonly version: SpineVersion;
    readonly entityCount: number;
    worldPoseDebt(): number;
    residencies(): SpineResidencyFacts[];
    metrics(): SpineFrameMetrics | null;
}

/** A proof a residency is missing. Both absent is possible; neither is `mayDefer`. */
export type SpineDeferralBlocker = 'no-certificate' | 'stateful-constraints';

/** One loaded skeleton, and whether the entities on it may owe a world pose. */
export interface SpineAssetDiagnostic {
    version: SpineVersion;
    /** The era — one generation of one skeleton+atlas pair. */
    era: string;
    /** Entities posed by it, disabled ones included: it is the residency's refcount. */
    entities: number;
    mayDefer: boolean;
    /** What the culling promise amounts to, not the rectangle itself. */
    envelope: SpineCullingEnvelope['kind'];
    /** Empty exactly when `mayDefer`. */
    blockedBy: readonly SpineDeferralBlocker[];
}

/** A frame's posing, summed over every loaded runtime. */
export interface SpinePoseTotals {
    logicalUpdates: number;
    worldMaterializations: number;
    worldAlreadyCurrent: number;
    /** Per (entity, CAMERA): a scene drawn by two cameras extracts twice. */
    meshExtractions: number;
    /** Per (entity, CAMERA) too — camera declines, not entities culled. */
    renderCulled: number;
}

export type SpineFindingCode =
    /** Nothing is counting, so every per-frame number below is zero. */
    | 'not-observing'
    /** Assets a culling contract would unlock. The one actionable finding. */
    | 'no-certificate'
    /** Assets no contract can unlock: their world pose carries state. */
    | 'stateful-constraints'
    /** Deferral is permitted and bought nothing this frame — everything was wanted. */
    | 'nothing-deferred'
    /** Deferral is permitted and is paying. */
    | 'deferral-working';

/** A statement about the scene, with the numbers that justify it. Wording lives
 *  in {@link formatSpineDiagnostics}, so a panel can say it its own way. */
export interface SpineFinding {
    code: SpineFindingCode;
    /** Entities the finding is about. */
    entities: number;
    /** The eras it is about, where it is about assets at all. */
    assets: readonly string[];
}

export interface SpineSceneDiagnostics {
    /** False when no runtime is counting; the per-frame numbers are then zero. */
    observing: boolean;
    /** The newest frame any runtime has begun. */
    frame: number;
    entities: number;
    /**
     * Enabled entities owing a world pose. Read after the frame's submit — where
     * a diagnostic is read — this is exactly what the frame did not resolve.
     */
    worldPoseDebt: number;
    /** Entities whose residency permits owing one at all. */
    deferrable: number;
    assets: SpineAssetDiagnostic[];
    pose: SpinePoseTotals;
    /** Milliseconds, summed across runtimes; `readback` covers every camera. */
    time: { pose: number; readback: number; total: number };
    findings: SpineFinding[];
}

function blockersOf(facts: SpineResidencyFacts): SpineDeferralBlocker[] {
    const blockers: SpineDeferralBlocker[] = [];
    if (facts.requiresContinuousWorldPose) blockers.push('stateful-constraints');
    if (facts.culling.kind !== 'certified') blockers.push('no-certificate');
    return blockers;
}

/**
 * Read every loaded runtime and say what the scene's spine is doing.
 *
 * `observing` is the manager's, not inferred from whether metrics objects
 * exist: a realm watching a scene that has loaded no runtime yet is observing,
 * and reporting otherwise would send someone to turn on what is already on.
 */
export function spineSceneDiagnostics(
    runtimes: Iterable<SpineDiagnosticRuntime>, observing: boolean,
): SpineSceneDiagnostics {
    const assets: SpineAssetDiagnostic[] = [];
    const pose: SpinePoseTotals = {
        logicalUpdates: 0, worldMaterializations: 0, worldAlreadyCurrent: 0,
        meshExtractions: 0, renderCulled: 0,
    };
    const time = { pose: 0, readback: 0, total: 0 };
    let frame = 0;
    let entities = 0;
    let worldPoseDebt = 0;
    let deferrable = 0;

    for (const runtime of runtimes) {
        entities += runtime.entityCount;
        worldPoseDebt += runtime.worldPoseDebt();
        for (const facts of runtime.residencies()) {
            if (facts.mayDefer) deferrable += facts.entities;
            assets.push({
                version: runtime.version, era: facts.era, entities: facts.entities,
                mayDefer: facts.mayDefer, envelope: facts.culling.kind,
                blockedBy: blockersOf(facts),
            });
        }
        const m = runtime.metrics();
        if (!m) continue;
        frame = Math.max(frame, m.frame);
        pose.logicalUpdates += m.pose.logicalUpdates;
        pose.worldMaterializations += m.pose.worldMaterializations;
        pose.worldAlreadyCurrent += m.pose.worldAlreadyCurrent;
        pose.meshExtractions += m.pose.meshExtractions;
        pose.renderCulled += m.pose.renderCulled;
        time.pose += m.time.pose;
        time.readback += m.time.readback;
        time.total += m.time.total;
    }

    assets.sort((a, b) => b.entities - a.entities || (a.era < b.era ? -1 : a.era > b.era ? 1 : 0));
    return {
        observing, frame, entities, worldPoseDebt, deferrable, assets, pose, time,
        findings: findingsOf(observing, entities, worldPoseDebt, deferrable, assets),
    };
}

/** Ordered actionable-first: what to go do, before what merely explains. */
const FINDING_ORDER: readonly SpineFindingCode[] = [
    'not-observing', 'no-certificate', 'stateful-constraints',
    'nothing-deferred', 'deferral-working',
];

function findingsOf(
    observing: boolean, entities: number, worldPoseDebt: number, deferrable: number,
    assets: readonly SpineAssetDiagnostic[],
): SpineFinding[] {
    const found: SpineFinding[] = [];
    if (!observing) found.push({ code: 'not-observing', entities, assets: [] });

    // Only the assets a promise would actually unlock. One that also carries
    // state across its world pose stays out of this: certifying it changes
    // nothing, and offering it as work is offering a dead end.
    const uncertified = assets.filter(a =>
        a.blockedBy.includes('no-certificate') && !a.blockedBy.includes('stateful-constraints'));
    if (uncertified.length > 0) {
        found.push({
            code: 'no-certificate',
            entities: uncertified.reduce((n, a) => n + a.entities, 0),
            assets: uncertified.map(a => a.era),
        });
    }

    const stateful = assets.filter(a => a.blockedBy.includes('stateful-constraints'));
    if (stateful.length > 0) {
        found.push({
            code: 'stateful-constraints',
            entities: stateful.reduce((n, a) => n + a.entities, 0),
            assets: stateful.map(a => a.era),
        });
    }

    if (observing && deferrable > 0) {
        found.push(worldPoseDebt > 0
            ? { code: 'deferral-working', entities: worldPoseDebt, assets: [] }
            : { code: 'nothing-deferred', entities: deferrable, assets: [] });
    }
    return found.sort((a, b) => FINDING_ORDER.indexOf(a.code) - FINDING_ORDER.indexOf(b.code));
}

function ms(value: number): string {
    return `${value.toFixed(2)}ms`;
}

function count(n: number, one: string, many = `${one}s`): string {
    return `${n} ${n === 1 ? one : many}`;
}

function entities(n: number): string {
    return count(n, 'entity', 'entities');
}

function sentence(finding: SpineFinding): string {
    const across = finding.assets.length > 0
        ? ` across ${count(finding.assets.length, 'asset')} (${finding.assets.join(', ')})`
        : '';
    switch (finding.code) {
        case 'not-observing':
            return 'nothing is counting — call observe(true) and read this again after a frame.';
        case 'no-certificate':
            return `${entities(finding.entities)}`
                 + `${across} resolve a world pose every frame because nothing certified their`
                 + ' extent. Scan the asset and record a culling contract to let them skip it'
                 + ' while no camera wants them.';
        case 'stateful-constraints':
            return `${entities(finding.entities)}`
                 + `${across} can never defer: their world pose carries state across frames,`
                 + ' which no culling contract changes.';
        case 'nothing-deferred':
            return `${entities(finding.entities)} may defer`
                 + ' and none did — every one of them was wanted this frame, so this cost is work'
                 + ' being consumed rather than opportunity being missed.';
        case 'deferral-working':
            return `${count(finding.entities, 'world pose')} went unresolved — work this frame`
                 + ' did not do.';
    }
}

/** Wrapped to a terminal, since a finding is a sentence and not a field. */
function wrapped(prefix: string, text: string, width = 78): string[] {
    const indent = ' '.repeat(prefix.length);
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
        if (line === '') {
            line = (lines.length === 0 ? prefix : indent) + word;
        } else if (line.length + 1 + word.length > width) {
            lines.push(line);
            line = indent + word;
        } else {
            line += ` ${word}`;
        }
    }
    if (line !== '') lines.push(line);
    return lines;
}

/** The report as text, for a console or an overlay. */
export function formatSpineDiagnostics(d: SpineSceneDiagnostics): string {
    const lines: string[] = [
        `spine — frame ${d.frame}, ${entities(d.entities)} across ${count(d.assets.length, 'asset')}`,
        `  time     pose ${ms(d.time.pose)}   readback ${ms(d.time.readback)}`
        + `   total ${ms(d.time.total)}`,
        `  world    ${d.pose.worldMaterializations} resolved, ${d.worldPoseDebt} unresolved,`
        + ` ${d.pose.worldAlreadyCurrent} already current`,
        `  logical  ${d.pose.logicalUpdates} advances`,
        `  draw     ${d.pose.meshExtractions} extracted, ${d.pose.renderCulled} camera declines`,
        '',
    ];
    for (const asset of d.assets) {
        const why = asset.mayDefer ? 'may defer' : `always resolves — ${asset.blockedBy.join(', ')}`;
        lines.push(`  ${asset.era.padEnd(28)} ${String(asset.entities).padStart(6)}`
                 + `  ${asset.version.padEnd(4)} ${why}`);
    }
    if (d.findings.length > 0) lines.push('');
    for (const finding of d.findings) lines.push(...wrapped('  * ', sentence(finding)));
    return lines.join('\n');
}

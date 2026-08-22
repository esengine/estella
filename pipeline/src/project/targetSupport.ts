// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a build target can render — and what it cannot.
 *
 * The editor authors every subsystem the engine has; a target does not necessarily
 * compile all of them, and this is where that is declared.
 *
 * The native app has no gap left: the flags `native/CMakeLists.txt` sets bring in the
 * whole engine source list, and the three optional runtimes that ship as emscripten
 * side modules on the web (Box2D, the Spine runtime, the video decoder) are compiled
 * into the host binary instead — a device has no dynamic-linking story to have. The
 * table stays because that can change: turn a flag off, or add a subsystem that only
 * one platform can host, and the entry belongs here so the export can name it rather
 * than writing a package that is quietly missing half a scene.
 *
 * Without this, an export writes a package that is quietly missing half a
 * scene. This is the one declaration of that gap, so the export can name it
 * instead. `pipeline/tests/target-support.test.ts` reads the native CMakeLists
 * and fails when the two drift: flipping a flag there is what deletes an entry
 * here.
 *
 * Deliberately free of node imports — the electron export and the renderer's
 * build dialog both read it.
 */
import { NATIVE_PLATFORMS, type ExportPlatform } from './platforms';

/** An engine subsystem a build target may lack. */
export type Subsystem = 'text' | 'tilemap' | 'particles' | 'postprocess' | 'physics' | 'spine' | 'video';

/**
 * The authored vocabulary that puts a subsystem in use: a scene or prefab
 * carrying one of these components needs it at runtime. Scanning the serialized
 * content is what makes the warning specific — a project that never authors a
 * tilemap hears nothing about tilemaps.
 */
export const SUBSYSTEM_COMPONENTS: Readonly<Record<Subsystem, readonly string[]>> = {
    text: ['Text', 'BitmapText'],
    tilemap: ['Tilemap', 'TilemapLayer'],
    particles: ['ParticleEmitter', 'ParticleForceField'],
    postprocess: ['PostProcessVolume'],
    physics: [
        'RigidBody', 'BoxCollider', 'CircleCollider', 'CapsuleCollider', 'SegmentCollider',
        'PolygonCollider', 'ChainCollider', 'OneWayPlatform', 'CharacterController',
        'RevoluteJoint', 'DistanceJoint', 'PrismaticJoint', 'WeldJoint', 'WheelJoint', 'MotorJoint',
    ],
    spine: ['SpineAnimation'],
    video: ['Video'],
};

/** Human name, for a message someone packaging a game has to act on. */
export const SUBSYSTEM_LABEL: Readonly<Record<Subsystem, string>> = {
    text: 'Text',
    tilemap: 'Tilemaps',
    particles: 'Particles',
    postprocess: 'Post-processing',
    physics: 'Physics (Box2D)',
    spine: 'Spine animation',
    video: 'Video',
};

/**
 * The cmake option whose absence drops a subsystem from a build of the engine
 * core (see `cmake/ESEngineSources.cmake`). The others ship as separate modules
 * and have no flag, so they are absent here.
 */
export const SUBSYSTEM_CMAKE_FLAG: Readonly<Partial<Record<Subsystem, string>>> = {
    text: 'ES_ENABLE_BITMAP_TEXT',
    tilemap: 'ES_ENABLE_TILEMAP',
    particles: 'ES_ENABLE_PARTICLES',
    postprocess: 'ES_ENABLE_POSTPROCESS',
};

/** A subsystem a target cannot run, and why. */
export interface SubsystemGap {
    subsystem: Subsystem;
    why: string;
}

/** What the native app cannot render — currently nothing. ONE list: iOS and Android
 *  compile the same `native/CMakeLists.txt`, so a flag flipped there opens or closes
 *  the gap on both. `pipeline/tests/target-support.test.ts` reads that file and fails
 *  when the two disagree. */
const NATIVE_GAPS: readonly SubsystemGap[] = [];

/**
 * Per-target gaps. A platform absent from this table has none *known*: only the
 * native targets' feature set has been audited against the engine's, since they
 * are the ones that compile a subset.
 */
const GAPS: Partial<Record<ExportPlatform, readonly SubsystemGap[]>> = Object.fromEntries(
    NATIVE_PLATFORMS.map((platform) => [platform, NATIVE_GAPS]),
);

/** What `platform` cannot render, whether or not this project uses it. */
export function targetGaps(platform: ExportPlatform): readonly SubsystemGap[] {
    return GAPS[platform] ?? [];
}

const COMPONENT_SUBSYSTEM: ReadonlyMap<string, Subsystem> = new Map(
    (Object.entries(SUBSYSTEM_COMPONENTS) as [Subsystem, readonly string[]][])
        .flatMap(([subsystem, names]) => names.map((name) => [name, subsystem] as const)),
);

/**
 * Collect the subsystems a scene / prefab document puts in use. Pure, and shape-
 * agnostic: it walks for the serialized `type` vocabulary, so nested entities,
 * prefab bodies and overrides are all seen without knowing the document layout.
 */
export function collectSubsystems(doc: unknown, into: Set<Subsystem> = new Set()): Set<Subsystem> {
    if (Array.isArray(doc)) {
        for (const item of doc) collectSubsystems(item, into);
        return into;
    }
    if (doc === null || typeof doc !== 'object') return into;
    const rec = doc as Record<string, unknown>;
    if (typeof rec.type === 'string') {
        const subsystem = COMPONENT_SUBSYSTEM.get(rec.type);
        if (subsystem) into.add(subsystem);
    }
    for (const value of Object.values(rec)) collectSubsystems(value, into);
    return into;
}

/** How many source files a warning names before it summarizes the rest. */
const MAX_NAMED_FILES = 3;

/**
 * One warning per subsystem this target cannot render but the shipped content
 * uses, naming where it came from. `usage` maps a subsystem to the files that
 * authored it (project-relative).
 */
export function subsystemGapWarnings(
    platform: ExportPlatform,
    usage: ReadonlyMap<Subsystem, readonly string[]>,
    /** The gaps to report; defaults to this platform's declared ones. Overridable so
     *  the reporting can be exercised while no target actually has a gap. */
    gaps: readonly SubsystemGap[] = targetGaps(platform),
): string[] {
    const warnings: string[] = [];
    for (const gap of gaps) {
        const files = usage.get(gap.subsystem);
        if (!files || files.length === 0) continue;
        const named = [...files].sort();
        const shown = named.slice(0, MAX_NAMED_FILES).join(', ');
        const rest = named.length > MAX_NAMED_FILES ? ` (+${named.length - MAX_NAMED_FILES} more)` : '';
        warnings.push(
            `${platform}: ${SUBSYSTEM_LABEL[gap.subsystem]} will not render in this build — ${gap.why}. Used by ${shown}${rest}`,
        );
    }
    return warnings;
}

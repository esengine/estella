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
export type Subsystem =
    | 'text' | 'tilemap' | 'terrain' | 'foliage' | 'worldgen' | 'water' | 'spline' | 'characterShaders' | 'timeline' | 'fxBasic' | 'fxAtmosphere' | 'fxLighting' | 'particles' | 'postprocess' | 'physics' | 'physics3d'
    | 'spine' | 'dragonbones' | 'video' | 'ai' | 'logic' | 'replication' | 'gameplay';

/**
 * The authored vocabulary that puts a subsystem in use: a scene or prefab
 * carrying one of these components needs it at runtime. Scanning the serialized
 * content is what makes the warning specific — a project that never authors a
 * tilemap hears nothing about tilemaps.
 */
export const SUBSYSTEM_COMPONENTS: Readonly<Record<Subsystem, readonly string[]>> = {
    text: ['Text', 'BitmapText'],
    tilemap: ['Tilemap', 'TilemapLayer'],
    terrain: ['Terrain'],
    timeline: ['TimelinePlayer'],
    // Effects are named by the volume that carries them, not by a component: see {@link POST_PROCESS_EFFECT_GROUP}.
    fxBasic: [],
    fxAtmosphere: ['Weather', 'TimeOfDay'],
    fxLighting: [],
    foliage: ['Foliage', 'PlacedFoliage'],
    worldgen: ['WorldGen', 'WorldZone'],
    water: ['WaterBody', 'WaterZone', 'Floating'],
    spline: ['Spline'],
    // Hair, Skin and Eye are shaders, not components: a character's materials are what name them (see SHADER_SUBSYSTEM).
    characterShaders: [],
    particles: ['ParticleEmitter', 'ParticleForceField'],
    postprocess: ['PostProcessVolume'],
    physics: [
        'RigidBody2D', 'BoxCollider2D', 'CircleCollider2D', 'CapsuleCollider2D', 'SegmentCollider2D',
        'PolygonCollider2D', 'ChainCollider2D', 'OneWayPlatform2D', 'CharacterController2D',
        'HingeJoint2D', 'DistanceJoint2D', 'SliderJoint2D', 'FixedJoint2D', 'WheelJoint2D', 'MotorJoint2D',
    ],
    physics3d: [
        'RigidBody3D', 'BoxCollider3D', 'SphereCollider3D', 'CapsuleCollider3D',
        'MeshCollider3D', 'ConvexCollider3D', 'CharacterController3D',
        'HingeJoint3D', 'DistanceJoint3D', 'SliderJoint3D', 'FixedJoint3D', 'PointJoint3D', 'SwingTwistJoint3D', 'SixDOFJoint3D',
    ],
    spine: ['SpineAnimation'],
    dragonbones: ['DragonBonesAnimation'],
    logic: ['ScriptGraphAgent'],
    video: ['Video'],
    ai: [
        'NavAgent', 'NavArea', 'NavLink', 'NavObstacle', 'NavVolume',
        'Perceiver', 'Perception', 'StateMachineAgent', 'BehaviorTreeAgent',
    ],
    replication: ['Replicated', 'NetGhost'],
    gameplay: [
        'ThirdPersonController', 'ThirdPersonCamera', 'Health', 'MeleeAttack', 'Hunter', 'Playthrough',
    ],
};

/**
 * Which group carries the shaders of each built-in post-process effect. A `PostProcessVolume` names its effects by `type`, so this
 * is the evidence a scene gives; an effect a script adds by code is reached by importing the group's subpath.
 */
export const POST_PROCESS_EFFECT_GROUP: Readonly<Record<string, Subsystem>> = {
    blur: 'fxBasic', bloom: 'fxBasic', vignette: 'fxBasic', grayscale: 'fxBasic', colorGrade: 'fxBasic',
    chromaticAberration: 'fxBasic', tonemap: 'fxBasic', fxaa: 'fxBasic', lensDistortion: 'fxBasic', pixelate: 'fxBasic',
    outline: 'fxBasic', depthOutline: 'fxBasic', edgeOutline: 'fxBasic', lutGrade: 'fxBasic', palette: 'fxBasic', agx: 'fxBasic', sharpen: 'fxBasic', filmGrain: 'fxBasic',
    motionBlur: 'fxBasic', lensFlare: 'fxBasic',
    mist2d: 'fxAtmosphere', rain2d: 'fxAtmosphere', fog2d: 'fxAtmosphere', distanceFog: 'fxAtmosphere', skyAtmosphere: 'fxAtmosphere', heightFog: 'fxAtmosphere', rain: 'fxAtmosphere',
    voxelGI: 'fxLighting', ssgi: 'fxLighting', contactShadows: 'fxLighting', lightShafts: 'fxLighting',
    autoExposure: 'fxLighting', depthOfField: 'fxLighting', ssao: 'fxLighting', subsurface: 'fxLighting',
    gtao: 'fxLighting', ssr: 'fxLighting', taa: 'fxLighting',
    underwater: 'water',
};

/**
 * Which module carries each built-in shader that is not the core's. A material names its shader by `shader: 'builtin:<id>'`, so a project that authors one
 * uses the module that ships it — with no component in a scene to say so (a Water material on a plain mesh, a character's Hair).
 */
export const SHADER_SUBSYSTEM: Readonly<Record<string, Subsystem>> = {
    'builtin:water': 'water', 'builtin:terrain': 'terrain', 'builtin:foliage': 'foliage',
    'builtin:hair': 'characterShaders', 'builtin:skin': 'characterShaders', 'builtin:eye': 'characterShaders',
};

/** Human name, for a message someone packaging a game has to act on. */
export const SUBSYSTEM_LABEL: Readonly<Record<Subsystem, string>> = {
    text: 'Text',
    tilemap: 'Tilemaps',
    terrain: 'Terrain',
    timeline: 'Timelines',
    fxBasic: 'Post-process effects (colour, lens, edges)',
    fxAtmosphere: 'Post-process effects (sky, fog, rain)',
    fxLighting: 'Post-process effects (occlusion, reflections, exposure)',
    foliage: 'Foliage',
    worldgen: 'Generated worlds (biomes, zones, placement)',
    water: 'Water',
    spline: 'Splines',
    characterShaders: 'Character shaders (hair, skin, eye)',
    particles: 'Particles',
    postprocess: 'Post-processing',
    physics: 'Physics (Box2D)',
    physics3d: 'Physics (3D)',
    spine: 'Spine animation',
    dragonbones: 'DragonBones animation',
    logic: 'Script graphs',
    video: 'Video',
    ai: 'Gameplay AI',
    replication: 'Replication',
    gameplay: 'Gameplay (character, combat)',
};

/**
 * What a package on a LEAN entry does to get this subsystem back: import the
 * named specifier, nothing (`base`), or take the whole entry (`whole-entry` —
 * no subpath installs it yet). Beside the components that put each subsystem in
 * use, so adding one cannot leave the packaging question unanswered.
 */
export const SUBSYSTEM_INSTALL: Readonly<Record<Subsystem, string>> = {
    text: 'base',
    particles: 'base',
    postprocess: 'base',
    tilemap: 'esengine/tilemap',
    terrain: 'esengine/terrain',
    timeline: 'esengine/timeline',
    fxBasic: 'esengine/fx-basic',
    fxAtmosphere: 'esengine/fx-atmosphere',
    fxLighting: 'esengine/fx-lighting',
    foliage: 'esengine/foliage',
    worldgen: 'esengine/worldgen',
    water: 'esengine/water',
    spline: 'esengine/spline',
    characterShaders: 'esengine/character-shaders',
    physics: 'esengine/physics',
    physics3d: 'esengine/physics3d',
    spine: 'esengine/spine',
    dragonbones: 'esengine/dragonbones',
    logic: 'esengine/logic',
    video: 'whole-entry',
    ai: 'esengine/ai',
    replication: 'esengine/replication',
    gameplay: 'esengine/gameplay',
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
 * The `esengine/` module a component belongs to, or null for one the base engine
 * always carries. What the Add Component menu asks before offering a component a
 * project has refused — the same table the export refuses a build by.
 */
export function moduleOfComponent(name: string): string | null {
    const subsystem = COMPONENT_SUBSYSTEM.get(name);
    if (subsystem === undefined) return null;
    const install = SUBSYSTEM_INSTALL[subsystem];
    return install === 'base' || install === 'whole-entry' ? null : install;
}

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
        // A material names the built-in shader it is made from.
        if (rec.type === 'material' && typeof rec.shader === 'string') {
            const shaderSubsystem = SHADER_SUBSYSTEM[rec.shader];
            if (shaderSubsystem) into.add(shaderSubsystem);
        }
        // A volume's effects are named in its data, and each is carried by one group.
        if (rec.type === 'PostProcessVolume') collectEffectGroups(rec.data, into);
    }
    for (const value of Object.values(rec)) collectSubsystems(value, into);
    return into;
}

function collectEffectGroups(data: unknown, into: Set<Subsystem>): void {
    const effects = (data as { effects?: unknown } | null)?.effects;
    if (!Array.isArray(effects)) return;
    for (const effect of effects) {
        const type = (effect as { type?: unknown } | null)?.type;
        const group = typeof type === 'string' ? POST_PROCESS_EFFECT_GROUP[type] : undefined;
        if (group) into.add(group);
    }
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

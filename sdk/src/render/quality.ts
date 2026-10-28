// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

export type QualityLevel = 'low' | 'medium' | 'high';
export type QualityMode = 'off' | 'auto' | QualityLevel;

export interface DeviceQualityInfo {
    model?: string;
    gpu?: string;
    memoryGB?: number;
    cores?: number;
}

export interface QualityProfile {
    renderScale: number;
    minRenderScale: number;
    msaaSamples: 1 | 2 | 4 | 8;
    /**
     * How the edges of the picture are smoothed. `msaa` is the multisampling above (plus an FXAA pass where the scene has one). `temporal` draws
     * at one sample and lets the `taa` pass do it from the frames before: it costs a tenth of a millisecond at 1080p where four samples cost three
     * and two cost over one, and in return the picture is somewhat softer, a cut-out leaf has no coverage dither and a surface that moves by itself
     * without a motion vector (water) smears a little while the camera moves. The level takes the `taa` pass whether or not the scene's volume
     * lists it, and leaves `fxaa` out; it needs a post-process volume on the camera.
     */
    antialiasing: 'msaa' | 'temporal';
    shadowAtlasSize: number;
    shadowCellSize: number;
    /**
     * The cascades a perspective sun's shadow is split into, and how far (in world units, 0 for as far as the scene reaches) they reach. Both act only on
     * a sun whose `shadowExtent` is 0: one with an extent draws a single map of that size and uses neither. Each cascade draws the casters again.
     */
    shadowCascades: number;
    shadowDistance: number;
    /**
     * How much of its distances a level lets a plant keep, 0.25 to 1: a kind that changes to its cheaper mesh at 60 m and is not drawn past
     * 150 m does so at 30 m and 75 m with 0.5. The far version (a tree's cards) is the same cost at any distance, so it takes over sooner.
     */
    detailScale: number;
    particleLimit: number;
    planarReflectionScale: number;
    planarReflectionMaxSize: number;
    /** Zero means every frame; this never caps the main scene. */
    planarReflectionUpdatesPerSecond: number;
    /**
     * Whether the opaque scene is drawn twice, depth alone first, so each pixel is shaded for the surface in front of it and not for every one drawn
     * there on the way. It pays where surfaces overlap (a wood, a crowd of foliage) on a GPU that shades what it rasterises; on one that defers
     * shading to the end of a tile it is geometry paid for twice, so the weakest level leaves it off.
     */
    depthPrepass: boolean;
    postProcess: boolean;
    ssao: boolean;
    /** How many of a body of water's four waves are summed: in the geometry, the shading and what the surface answers for code. 1 to 4. */
    waterWaves: number;
    /** The most cells along a side of the ripple grid a body of water keeps; the body's own `ripples` is held to it. 0 keeps none. */
    waterRippleCells: number;
    /** Whether the waves lift the water's geometry. Off is the lite water: a flat surface whose waves are in the shading only, and which code reads as flat. */
    waterDisplacement: boolean;
    /** Whether the surface seen from below mirrors the world under it (a screen-space march per pixel). */
    waterMirror: boolean;
    /** Whether the sun's web of light is drawn on what is under the water, and through the surface as shafts. */
    waterCaustics: boolean;
    /**
     * Post-process effects this level leaves out, each named by its effect type (`ssr`, `taa`, `depthOfField`,
     * `lightShafts`, `autoExposure` …), compared without regard to case. An effect is all of its passes: a
     * multi-pass effect is skipped whole, however its passes are named. The expensive ones are the ones a weak
     * device has no use for — they are measured per effect (`fx-cost` in the editor checks) — so what a level
     * skips follows from what a frame on that device can afford.
     */
    skipEffects: readonly string[];
    /**
     * The most texels a side the 2D rain's shelter mask has: the largest a `rain2d` effect is let draw its own `maskSize` at. The mask is painted every frame, so
     * a weak device spends less on a smaller one and gets rain whose dry edges are softer.
     */
    shelterMaskSize: number;
    /**
     * How many samples across a light source a soft 2D shadow is drawn with, 1 to 32: a light's `shadowSoftness` is a source with width, and its penumbra
     * is that many silhouettes added up. Fewer is cheaper and shows the edge as bands; sixteen is where the bands stop reading as separate shadows.
     */
    shadowSoftSamples: number;
}

export interface DeviceQualityRule {
    level: QualityLevel;
    modelIncludes?: string;
    gpuIncludes?: string;
    maxMemoryGB?: number;
    maxCores?: number;
}

/** @experimental */
export interface QualityConfig {
    mode?: QualityMode;
    targetFps?: number;
    dynamicResolution?: boolean;
    /**
     * A frame never waits for a shader the browser is still compiling: what needs it is left out until it is ready, and several compile at once. Off
     * (the default) the first draw to need a shader waits for it, which keeps every frame complete and can stop one for seconds on a first visit
     * (a heavy lit shader on a driver that compiles slowly). Turn it on for a game that would rather open fast and fill in.
     */
    asyncShaderCompile?: boolean;
    /**
     * With `asyncShaderCompile`: draw the first scene's frames out of sight, behind the loading screen, until its shaders have compiled, and show it
     * complete instead of filling in (see `warmShaders`). The wait is bounded by `prewarmTimeoutMs`.
     */
    prewarmShaders?: boolean;
    /**
     * Draw only the frames that can look different (see `RenderDemand`): a still screen costs the game's logic and nothing else. Off unless a game
     * turns it on, because what the engine cannot see change (a script setting a colour, an animation) has to be said with `request` or `hold`.
     */
    renderOnDemand?: boolean;
    /** Frames still drawn after the last reason to draw. Default 30. */
    renderOnDemandTail?: number;
    /** The longest the loading screen waits for the shaders. Default 30000. */
    prewarmTimeoutMs?: number;
    profiles?: Partial<Record<QualityLevel, Partial<QualityProfile>>>;
    deviceRules?: DeviceQualityRule[];
}

const LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];
const PROFILES: Record<QualityLevel, QualityProfile> = {
    low: {
        renderScale: 0.75, minRenderScale: 0.5, msaaSamples: 1, antialiasing: 'msaa',
        shadowAtlasSize: 1024, shadowCellSize: 256, shadowCascades: 2,
        planarReflectionScale: 0.25, planarReflectionMaxSize: 512, planarReflectionUpdatesPerSecond: 0, depthPrepass: false,
        shadowDistance: 0, detailScale: 0.5, particleLimit: 1000, postProcess: true, ssao: false,
        waterWaves: 2, waterRippleCells: 32, waterDisplacement: false, waterMirror: false, waterCaustics: false,
        skipEffects: ['ssr', 'taa', 'depthOfField', 'lightShafts', 'motionBlur', 'lensFlare', 'gtao', 'subsurface', 'voxelGI'],
        shelterMaskSize: 256, shadowSoftSamples: 8,
    },
    medium: {
        renderScale: 1, minRenderScale: 0.65, msaaSamples: 2, antialiasing: 'temporal',
        shadowAtlasSize: 2048, shadowCellSize: 512, shadowCascades: 3,
        planarReflectionScale: 0.5, planarReflectionMaxSize: 1024, planarReflectionUpdatesPerSecond: 0, depthPrepass: true,
        shadowDistance: 0, detailScale: 0.8, particleLimit: 5000, postProcess: true, ssao: true,
        waterWaves: 3, waterRippleCells: 64, waterDisplacement: true, waterMirror: true, waterCaustics: true,
        skipEffects: ['ssr', 'depthOfField'],
        shelterMaskSize: 512, shadowSoftSamples: 12,
    },
    high: {
        renderScale: 1, minRenderScale: 0.75, msaaSamples: 4, antialiasing: 'msaa',
        // A face is millimetres of relief: at 512 texels a cascade, a skin-hugging card (a brow, a hairline) falls inside one texel of the skin and the
        // shadow speckles it with dirt. 1024 is the cell that clears it for a character at arm's length.
        shadowAtlasSize: 4096, shadowCellSize: 1024, shadowCascades: 4,
        planarReflectionScale: 1, planarReflectionMaxSize: 2048, planarReflectionUpdatesPerSecond: 0, depthPrepass: true,
        shadowDistance: 0, detailScale: 1, particleLimit: 20000, postProcess: true, ssao: true,
        waterWaves: 4, waterRippleCells: 128, waterDisplacement: true, waterMirror: true, waterCaustics: true,
        skipEffects: [],
        shelterMaskSize: 1024, shadowSoftSamples: 16,
    },
};

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.min(max, Math.max(min, value)) : fallback;
}

/** @experimental */
export function parseQualityConfig(value: unknown): QualityConfig {
    const raw = record(value);
    const mode = raw.mode === 'auto' || LEVELS.includes(raw.mode as QualityLevel)
        ? raw.mode as QualityMode : 'off';
    const config: QualityConfig = {
        mode, targetFps: finite(raw.targetFps, 60, 15, 120),
        dynamicResolution: raw.dynamicResolution === true,
        asyncShaderCompile: raw.asyncShaderCompile === true,
        prewarmShaders: raw.prewarmShaders === true,
        renderOnDemand: raw.renderOnDemand === true,
        renderOnDemandTail: finite(raw.renderOnDemandTail, 30, 1, 600),
        prewarmTimeoutMs: finite(raw.prewarmTimeoutMs, 30000, 1000, 600000),
    };
    if (raw.profiles) {
        config.profiles = {};
        for (const level of LEVELS) {
            if (!record(raw.profiles)[level]) continue;
            config.profiles[level] = resolveProfile(level, record(raw.profiles)[level]);
        }
    }
    if (Array.isArray(raw.deviceRules)) {
        config.deviceRules = raw.deviceRules.slice(0, 64).flatMap(value => {
            const r = record(value);
            if (!LEVELS.includes(r.level as QualityLevel)) return [];
            const rule: DeviceQualityRule = { level: r.level as QualityLevel };
            for (const key of ['modelIncludes', 'gpuIncludes'] as const) {
                if (typeof r[key] === 'string' && r[key].trim()) rule[key] = r[key].trim();
            }
            for (const key of ['maxMemoryGB', 'maxCores'] as const) {
                if (typeof r[key] === 'number' && Number.isFinite(r[key]) && r[key] > 0) {
                    rule[key] = r[key];
                }
            }
            return Object.keys(rule).length > 1 ? [rule] : [];
        });
    }
    return config;
}

function resolveProfile(level: QualityLevel, value: unknown): QualityProfile {
    const base = PROFILES[level];
    const r = record(value);
    const renderScale = finite(r.renderScale, base.renderScale, 0.25, 1);
    const atlas = [512, 1024, 2048, 4096].includes(r.shadowAtlasSize as number)
        ? r.shadowAtlasSize as number : base.shadowAtlasSize;
    const cell = [128, 256, 512, 1024].includes(r.shadowCellSize as number)
        ? r.shadowCellSize as number : base.shadowCellSize;
    return {
        renderScale,
        minRenderScale: finite(r.minRenderScale, Math.min(base.minRenderScale, renderScale),
            0.25, renderScale),
        msaaSamples: [1, 2, 4, 8].includes(r.msaaSamples as number)
            ? r.msaaSamples as QualityProfile['msaaSamples'] : base.msaaSamples,
        antialiasing: r.antialiasing === 'msaa' || r.antialiasing === 'temporal' ? r.antialiasing : base.antialiasing,
        shadowAtlasSize: atlas,
        shadowCellSize: Math.min(cell, atlas / 2),
        shadowCascades: Math.round(finite(r.shadowCascades, base.shadowCascades, 1, 4)),
        shadowDistance: finite(r.shadowDistance, base.shadowDistance, 0, 10000000),
        detailScale: finite(r.detailScale, base.detailScale, 0.25, 1),
        particleLimit: Math.round(finite(r.particleLimit, base.particleLimit, 0, 1000000)),
        planarReflectionScale: finite(r.planarReflectionScale, base.planarReflectionScale, 0.125, 1),
        planarReflectionMaxSize: Math.round(finite(r.planarReflectionMaxSize, base.planarReflectionMaxSize, 64, 4096)),
        planarReflectionUpdatesPerSecond: finite(r.planarReflectionUpdatesPerSecond, base.planarReflectionUpdatesPerSecond, 0, 120),
        depthPrepass: typeof r.depthPrepass === 'boolean' ? r.depthPrepass : base.depthPrepass,
        postProcess: typeof r.postProcess === 'boolean' ? r.postProcess : base.postProcess,
        ssao: typeof r.ssao === 'boolean' ? r.ssao : base.ssao,
        waterWaves: Math.round(finite(r.waterWaves, base.waterWaves, 1, 4)),
        waterRippleCells: Math.round(finite(r.waterRippleCells, base.waterRippleCells, 0, 256)),
        waterDisplacement: typeof r.waterDisplacement === 'boolean' ? r.waterDisplacement : base.waterDisplacement,
        waterMirror: typeof r.waterMirror === 'boolean' ? r.waterMirror : base.waterMirror,
        waterCaustics: typeof r.waterCaustics === 'boolean' ? r.waterCaustics : base.waterCaustics,
        skipEffects: Array.isArray(r.skipEffects)
            ? r.skipEffects.filter((e): e is string => typeof e === 'string' && e.trim() !== '')
                .map((e) => e.trim()).slice(0, 32)
            : base.skipEffects,
        shelterMaskSize: Math.round(finite(r.shelterMaskSize, base.shelterMaskSize, 64, 2048)),
        shadowSoftSamples: Math.round(finite(r.shadowSoftSamples, base.shadowSoftSamples, 1, 32)),
    };
}

/** A level's profile as the engine will use it: the level's own defaults with a project's overrides on top. */
export function resolveQualityProfile(level: QualityLevel, overrides?: Partial<QualityProfile>): QualityProfile {
    return resolveProfile(level, overrides);
}

/** What a level is before a project says anything about it. */
export function defaultQualityProfile(level: QualityLevel): QualityProfile {
    return PROFILES[level];
}

function matches(rule: DeviceQualityRule, info: DeviceQualityInfo): boolean {
    const includes = (text: string | undefined, part: string): boolean =>
        text?.toLowerCase().includes(part.toLowerCase()) ?? false;
    return (!rule.modelIncludes || includes(info.model, rule.modelIncludes))
        && (!rule.gpuIncludes || includes(info.gpu, rule.gpuIncludes))
        && (rule.maxMemoryGB === undefined
            || (info.memoryGB !== undefined && info.memoryGB <= rule.maxMemoryGB))
        && (rule.maxCores === undefined
            || (info.cores !== undefined && info.cores <= rule.maxCores));
}

export interface QualityReport {
    mode: QualityMode;
    level: QualityLevel;
    renderScale: number;
    targetFps: number;
    frameMs: number;
    reason: string;
    limitations: string[];
}

/** @experimental Per-app policy; authored scene components remain unchanged. */
export class QualityController {
    private config_: QualityConfig;
    private level_: QualityLevel = 'high';
    private profile_: QualityProfile = PROFILES.high;
    private scale_ = 1;
    private average_ = 0;
    private pressureMs_ = 0;
    private recoveryMs_ = 0;
    private reason_ = 'disabled';
    private modeReason_ = 'disabled';
    private limitations_ = new Set<string>();

    constructor(config: QualityConfig, private readonly device_: DeviceQualityInfo = {}) {
        this.config_ = parseQualityConfig(config);
        this.setMode(this.config_.mode ?? 'off');
    }

    get enabled(): boolean { return this.config_.mode !== 'off'; }
    get profile(): Readonly<QualityProfile> { return this.profile_; }
    get renderScale(): number { return this.enabled ? this.scale_ : 1; }

    setMode(mode: QualityMode): void {
        this.config_.mode = mode;
        const rule = this.config_.deviceRules?.find(r => matches(r, this.device_));
        const low = (this.device_.memoryGB !== undefined && this.device_.memoryGB <= 2)
            || (this.device_.cores !== undefined && this.device_.cores <= 2);
        this.level_ = mode === 'off' ? 'high' : mode === 'auto'
            ? rule?.level ?? (low ? 'low' : 'medium') : mode;
        this.profile_ = resolveProfile(this.level_, this.config_.profiles?.[this.level_]);
        this.scale_ = mode === 'off' ? 1 : this.profile_.renderScale;
        this.average_ = this.pressureMs_ = this.recoveryMs_ = 0;
        this.reason_ = mode === 'off' ? 'disabled' : mode !== 'auto' ? 'manual'
            : rule ? 'device-rule' : low ? 'device-capacity' : 'device-unknown';
        this.modeReason_ = this.reason_;
    }

    setLimitation(reason: string, active: boolean): void {
        if (active) this.limitations_.add(reason);
        else this.limitations_.delete(reason);
    }

    sample(frameMs: number, gpuMs = -1): void {
        if (!this.enabled || !this.config_.dynamicResolution) return;
        if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) {
            this.average_ = this.pressureMs_ = this.recoveryMs_ = 0;
            return;
        }
        const ms = Number.isFinite(gpuMs) && gpuMs > 0 ? gpuMs : frameMs;
        const weight = 1 - Math.exp(-frameMs / 250);
        this.average_ = this.average_ === 0 ? ms : this.average_ + weight * (ms - this.average_);
        const budget = 1000 / (this.config_.targetFps ?? 60);
        this.pressureMs_ = this.average_ > budget * 1.1 ? this.pressureMs_ + frameMs : 0;
        this.recoveryMs_ = this.average_ < budget * 0.8 ? this.recoveryMs_ + frameMs : 0;
        if (this.pressureMs_ >= 500) {
            this.scale_ = Math.max(this.profile_.minRenderScale,
                Math.round((this.scale_ - 0.05) * 100) / 100);
            this.reason_ = this.scale_ === this.profile_.minRenderScale
                ? 'resolution-floor' : gpuMs > 0 ? 'gpu-pressure' : 'frame-pressure';
            this.pressureMs_ = this.recoveryMs_ = 0;
        } else if (this.recoveryMs_ >= 2000) {
            this.scale_ = Math.min(this.profile_.renderScale,
                Math.round((this.scale_ + 0.05) * 100) / 100);
            this.reason_ = this.scale_ === this.profile_.renderScale ? this.modeReason_ : 'recovery';
            this.pressureMs_ = this.recoveryMs_ = 0;
        }
    }

    report(): QualityReport {
        return {
            mode: this.config_.mode ?? 'off', level: this.level_,
            renderScale: this.renderScale, targetFps: this.config_.targetFps ?? 60,
            frameMs: this.average_, reason: this.reason_, limitations: [...this.limitations_],
        };
    }
}

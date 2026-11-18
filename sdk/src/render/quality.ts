// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { PowerPolicy } from './power';
import {
    qualitySettingDefaults, qualitySettingPreferences, resolveQualitySettings,
    type QualitySettingPreferences, type QualitySettingValues,
} from './qualitySettings/index';

const MAX_SKIPPED_EFFECTS = 1024;

export type QualityLevel = 'low' | 'medium' | 'high';
export type QualityMode = 'off' | 'auto' | QualityLevel;

export interface DeviceQualityInfo {
    model?: string;
    gpu?: string;
    memoryGB?: number;
    cores?: number;
}

export { MOST_WATER_WAVES } from './qualitySettings/index';

export interface QualityProfile extends QualitySettingValues {
    /**
     * Post-process effects this level leaves out, each named by its effect type (`ssr`, `taa`, `depthOfField`,
     * `lightShafts`, `autoExposure` …), compared without regard to case. An effect is all of its passes: a
     * multi-pass effect is skipped whole, however its passes are named. The expensive ones are the ones a weak
     * device has no use for — they are measured per effect (`fx-cost` in the editor checks) — so what a level
     * skips follows from what a frame on that device can afford.
     */
    skipEffects: readonly string[];
}

export interface DeviceQualityRule {
    level: QualityLevel;
    modelIncludes?: string;
    gpuIncludes?: string;
    maxMemoryGB?: number;
    maxCores?: number;
}

export interface QualityPreferences extends QualitySettingPreferences {
    renderScale?: number;
    antialiasing?: 'off' | 'msaa' | 'temporal';
    ssao?: boolean;
    skipEffects?: readonly string[];
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
    /**
     * Draw less when the device is short of battery or running hot: a frame cap and a ceiling on the level while it is, both taken off when it recovers.
     * Absent, the device is not watched and nothing changes. See {@link PowerPolicy}.
     */
    power?: PowerPolicy;
}

const LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];
const SKIPPED_EFFECTS: Record<QualityLevel, readonly string[]> = {
    low: ['ssr', 'taa', 'depthOfField', 'lightShafts', 'motionBlur', 'lensFlare', 'ssao', 'gtao', 'subsurface', 'voxelGI', 'dynamicGI'],
    medium: ['ssr', 'depthOfField'],
    high: [],
};
const PROFILES = Object.fromEntries(LEVELS.map((level) => [level, { ...qualitySettingDefaults(level), skipEffects: SKIPPED_EFFECTS[level] }])) as Record<QualityLevel, QualityProfile>;

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.min(max, Math.max(min, value)) : fallback;
}

/**
 * The level a project gets that names none. A phone or tablet takes medium: all of a level's picture at a fraction of the cost (a full-screen sea on a
 * Snapdragon 8 Elite is 25.7 ms a frame as authored and 9.0 at medium, mostly by leaving four samples behind). Elsewhere nothing is managed. Naming a
 * level, `off` among them, always wins.
 */
export function defaultQualityMode(handheld: boolean): QualityMode {
    return handheld ? 'medium' : 'off';
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
    if (raw.power !== undefined && raw.power !== false) config.power = parsePowerPolicy(raw.power);
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

/** A power policy from a project's settings: what is not a usable number or name keeps its default, and `true` is every default. */
export function parsePowerPolicy(value: unknown): PowerPolicy {
    const r = record(value);
    const policy: PowerPolicy = {};
    if (typeof r.lowBattery === 'number' && Number.isFinite(r.lowBattery)) policy.lowBattery = Math.min(Math.max(r.lowBattery, 0), 1);
    if (r.thermal === 'serious' || r.thermal === 'critical' || r.thermal === 'never') policy.thermal = r.thermal;
    if (typeof r.fps === 'number' && Number.isFinite(r.fps)) policy.fps = Math.min(Math.max(Math.round(r.fps), 10), 120);
    if (r.ceiling === 'low' || r.ceiling === 'medium' || r.ceiling === 'high') policy.ceiling = r.ceiling;
    if (r.severe === 'critical' || r.severe === 'never') policy.severe = r.severe;
    return policy;
}

const AMBIENT_OCCLUSION = ['ssao', 'gtao'];

function withAmbientOcclusion(skip: readonly string[], on: unknown): readonly string[] {
    if (on === false) return [...skip, ...AMBIENT_OCCLUSION.filter((type) => !skip.some((e) => e.toLowerCase() === type))];
    if (on === true) return skip.filter((e) => e.toLowerCase() !== 'ssao');
    return skip;
}

function resolveProfile(level: QualityLevel, value: unknown): QualityProfile {
    const base = PROFILES[level];
    const r = record(value);
    const settings = resolveQualitySettings(r, base);
    const skipEffects = Array.isArray(r.skipEffects)
        ? r.skipEffects.filter((e): e is string => typeof e === 'string' && e.trim() !== '')
            .map((e) => e.trim()).slice(0, MAX_SKIPPED_EFFECTS)
        : base.skipEffects;
    return {
        ...settings,
        minRenderScale: Math.min(settings.minRenderScale, settings.renderScale),
        shadowCellSize: Math.min(settings.shadowCellSize, settings.shadowAtlasSize / 2) as QualityProfile['shadowCellSize'],
        skipEffects: withAmbientOcclusion(skipEffects, r.ssao),
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
    /** Smoothed frame interval. */
    frameMs: number;
    /** Smoothed time the frame's own run took, and the GPU's time for it; -1 where the host does not say. */
    busyMs: number;
    gpuMs: number;
    reason: string;
    limitations: string[];
    /** The level's draw call budget (see `QualityProfile.drawCallBudget`). */
    drawCallBudget: number;
}

/**
 * @experimental One frame's clock readings, as dynamic resolution takes them. `frameMs` is the interval since the last
 * frame; `busyMs` how long the frame's own run took (`FrameTiming.busyMs`); `gpuMs` the GPU's time for the frame. The
 * last two are optional, and a value that is not a positive number counts as not given.
 */
export interface QualitySample {
    frameMs: number;
    busyMs?: number;
    gpuMs?: number;
}

/** @experimental What a stretch of frames says about the render resolution. */
export type FrameVerdict = 'gpu-pressure' | 'frame-pressure' | 'headroom' | 'steady';

const PRESSURE = 1.1;
const HEADROOM = 0.8;

/**
 * @experimental Whether resolution should go down, may come back up, or stay, from smoothed readings (-1 = not known)
 * and the frame budget. Pure.
 *
 * A GPU reading over the budget is pressure on its own word. A small one is not headroom on its own word: a timer
 * can cover less than the frame (a tile renderer has not drawn when the pass is stamped), so what a low reading may
 * do is decided with the frame itself. A frame that came late although its own run fitted the budget waited on the
 * GPU or the display, and resolution is the lever for that; one whose run did not fit is the CPU's, and resolution
 * would buy nothing.
 */
export function judgeFrames(avg: Readonly<Required<QualitySample>>, budgetMs: number): FrameVerdict {
    const gpuKnown = avg.gpuMs > 0;
    const busyKnown = avg.busyMs > 0;
    if (gpuKnown && avg.gpuMs > budgetMs * PRESSURE) return 'gpu-pressure';
    const gpuFree = gpuKnown && avg.gpuMs < budgetMs * HEADROOM;
    if (avg.frameMs > budgetMs * PRESSURE) {
        if (busyKnown ? avg.busyMs <= budgetMs : !gpuKnown) return 'frame-pressure';
        return gpuFree ? 'headroom' : 'steady';
    }
    return (gpuKnown ? gpuFree : avg.frameMs < budgetMs * HEADROOM) ? 'headroom' : 'steady';
}

/** Pressure for this long lowers the scale a step; headroom for `RECOVER_MS` and up raises it one. */
const PRESSURE_MS = 500;
const RECOVER_MS = 2000;
const RECOVER_MAX_MS = 32000;
/** A step up that is taken back within this long was a mistake, not a change of scene. */
const BOUNCE_MS = 5000;

const known = (ms: number | undefined): ms is number => ms !== undefined && Number.isFinite(ms) && ms > 0;

/** @experimental Per-app policy; authored scene components remain unchanged. */
export class QualityController {
    private config_: QualityConfig;
    private level_: QualityLevel = 'high';
    /** The level the mode asks for, before a ceiling lowers it. */
    private modeLevel_: QualityLevel = 'high';
    private ceiling_: QualityLevel | null = null;
    private profile_: QualityProfile = PROFILES.high;
    private scale_ = 1;
    private average_: Required<QualitySample> = { frameMs: 0, busyMs: -1, gpuMs: -1 };
    private pressureMs_ = 0;
    private recoveryMs_ = 0;
    /** Sampled time, the clock the two below are read on. */
    private clockMs_ = 0;
    private raisedAt_ = -1;
    /** How long headroom must last before a step up; grows while steps up keep being taken back. */
    private recoverAfterMs_ = RECOVER_MS;
    private reason_ = 'disabled';
    private modeReason_ = 'disabled';
    private limitations_ = new Set<string>();
    private preferences_: QualityPreferences = {};

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
        this.modeLevel_ = mode === 'off' ? 'high' : mode === 'auto'
            ? rule?.level ?? (low ? 'low' : 'medium') : mode;
        this.level_ = this.ceilingOf_(this.modeLevel_);
        this.profile_ = this.resolve_(this.level_);
        this.scale_ = mode === 'off' ? 1 : this.profile_.renderScale;
        this.resetSampling_(true);
        this.reason_ = mode === 'off' ? 'disabled' : mode !== 'auto' ? 'manual'
            : rule ? 'device-rule' : low ? 'device-capacity' : 'device-unknown';
        this.modeReason_ = this.reason_;
    }

    get preferences(): Readonly<QualityPreferences> { return this.preferences_; }

    setPreferences(preferences: QualityPreferences | null): void {
        this.preferences_ = { ...(preferences ?? {}) };
        this.profile_ = this.resolve_(this.level_);
        this.scale_ = this.enabled ? this.profile_.renderScale : 1;
        this.resetSampling_(true);
    }

    private resolve_(level: QualityLevel): QualityProfile {
        const authored = record(this.config_.profiles?.[level]);
        const base = resolveProfile(level, authored);
        const p = this.preferences_;
        const off = p.antialiasing === 'off';
        return resolveProfile(level, {
            ...authored,
            ...(p.renderScale !== undefined ? { renderScale: p.renderScale, minRenderScale: Math.min(base.minRenderScale, p.renderScale) } : {}),
            ...(off ? { msaaSamples: 1, antialiasing: 'msaa' } : {}),
            ...(p.antialiasing === 'msaa' ? { antialiasing: 'msaa', msaaSamples: base.msaaSamples > 1 ? base.msaaSamples : 4 } : {}),
            ...(p.antialiasing === 'temporal' ? { antialiasing: 'temporal' } : {}),
            ...qualitySettingPreferences(p as Record<string, unknown>),
            ssao: undefined,
            skipEffects: [
                ...withAmbientOcclusion(base.skipEffects.filter(e => p.antialiasing !== 'temporal' || e !== 'taa'), p.ssao),
                ...(off ? ['fxaa', 'taa'] : []), ...(p.skipEffects ?? []),
            ],
        });
    }

    private ceilingOf_(level: QualityLevel): QualityLevel {
        return this.ceiling_ !== null && LEVELS.indexOf(this.ceiling_) < LEVELS.indexOf(level) ? this.ceiling_ : level;
    }

    /**
     * No level above `level` while it is set; null takes it off. Only lowers: a mode already at or under the ceiling is left as it is. Used by the power
     * policy, which holds the level down while the device is short of battery or hot.
     */
    setCeiling(level: QualityLevel | null): void {
        if (this.ceiling_ === level) return;
        this.ceiling_ = level;
        const next = this.ceilingOf_(this.modeLevel_);
        this.setLimitation('power-saver', next !== this.modeLevel_);
        if (next === this.level_) return;
        this.level_ = next;
        this.profile_ = this.resolve_(next);
        this.scale_ = this.enabled ? this.profile_.renderScale : 1;
        this.resetSampling_(true);
        this.reason_ = next !== this.modeLevel_ ? 'power-saver' : this.modeReason_;
    }

    setLimitation(reason: string, active: boolean): void {
        if (active) this.limitations_.add(reason);
        else this.limitations_.delete(reason);
    }

    /** Forget the running averages; `all` also forgets what was learned about stepping back up. */
    private resetSampling_(all: boolean): void {
        this.average_ = { frameMs: 0, busyMs: -1, gpuMs: -1 };
        this.pressureMs_ = this.recoveryMs_ = 0;
        if (all) { this.clockMs_ = 0; this.raisedAt_ = -1; this.recoverAfterMs_ = RECOVER_MS; }
    }

    /**
     * Take one frame's readings. Sustained pressure lowers the render scale a step towards the level's floor;
     * sustained headroom raises it back a step. See {@link judgeFrames} for what counts as which.
     */
    sample(sample: Readonly<QualitySample>): void {
        if (!this.enabled || !this.config_.dynamicResolution) return;
        const { frameMs } = sample;
        if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) {
            this.resetSampling_(false);
            return;
        }
        const first = this.average_.frameMs === 0;
        const weight = 1 - Math.exp(-frameMs / 250);
        const blend = (avg: number, ms: number | undefined): number =>
            !known(ms) ? -1 : first || avg < 0 ? ms : avg + weight * (ms - avg);
        this.average_ = {
            frameMs: blend(this.average_.frameMs, frameMs),
            busyMs: blend(this.average_.busyMs, sample.busyMs),
            gpuMs: blend(this.average_.gpuMs, sample.gpuMs),
        };
        this.clockMs_ += frameMs;
        const verdict = judgeFrames(this.average_, 1000 / (this.config_.targetFps ?? 60));
        const pressed = verdict === 'gpu-pressure' || verdict === 'frame-pressure';
        this.pressureMs_ = pressed ? this.pressureMs_ + frameMs : 0;
        this.recoveryMs_ = verdict === 'headroom' ? this.recoveryMs_ + frameMs : 0;
        if (this.pressureMs_ >= PRESSURE_MS) {
            // A step up that had to be taken straight back: whatever called that headroom cannot be trusted on this
            // device, so the next one waits twice as long instead of flickering between two scales.
            if (this.raisedAt_ >= 0 && this.clockMs_ - this.raisedAt_ <= BOUNCE_MS) {
                this.recoverAfterMs_ = Math.min(RECOVER_MAX_MS, this.recoverAfterMs_ * 2);
            }
            this.raisedAt_ = -1;
            this.scale_ = Math.max(this.profile_.minRenderScale,
                Math.round((this.scale_ - 0.05) * 100) / 100);
            this.reason_ = this.scale_ === this.profile_.minRenderScale ? 'resolution-floor' : verdict;
            this.pressureMs_ = this.recoveryMs_ = 0;
        } else if (this.recoveryMs_ >= this.recoverAfterMs_) {
            // The last step up held, so the wait eases back towards its start.
            if (this.raisedAt_ >= 0) this.recoverAfterMs_ = Math.max(RECOVER_MS, this.recoverAfterMs_ / 2);
            this.raisedAt_ = this.scale_ < this.profile_.renderScale ? this.clockMs_ : -1;
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
            frameMs: this.average_.frameMs, busyMs: this.average_.busyMs, gpuMs: this.average_.gpuMs,
            reason: this.reason_, limitations: [...this.limitations_],
            drawCallBudget: this.profile_.drawCallBudget,
        };
    }
}

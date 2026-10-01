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
    shadowAtlasSize: number;
    shadowCellSize: number;
    shadowCascades: number;
    shadowDistance: number;
    particleLimit: number;
    postProcess: boolean;
    ssao: boolean;
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
    profiles?: Partial<Record<QualityLevel, Partial<QualityProfile>>>;
    deviceRules?: DeviceQualityRule[];
}

const LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];
const PROFILES: Record<QualityLevel, QualityProfile> = {
    low: {
        renderScale: 0.75, minRenderScale: 0.5, msaaSamples: 1,
        shadowAtlasSize: 1024, shadowCellSize: 256, shadowCascades: 2,
        shadowDistance: 0, particleLimit: 1000, postProcess: true, ssao: false,
    },
    medium: {
        renderScale: 1, minRenderScale: 0.65, msaaSamples: 2,
        shadowAtlasSize: 2048, shadowCellSize: 512, shadowCascades: 3,
        shadowDistance: 0, particleLimit: 5000, postProcess: true, ssao: true,
    },
    high: {
        renderScale: 1, minRenderScale: 0.75, msaaSamples: 4,
        shadowAtlasSize: 2048, shadowCellSize: 512, shadowCascades: 4,
        shadowDistance: 0, particleLimit: 20000, postProcess: true, ssao: true,
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
        shadowAtlasSize: atlas,
        shadowCellSize: Math.min(cell, atlas / 2),
        shadowCascades: Math.round(finite(r.shadowCascades, base.shadowCascades, 1, 4)),
        shadowDistance: finite(r.shadowDistance, base.shadowDistance, 0, 10000000),
        particleLimit: Math.round(finite(r.particleLimit, base.particleLimit, 0, 1000000)),
        postProcess: typeof r.postProcess === 'boolean' ? r.postProcess : base.postProcess,
        ssao: typeof r.ssao === 'boolean' ? r.ssao : base.ssao,
    };
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

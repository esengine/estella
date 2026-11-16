// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export const MODEL_BAKES_FILE = 'model-bakes.json';
export const MODEL_PRODUCT_ROLES = ['mesh', 'normal', 'color', 'surface', 'emissive', 'occlusion'] as const;
export type ModelProductRole = typeof MODEL_PRODUCT_ROLES[number];

export interface ModelBakesFile {
    version: 1;
    models: { source: string; text: string; products: Partial<Record<ModelProductRole, string>> }[];
}

const UNBAKEABLE = ['boolean', 'fracture'];

export const bakesAtLoad = (raw: unknown): boolean => {
    const source = raw as { normalBake?: unknown; steps?: { op: string; steps?: unknown }[] };
    const plain = (steps: readonly { op: string; steps?: unknown }[]): boolean => steps.every((step) => !UNBAKEABLE.includes(step.op) && (!Array.isArray(step.steps) || plain(step.steps as { op: string }[])));
    return !!source.normalBake && Array.isArray(source.steps) && plain(source.steps);
};

export function modelProductPaths(source: string): Record<ModelProductRole, string> {
    const stem = source.replace(/\.esmodel$/i, '');
    return Object.fromEntries(MODEL_PRODUCT_ROLES.map((role) => [role, role === 'mesh' ? `${stem}.esmesh` : `${stem}_${role}.png`])) as Record<ModelProductRole, string>;
}

export const BAKE_TIERS = ['desktop', 'high', 'mid', 'low'] as const;
export type BakeTier = typeof BAKE_TIERS[number];
export const TIER_SIZE: Record<BakeTier, number> = { desktop: 2048, high: 2048, mid: 1024, low: 512 };
export const MODEL_MAPS = ['normal', 'color', 'surface', 'emissive', 'occlusion'] as const;
export type ModelMapName = typeof MODEL_MAPS[number];


export interface DeviceFacts {
    mobile: boolean;
    memoryGB?: number;
    cores?: number;
}

export function bakeTierOf(device: DeviceFacts): BakeTier {
    const memory = device.memoryGB ?? (device.mobile ? 4 : 8), cores = device.cores ?? 4;
    if (!device.mobile) return memory >= 8 ? 'desktop' : memory >= 4 ? 'high' : 'mid';
    return memory >= 8 && cores >= 8 ? 'high' : memory >= 4 ? 'mid' : 'low';
}

export function deviceFacts(): DeviceFacts {
    const nav = (typeof navigator === 'undefined' ? {} : navigator) as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
    const mobile = nav.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(nav.userAgent ?? '');
    return { mobile, ...(nav.deviceMemory ? { memoryGB: nav.deviceMemory } : {}), ...(nav.hardwareConcurrency ? { cores: nav.hardwareConcurrency } : {}) };
}

export type BakeStage = 'shape' | 'start' | 'surface' | 'shade' | 'plan' | 'relief' | 'occlusion' | 'paint' | 'finish';

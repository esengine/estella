// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  skinning.ts — the project's skinning settings (Project Settings > Rendering > Skinning).
 *
 *        How many bones one draw of a skinned mesh may carry, for every platform and per platform; how many joints
 *        one vertex may be moved by; and whether skin weights keep 16 bits. A model's own import settings override the
 *        last two; the export takes the bone budget of the platform it builds for.
 */
import { MESH_MAX_BONES } from '../../../sdk/src/asset/meshFormat';
import { MIN_BONES_PER_CHUNK, SKIN_INFLUENCES } from '../../../sdk/src/asset/skinChunks';
import type { ExportPlatform } from './platforms';

export interface SkinningConfig {
    /** Bones one draw of a skinned mesh may carry, for every platform: at most 256 (16KB of matrices, WebGL2's block). */
    maxBonesPerSection?: number;
    /**
     * The same budget for a platform, or for a group of them: `mobile` is Android, iOS and the mini-game hosts, `desktop`
     * the desktop app; a platform's own id outranks its group.
     */
    platformMaxBones?: Record<string, number>;
    /** Joints one vertex may be moved by, 1..4; 0 or absent keeps every one the mesh has (up to four). */
    boneInfluenceLimit?: number;
    /** Keep skin weights at 16 bits rather than 8. */
    highPrecisionWeights?: boolean;
}

/** The platforms the `mobile` group covers: what runs on a phone's GPU. */
const MOBILE: ReadonlySet<string> = new Set(['android', 'ios', 'wechat', 'douyin', 'kuaishou', 'bilibili', 'quickgame', 'alipay', 'huawei', 'playable']);

const clampBones = (n: unknown): number | undefined =>
    typeof n === 'number' && Number.isFinite(n) ? Math.min(MESH_MAX_BONES, Math.max(MIN_BONES_PER_CHUNK, Math.floor(n))) : undefined;

/** The block as it persists: only what differs from the defaults. */
export function parseSkinningConfig(raw: unknown): SkinningConfig {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const out: SkinningConfig = {};
    const max = clampBones(r.maxBonesPerSection);
    if (max !== undefined && max !== MESH_MAX_BONES) out.maxBonesPerSection = max;
    if (r.platformMaxBones && typeof r.platformMaxBones === 'object') {
        const platforms: Record<string, number> = {};
        for (const [k, v] of Object.entries(r.platformMaxBones as Record<string, unknown>)) {
            const n = clampBones(v);
            if (n !== undefined && /^[a-z][a-z0-9-]*$/.test(k)) platforms[k] = n;
        }
        if (Object.keys(platforms).length > 0) out.platformMaxBones = platforms;
    }
    if (typeof r.boneInfluenceLimit === 'number' && Number.isInteger(r.boneInfluenceLimit)
        && r.boneInfluenceLimit >= 1 && r.boneInfluenceLimit < SKIN_INFLUENCES) {
        out.boneInfluenceLimit = r.boneInfluenceLimit;
    }
    if (r.highPrecisionWeights === true) out.highPrecisionWeights = true;
    return out;
}

/** The bone budget a build for `platform` is made with; every platform's when none is named. */
export function maxBonesFor(config: SkinningConfig | undefined, platform?: ExportPlatform): number {
    const all = config?.maxBonesPerSection ?? MESH_MAX_BONES;
    if (!platform) return all;
    const own = config?.platformMaxBones?.[platform];
    if (own !== undefined) return own;
    const group = config?.platformMaxBones?.[MOBILE.has(platform) ? 'mobile' : platform === 'desktop' ? 'desktop' : ''];
    return group ?? all;
}

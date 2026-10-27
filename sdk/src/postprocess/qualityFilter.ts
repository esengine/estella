// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { QualityProfile } from '../render/quality';
import { effectPassNames } from './effects';

/**
 * Whether a quality level lets a pass of the chain run.
 *
 * A level names the effects it leaves out by TYPE; a pass is named by the effect's definition (its type, or the
 * names of its sub-passes), so this asks the registry which passes an effect is rather than guessing from the
 * name — a guess that reads `autoExposure` as a prefix finds none of `ae_measure`, `ae_adapt`, `ae_apply`.
 * An entry no effect answers to is kept as a prefix of the pass name, which is what the list meant before
 * effects were named by type.
 */
export function qualityPassAllowed(profile: Readonly<QualityProfile> | null, passName: string): boolean {
    if (profile === null) return true;
    if (!profile.postProcess) return false;
    const name = passName.toLowerCase();
    // Temporal anti-aliasing is the level's smoothing: its pass runs whatever the level skips, and FXAA, which would soften what it has settled, does not.
    if (profile.antialiasing === 'temporal') {
        if (effectPassNames('taa').some((pass) => pass.toLowerCase() === name)) return true;
        if (effectPassNames('fxaa').some((pass) => pass.toLowerCase() === name)) return false;
    }
    // The profile's own switch for ambient occlusion governs both estimators: it was written for the one and means the other.
    if (!profile.ssao && ['ssao', 'gtao'].some((type) => effectPassNames(type).some((pass) => pass.toLowerCase() === name))) return false;
    for (const skipped of profile.skipEffects) {
        const passes = effectPassNames(skipped);
        if (passes.length > 0) {
            if (passes.some((pass) => pass.toLowerCase() === name)) return false;
        } else if (name.startsWith(skipped.toLowerCase())) {
            return false;
        }
    }
    return true;
}

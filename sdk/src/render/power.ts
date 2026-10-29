// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  power.ts
 * @brief When the device is short of power or hot, the engine draws less: a frame cap and a ceiling on the quality level, taken off again when it recovers.
 *
 * @details A long session on a phone is heat and battery, and the frame is where both are spent. The engine already has the means (a frame cap, quality
 *          levels, render-on-demand); what was missing was something that notices the device and uses them. The device backend reports a {@link PowerState}
 *          (the battery's level and whether it is charging, and the thermal pressure where the platform says it), a {@link PowerPolicy} says when that is
 *          "saving" and what saving does, and the quality system applies it. Everything is off unless the game names a policy: a game that never asks for
 *          this draws exactly as it did.
 *
 *          What a platform cannot report is null, and a null never triggers anything: a browser with no battery API saves nothing for battery and loses
 *          nothing else. Saving never raises a cap or a level, only lowers it, and takes its own lowering off when the reason is gone.
 */
import type { PowerState } from '../device/types';

/** The level names a ceiling is given in, lowest first. */
export type PowerLevel = 'low' | 'medium' | 'high';

/** @experimental */
export interface PowerPolicy {
    /** Saves when the battery is below this share (0 to 1) and not charging. Default 0.2; 0 never saves for the battery. */
    lowBattery?: number;
    /** Saves under thermal pressure of this level or worse: 'serious' (default), 'critical', or 'never'. */
    thermal?: 'serious' | 'critical' | 'never';
    /** The frame cap while saving, in frames a second (default 30). Never raises a cap the game already set lower. */
    fps?: number;
    /** The quality level no level may exceed while saving (default 'medium'). */
    ceiling?: PowerLevel;
    /** The thermal pressure that also holds the level at 'low' and the cap at half of `fps`, never below 15 (default 'critical'; 'never' for none). */
    severe?: 'critical' | 'never';
}

/** What saving does, as the quality system applies it. */
export interface PowerDecision {
    saving: boolean;
    /** The frame cap, or 0 for none. */
    fps: number;
    /** The level ceiling, or null for none. */
    ceiling: PowerLevel | null;
    /** Why it is saving, or 'none'. */
    reason: 'none' | 'battery' | 'thermal' | 'critical';
}

const THERMAL_RANK = { nominal: 0, fair: 1, serious: 2, critical: 3 } as const;

/** What the policy says to do about the state the device is in. A null in the state is a reason that cannot hold. */
export function decidePower(state: PowerState, policy: PowerPolicy): PowerDecision {
    const none: PowerDecision = { saving: false, fps: 0, ceiling: null, reason: 'none' };
    const lowBattery = policy.lowBattery ?? 0.2;
    const thermal = state.thermal ? THERMAL_RANK[state.thermal] : 0;
    const thermalAt = policy.thermal === 'never' ? Infinity : policy.thermal === 'critical' ? 3 : 2;
    const severeAt = policy.severe === 'never' ? Infinity : 3;
    const lowPower = lowBattery > 0 && state.level !== null && state.level < lowBattery && state.charging === false;
    const hot = thermal >= thermalAt;
    if (!lowPower && !hot) return none;
    const fps = Math.max(policy.fps ?? 30, 1);
    const severe = thermal >= severeAt;
    return {
        saving: true,
        fps: severe ? Math.max(Math.round(fps / 2), 15) : fps,
        ceiling: severe ? 'low' : policy.ceiling ?? 'medium',
        reason: severe ? 'critical' : hot ? 'thermal' : 'battery',
    };
}

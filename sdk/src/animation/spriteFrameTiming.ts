// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

export function isSpriteFrameDuration(seconds: unknown): seconds is number {
    return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0;
}

/** Seconds a sprite frame occupies. Absent or invalid durations use the clip's default. */
export function spriteFrameDuration(seconds: unknown, fallback = 1 / 12): number {
    return isSpriteFrameDuration(seconds) ? seconds : fallback;
}

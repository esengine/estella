// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { TouchPoint } from './input';

// A host can reuse an id before sampling. Keep the old gesture's press edge
// on its point rather than looking it up under the replacement gesture's id.
const endedPresses = new WeakMap<TouchPoint, TouchPoint | null>();
export function recordTouchEnd(point: TouchPoint, press: TouchPoint | undefined): void {
    endedPresses.set(point, press ?? null);
}
export function touchEndPress(point: TouchPoint, fallback: TouchPoint | undefined): TouchPoint | undefined {
    const press = endedPresses.get(point);
    return press === undefined ? fallback : press ?? undefined;
}

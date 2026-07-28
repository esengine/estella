// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/controller/ui-gear.ts
 * @brief   UIGear — declarative "per-page value" bindings from a controller.
 *
 * Per-page overrides for ANY reflected field — not a fixed visual trio. Each
 * {@link GearBinding} says: "while controller C is on
 * page P, this component field should hold value V." One entity can carry many
 * bindings, each pointing at a different (controller, field) — so a single
 * element's colour follows the interaction controller while its position follows
 * a tab controller. The addressing mirrors Timeline's PropertyTrack (a `component`
 * name + a dot-path `property`) so both drive fields through the same reflection
 * writer. `pages` is a sparse map keyed by page name: a page with no entry leaves
 * the field untouched (the gear "doesn't care" on that page), and page names —
 * not indices — key it so reordering a controller's pages never misaligns values.
 */
import { defineComponent } from '../../ecs/component';
import type { Color, Vec2, Vec3 } from '../../types';
import type { EasingType } from '../../animation/Easing';

/**
 * A per-page value. Numbers, colours, and vectors interpolate when the binding
 * has a `tween`; strings, booleans (and anything else) always snap — e.g. a
 * `Text.content` gear that swaps the label per page. Colours/vectors are the
 * whole-field shape (e.g. `UIVisual.color` → a Color), matching how the inspector
 * and serialization store them.
 */
export type GearValue = number | boolean | string | Color | Vec2 | Vec3;

export interface GearTween {
    /** Easing curve applied across the transition (see {@link EasingType}). */
    easing: EasingType;
    /** Transition length in seconds; 0 (or absent tween) = snap. */
    duration: number;
}

export interface GearBinding {
    /** Name of the controller (resolved on self → nearest ancestor) that drives this. */
    controller: string;
    /** Target component name (e.g. "UIVisual", "Transform", "UINode"). */
    component: string;
    /** Dot-path within the component data (e.g. "color", "color.a", "scale.x"). */
    property: string;
    /** page name → value; a page absent here leaves the field alone on that page. */
    pages: Record<string, GearValue>;
    /** Optional interpolation on page change; omit for an instant snap. */
    tween?: GearTween;
}

export interface UIGearData {
    bindings: GearBinding[];
}

export const UIGear = defineComponent<UIGearData>('UIGear', {
    bindings: [],
});

/** Builder for a single {@link GearBinding} (keeps example/authoring code terse). */
export function gearBinding(
    controller: string,
    component: string,
    property: string,
    pages: Record<string, GearValue>,
    tween?: GearTween,
): GearBinding {
    return { controller, component, property, pages, ...(tween ? { tween } : {}) };
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    pointerBook.ts
 * @brief   Which pointer is over what, and which pointer is holding what.
 *
 *          A finger is a pointer of its own, so two on-screen buttons can be
 *          held at once. Folding every finger onto the synthesized mouse made
 *          the SECOND finger's release let go of the FIRST one's button, which
 *          is what a player feels as "the last press cancels the others".
 *
 *          The policy lives here, apart from the raycast and the ECS writes it
 *          drives, so it can be exercised without a world: what a press over
 *          nothing means, when a release is a click, and when an entity stops
 *          being pressed while another finger still holds it.
 */
import type { Entity } from '../../types';
import type { InputState } from '../../input/input';

/** One pointer this frame. `hovers` is false for a finger that is not down: a
 *  finger is over a control only while it touches the glass. */
export interface UiPointerSample {
    id: number;
    x: number;
    y: number;
    down: boolean;
    pressed: boolean;
    released: boolean;
    hovers: boolean;
}

export type UiPointerEventKind = 'hoverEnter' | 'hoverExit' | 'press' | 'release' | 'click';

export interface UiPointerEvent {
    kind: UiPointerEventKind;
    entity: Entity;
    /** The pointer it happened under — a click carries which finger made it. */
    pointer: number;
}

/** The pointer id the mouse (and the touch host's synthesized button) uses. No
 *  touch can collide with it: platform touch ids are non-negative. */
export const MOUSE_POINTER = -1;

/**
 * This frame's pointers. A touch host synthesizes mouse button 0 from the FIRST
 * finger, so while any finger is on the glass the fingers ARE the pointers —
 * counting both presses every control twice. A finger that lifted this frame is
 * still a pointer, carrying where it lifted: that is where its release lands.
 */
export function uiPointersOf(input: InputState): UiPointerSample[] {
    const pointers: UiPointerSample[] = [];
    if (input.touches.size > 0 || input.touchesEnded.size > 0) {
        for (const t of input.touches.values()) {
            pointers.push({
                id: t.id, x: t.x, y: t.y, down: true,
                pressed: input.touchesStarted.has(t.id), released: false, hovers: true,
            });
        }
        for (const t of input.touchesEnded.values()) {
            pointers.push({
                id: t.id, x: t.x, y: t.y, down: false, pressed: false, released: true, hovers: false,
            });
        }
        return pointers;
    }
    pointers.push({
        id: MOUSE_POINTER, x: input.mouseX, y: input.mouseY,
        down: input.isMouseButtonDown(0),
        pressed: input.isMouseButtonPressed(0),
        released: input.isMouseButtonReleased(0),
        hovers: true,
    });
    return pointers;
}

export class UiPointerBook {
    private hoveredBy_ = new Map<number, Entity>();
    private pressedBy_ = new Map<number, Entity>();

    /** Entities at least one pointer is over. */
    get hovered(): ReadonlySet<Entity> {
        return new Set(this.hoveredBy_.values());
    }

    /** Entities at least one pointer is holding down. */
    get pressed(): ReadonlySet<Entity> {
        return new Set(this.pressedBy_.values());
    }

    /** What this pointer is holding, if anything. */
    pressedByPointer(pointer: number): Entity | null {
        return this.pressedBy_.get(pointer) ?? null;
    }

    /**
     * Fold this frame's pointers in and answer what happened, in the order it
     * happened. `hit` is the entity under a pointer (null for none) and `alive`
     * says whether an entity the book remembers still exists — a control
     * despawned mid-press owes no events but must not stay held.
     */
    step(
        pointers: readonly UiPointerSample[],
        hit: (pointer: UiPointerSample) => Entity | null,
        alive: (entity: Entity) => boolean,
    ): UiPointerEvent[] {
        const out: UiPointerEvent[] = [];
        const live = new Set<number>();

        for (const p of pointers) {
            live.add(p.id);
            const under = hit(p);

            const was = this.hoveredBy_.get(p.id) ?? null;
            const now = p.hovers ? under : null;
            if (was !== now) {
                if (was !== null && alive(was)) out.push({ kind: 'hoverExit', entity: was, pointer: p.id });
                if (now !== null) out.push({ kind: 'hoverEnter', entity: now, pointer: p.id });
                if (now === null) this.hoveredBy_.delete(p.id);
                else this.hoveredBy_.set(p.id, now);
            }

            if (p.pressed && under !== null) {
                this.pressedBy_.set(p.id, under);
                out.push({ kind: 'press', entity: under, pointer: p.id });
            }

            // A pointer that is no longer down releases what it took, whether or
            // not this is the frame it lifted on.
            if (!p.down && this.pressedBy_.has(p.id)) {
                const held = this.pressedBy_.get(p.id)!;
                this.pressedBy_.delete(p.id);
                if (alive(held)) {
                    out.push({ kind: 'release', entity: held, pointer: p.id });
                    // A click is a release over the control this pointer took —
                    // sliding off and letting go is a release and nothing more.
                    if (held === under) out.push({ kind: 'click', entity: held, pointer: p.id });
                }
            }
        }

        // A pointer that vanished without lifting — a cancelled gesture, a mouse
        // that left the window — still owes its exit and its release.
        for (const [id, entity] of [...this.hoveredBy_]) {
            if (live.has(id)) continue;
            this.hoveredBy_.delete(id);
            if (alive(entity)) out.push({ kind: 'hoverExit', entity, pointer: id });
        }
        for (const [id, entity] of [...this.pressedBy_]) {
            if (live.has(id)) continue;
            this.pressedBy_.delete(id);
            if (alive(entity)) out.push({ kind: 'release', entity, pointer: id });
        }

        // A control that died under a pointer stops being held, silently.
        for (const [id, entity] of [...this.hoveredBy_]) if (!alive(entity)) this.hoveredBy_.delete(id);
        for (const [id, entity] of [...this.pressedBy_]) if (!alive(entity)) this.pressedBy_.delete(id);

        return out;
    }

    /** Forget every pointer — a realm tearing its UI down owes no events. */
    clear(): void {
        this.hoveredBy_.clear();
        this.pressedBy_.clear();
    }
}

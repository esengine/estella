// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    foliageContacts.ts
 * @brief   Grass that parts for a `FoliageContact` and stands up again behind it: four places a Foliage material is told about each frame.
 *
 * @details A field of grass is one mesh a cell, so the bend can only be worked out where the vertices are. The shader takes four contacts, and this
 *          fills them: each contact nearest what is looked from, and where one has left, a place that shrinks away over its `recovery`, so a character
 *          leaves a parting that closes behind it rather than grass snapping up at its heels. It runs in play only; in the editor a material asset is
 *          left as authored, so looking at a scene never saves one.
 */
import type { App } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { Res, Time, type TimeData } from '../ecs/resource';
import { Query } from '../ecs/query';
import { Transform, type TransformData } from '../ecs/component';
import { isEditor, isPlayMode } from '../ecs/env';
import { Material } from '../render/material';
import { chunksOf } from '../residency/chunks';
import type { Entity } from '../types';
import { FoliageContact, type FoliageContactData } from './plantInteraction';

/** The most places the Foliage shader parts plants around at once. */
export const FOLIAGE_CONTACTS = 4;
const UNIFORMS = Array.from({ length: FOLIAGE_CONTACTS }, (_, i) => `u_contact${i}`);

/** A place plants are parted around: where, and how far it reaches now. */
export interface ContactPlace { x: number; y: number; z: number; w: number }

/** A place a contact left, closing. */
interface ContactTrail { x: number; y: number; z: number; reach: number; recovery: number; age: number }

/** What is kept of the contacts between frames: the places they left, and where each was when it last left one. */
export interface ContactMemory {
    trails: Map<number, ContactTrail[]>;
    last: Map<number, { x: number; y: number; z: number }>;
}

export const contactMemory = (): ContactMemory => ({ trails: new Map(), last: new Map() });

/** How far behind itself a contact leaves its last place, as a share of its reach. */
const TRAIL_STEP = 0.75;

/**
 * Follows the contacts for one frame: each one that has moved on leaves a place behind it, and what was left shrinks.
 * The answer is the contacts themselves first, nearest `focus`, then what they left, newest first, as many as the shader has room for. Unused places reach nowhere.
 */
export function contactPlaces(
    contacts: readonly { id: number; x: number; y: number; z: number; radius: number; strength: number; recovery: number }[],
    memory: ContactMemory, focus: { x: number; z: number } | null, dt: number,
): ContactPlace[] {
    const { trails, last: lastAt } = memory;
    const live: { place: ContactPlace; d: number }[] = [];
    for (const c of contacts) {
        const reach = c.radius * c.strength;
        if (reach <= 0) continue;
        const was = lastAt.get(c.id);
        if (!was) lastAt.set(c.id, { x: c.x, y: c.y, z: c.z });
        else if (Math.hypot(c.x - was.x, c.z - was.z) > reach * TRAIL_STEP) {
            let list = trails.get(c.id);
            if (!list) trails.set(c.id, list = []);
            list.push({ x: was.x, y: was.y, z: was.z, reach, recovery: c.recovery, age: 0 });
            was.x = c.x; was.y = c.y; was.z = c.z;
        }
        live.push({ place: { x: c.x, y: c.y, z: c.z, w: reach }, d: focus ? Math.hypot(c.x - focus.x, c.z - focus.z) : 0 });
    }
    const left: { place: ContactPlace; age: number }[] = [];
    for (const [id, list] of trails) {
        for (let i = list.length - 1; i >= 0; i--) {
            const t = list[i]!;
            t.age += dt;
            const remaining = t.recovery > 0 ? 1 - t.age / t.recovery : 0;
            if (remaining <= 0) { list.splice(i, 1); continue; }
            left.push({ place: { x: t.x, y: t.y, z: t.z, w: t.reach * remaining }, age: t.age });
        }
        if (list.length === 0) trails.delete(id);
    }
    live.sort((a, b) => a.d - b.d);
    left.sort((a, b) => a.age - b.age);
    const out: ContactPlace[] = [...live.map((l) => l.place), ...left.map((l) => l.place)].slice(0, FOLIAGE_CONTACTS);
    while (out.length < FOLIAGE_CONTACTS) out.push({ x: 0, y: 0, z: 0, w: 0 });
    return out;
}

/** Installs the system that tells Foliage materials about the contacts. Returns what clears them. */
export function installFoliageContacts(app: App): () => void {
    const memory = contactMemory();
    let written = false;
    const clear = (): void => {
        if (!written) return;
        written = false;
        memory.trails.clear();
        memory.last.clear();
        for (const material of Material.materialsDeclaring(UNIFORMS[0]!)) {
            for (const name of UNIFORMS) Material.setUniform(material, name, { x: 0, y: 0, z: 0, w: 0 });
        }
    };
    const system = defineSystem(
        [Query(FoliageContact, Transform), Res(Time)],
        (query: Iterable<[Entity, FoliageContactData, TransformData]>, time: TimeData) => {
            if (isEditor() && !isPlayMode()) { clear(); return; }
            const contacts = [];
            for (const [entity, contact, transform] of query) {
                if (!contact.enabled) continue;
                const p = transform.worldPosition;
                contacts.push({ id: entity as number, x: p.x, y: p.y, z: p.z, radius: contact.radius, strength: contact.strength, recovery: contact.recovery });
            }
            const source = chunksOf(app).sources_()[0];
            const places = contactPlaces(contacts, memory, source ? { x: source.x, z: source.z } : null, time.delta);
            written = true;
            for (const material of Material.materialsDeclaring(UNIFORMS[0]!)) {
                for (let i = 0; i < FOLIAGE_CONTACTS; i++) Material.setUniform(material, UNIFORMS[i]!, places[i]!);
            }
        },
        { name: 'FoliageContactSystem' },
    );
    // The frame after the last one goes still runs, to clear what it wrote.
    app.addSystemToSchedule(Schedule.PostUpdate, system, { activeWhen: [FoliageContact] });
    return clear;
}

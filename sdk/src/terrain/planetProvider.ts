// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    planetProvider.ts
 * @brief   Ground on a sphere made by a generator a game names: one function of a direction, versioned, the same on every machine.
 *
 * @details The provider of flat ground (provider.ts) answers for a square of world positions; this one answers for directions from a planet's
 *          centre, because a sphere has no x and z. It is handed the unit directions to sample and the radius they are on, and gives back the height
 *          above that radius at each and, if it paints the ground, four layer weights. The same rules hold: every sample is the same function read
 *          at another direction, so two pages that share an edge share its samples; a version names an algorithm for good.
 */
import type { TerrainSamples } from './provider';

/** What a planet provider answers: the heights and paint of a terrain's, and the values of the fields it names, a sample after another. */
export interface PlanetSamples extends TerrainSamples {
    /** `fields.length` values a sample, in the order the provider's `fields` names them. */
    fields?: Float32Array;
}

/** What a provider is asked to sample: a list of unit directions from the planet's centre. */
export interface PlanetRegion {
    /** The world (a planet) the ground belongs to, as the game names it. */
    world: string;
    seed: number;
    /** The generator version the planet was made with. */
    version: number;
    /** The planet's radius in metres: a provider reasons in metres, a direction is only where. */
    radius: number;
    /** `count` unit directions, x, y, z one after the other. */
    directions: Float32Array;
    count: number;
}

/** A generator of ground on a sphere. */
export interface PlanetProvider {
    /** The name a Planet asks for it by. */
    readonly id: string;
    /** The generator versions it can still make. */
    readonly versions: readonly number[];
    /** The least and most height above the radius its ground can have for this seed, version and radius: what the GPU encodes heights over. */
    range(seed: number, version: number, radius: number): [number, number];
    /**
     * The names of fields the ground has beyond its height and paint, which a generated world reads as part of its environment (an ecology: how much of
     * a place is a wetland). A game's own generator decides them, so the ground that is drawn and what grows on it come from one function.
     */
    readonly fields?: readonly string[];
    /**
     * The text of a self-contained module (plain JavaScript, no imports) whose default export is this provider's `id`, `versions`, `fields` and `sample`, so that
     * a worker can load the generator and a generated world can be laid out off the main thread. Absent, the world is laid out on the main thread.
     */
    readonly workerSource?: string;
    /** The ground in the directions asked: heights in metres above the radius, the layer weights if it paints, and its fields if it has any. May answer later. */
    sample(region: PlanetRegion): PlanetSamples | Promise<PlanetSamples>;
}

const providers_ = /* @__PURE__ */ new Map<string, PlanetProvider>();
let revision_ = 0;

/**
 * Makes `provider` available to every Planet that names it. A second provider under the same id replaces the first. A planet that named one not yet
 * registered (a script registers it after the scene loaded) is made once it is.
 * @experimental
 */
export function registerPlanetProvider(provider: PlanetProvider): void {
    providers_.set(provider.id, provider);
    revision_++;
}

/** The provider registered under `id`, if any. */
export function planetProvider(id: string): PlanetProvider | undefined {
    return providers_.get(id);
}

/** @internal Bumped on every registration, so a planet whose provider was missing asks again. */
export function planetProvidersRevision(): number {
    return revision_;
}

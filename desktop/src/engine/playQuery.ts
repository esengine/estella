// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    playQuery.ts
 * @brief   Reading the RUNNING game by name, in shapes an agent can act on
 *          without writing code to get them.
 *
 * The realm always had a probe — arbitrary JS with `find`/`get`/`resource` in
 * scope — and it is the escape hatch, confirmed because the code is the model's.
 * What it is a poor door for is the ordinary questions, which every run asks and
 * every run had to re-derive: what IS this entity, what state does the game
 * hold, what runs each frame. Named, they cost no confirmation and no guessing.
 *
 * The engine holds exactly three kinds of state, and these follow them rather
 * than inventing a taxonomy: entities carrying components, resources belonging
 * to no entity, and the schedule. Physics, AI, animation and UI state are all
 * COMPONENTS, so they arrive with the entity rather than needing a query each.
 *
 * Pure over {@link Realm} so the shaping is testable without a running game;
 * playHost implements that interface from its `app`.
 */

/** What a query needs of a running game. The host binds it to `app`/`world`. */
export interface Realm {
  entities(): number[];
  /** Component names on one entity, structural and transient ones excluded. */
  componentsOf(entity: number): string[];
  /** One component's live data, or null when the entity does not have it. */
  read(entity: number, type: string): unknown;
  /** The structural three, which `componentsOf` leaves out. */
  nameOf(entity: number): string | null;
  parentOf(entity: number): number | null;
  childrenOf(entity: number): number[];
  /** Every resource, by the name its `defineResource` was given. */
  resources(): Array<[string, unknown]>;
  /** Per-system and per-phase cost, or null when nothing is recording. */
  timings(): { systems: ReadonlyMap<string, number> | null; phases: ReadonlyMap<string, number> | null };
  entityCount(): number;
}

/**
 * A value too large to send whole, replaced in ITS place. A reply cut by the
 * transport's budget is cut at a byte offset, leaving the caller half a JSON
 * document and no way to tell which field went missing.
 */
export const MAX_VALUE_JSON = 4000;

export function bounded(value: unknown): unknown {
  let json: string;
  try {
    json = JSON.stringify(value) ?? 'null';
  } catch {
    return { unserializable: true };
  }
  if (json.length <= MAX_VALUE_JSON) return value;
  return {
    truncated: true,
    bytes: json.length,
    keys: value && typeof value === 'object' ? Object.keys(value) : [],
  };
}

export interface EntityInspection {
  entity: number;
  name: string | null;
  parent: number | null;
  children: number[];
  components: Record<string, unknown>;
}

/**
 * One entity, WHOLE. `get` answers about a component you can already name,
 * which is the second question; this is the first.
 */
export function inspectEntity(realm: Realm, entity: number): EntityInspection {
  if (!realm.entities().includes(entity)) {
    throw new Error(`no entity ${entity} in this realm — find_entities lists the ones there are`);
  }
  const components: Record<string, unknown> = {};
  for (const type of realm.componentsOf(entity)) components[type] = bounded(realm.read(entity, type));
  return {
    entity,
    name: realm.nameOf(entity),
    parent: realm.parentOf(entity),
    children: realm.childrenOf(entity),
    components,
  };
}

export interface EntityFilter {
  component?: string;
  name?: string;
  limit?: number;
}

export interface EntityList {
  total: number;
  entities: Array<{ entity: number; name: string | null; components: string[] }>;
  truncatedAt?: number;
}

/** How many entities one answer carries. A world can hold thousands; a reply
 *  that carried them all would spend the turn's context on a list. */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * Which entities there are, and what each carries — so the answer says which to
 * inspect, not only how many. `total` counts every match and `entities` is what
 * fitted: a capped list read as the whole world is how a search concludes
 * something is not there.
 */
export function findEntities(realm: Realm, filter: EntityFilter = {}): EntityList {
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(filter.limit ?? DEFAULT_LIMIT)));
  const needle = filter.name?.toLowerCase();
  const out: EntityList['entities'] = [];
  let total = 0;
  for (const entity of realm.entities()) {
    const components = realm.componentsOf(entity);
    if (filter.component && !components.includes(filter.component)) continue;
    const name = realm.nameOf(entity);
    if (needle && !(name ?? '').toLowerCase().includes(needle)) continue;
    total++;
    if (out.length < limit) out.push({ entity, name, components });
  }
  return { total, entities: out, ...(total > out.length ? { truncatedAt: limit } : {}) };
}

/** Every resource with its value — the state that belongs to no entity, all of
 *  it, so there is no name to guess first. */
export function readResources(realm: Realm): { resources: Record<string, unknown> } {
  const resources: Record<string, unknown> = {};
  for (const [name, value] of realm.resources()) if (name) resources[name] = bounded(value);
  return { resources };
}

export interface SystemReport {
  entities: number;
  systems: Array<{ name: string; ms: number }> | null;
  phases: Array<{ name: string; ms: number }> | null;
  note?: string;
}

/**
 * What runs each frame and what it cost, worst first.
 *
 * Null rather than an empty list when nothing is recording: "nothing ran" and
 * "nobody was counting" are opposite answers, and an empty list reads as the
 * first one.
 */
export function readSystems(realm: Realm): SystemReport {
  const { systems, phases } = realm.timings();
  const rows = (m: ReadonlyMap<string, number> | null) =>
    (m === null ? null : [...m].map(([name, ms]) => ({ name, ms })).sort((a, b) => b.ms - a.ms));
  return {
    entities: realm.entityCount(),
    systems: rows(systems),
    phases: rows(phases),
    ...(systems === null
      ? { note: 'timings are not being recorded — this realm has stats off, so the lists are absent rather than empty' }
      : {}),
  };
}

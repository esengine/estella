// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  prefabEnvironment.ts
 * @brief The editing ENVIRONMENT: entities the editor puts around the thing being
 *        edited so it reads the way it will in a scene, without ever becoming part
 *        of it.
 *
 * Prefab Mode is the case that needs one. A UI node's box is authored RELATIVE to
 * its parent — fractional insets plus pixel margins — so a UI prefab opened on its
 * own has nothing above it for those fractions to resolve against: the tree
 * collapses into near-zero boxes at the origin, and the selection outlines and gizmo
 * pivots that read those boxes collapse with it. A scene hosts UI under a Canvas;
 * Prefab Mode has no scene, so it supplies the same Canvas as an environment.
 *
 * The environment lives in the DOCUMENT, so the one model→World projection builds it
 * like any other entity, and carries an editor-only `env` flag — the single mark
 * that keeps it out of the saved asset, the Outliner, and viewport picking.
 *
 * Pure data (no World, no store, no project), so the splicing rules are unit-tested
 * on their own.
 */

/**
 * The document-entity shape the environment reads and rewrites: structurally the
 * scene document's entity, plus the `env` flag. Loose on `components` so both a
 * flattened prefab's entities and a serialized model's satisfy it.
 */
export interface DocumentEntity {
  id: number;
  name: string;
  parent: number | null;
  children: number[];
  /** `data` is carried but not read here — this module only asks WHICH components
   *  an entity has. Declared so authored scene data types as itself. */
  components: readonly { type: string; data?: unknown }[];
  visible?: boolean;
  /** Marks an environment entity. Set by {@link hostPrefab}; never on authored data. */
  env?: boolean;
}

/** The component that gives UI nodes a box to resolve against. */
const UI_HOST = 'Canvas';
/** The component that needs one. */
const UI_NODE = 'UINode';

/** Whether an entity belongs to the editing environment rather than to the document
 *  being authored. Reads the flag off any entity shape — a scene document's entity type
 *  doesn't declare it, the same way it doesn't declare `hidden` / `locked` / `folder`. */
export function isEnvironmentEntity(e: object): boolean {
  return (e as { env?: boolean }).env === true;
}

/**
 * Whether a prefab needs the Canvas host: it carries UI boxes and brings no Canvas
 * of its own (a prefab that ships one already hosts itself, as a full-screen HUD
 * prefab does).
 */
export function needsUIHost(entities: readonly DocumentEntity[]): boolean {
  const carries = (type: string): boolean => entities.some((e) => e.components.some((c) => c.type === type));
  return carries(UI_NODE) && !carries(UI_HOST);
}

/**
 * Splice a host subtree in above a prefab: the host's root adopts the prefab's root
 * and every host entity is flagged `env`. The host leads the returned list because
 * document order is spawn order — a parent has to precede its children.
 */
export function hostPrefab<T extends DocumentEntity>(
  prefab: { entities: readonly T[]; rootId: number },
  host: { entities: readonly T[]; rootId: number },
): T[] {
  const environment = host.entities.map((e) =>
    e.id === host.rootId
      ? ({ ...e, env: true, children: [...e.children, prefab.rootId] } as T)
      : ({ ...e, env: true } as T),
  );
  const hosted = prefab.entities.map((e) => (e.id === prefab.rootId ? ({ ...e, parent: host.rootId } as T) : e));
  return [...environment, ...hosted];
}

/**
 * The authored half of a document: environment entities dropped, and whatever they
 * parented re-rooted. Extraction therefore sees exactly the prefab the user opened,
 * so the environment cannot reach the `.esprefab` — nor be minted an identity in it.
 */
export function authoredEntities<T extends DocumentEntity>(entities: readonly T[]): T[] {
  const environment = new Set(entities.filter(isEnvironmentEntity).map((e) => e.id));
  if (environment.size === 0) return [...entities];
  return entities
    .filter((e) => !environment.has(e.id))
    .map((e) => ({
      ...e,
      parent: e.parent != null && environment.has(e.parent) ? null : e.parent,
      children: e.children.filter((c) => !environment.has(c)),
    }) as T);
}

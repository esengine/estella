// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    actionCatalog.ts
 * @brief   The action/condition vocabulary the editor can offer, from BOTH
 *          sources: the live `aiRegistry` (engine builtins, registered when the
 *          edit realm's plugins built) and the open project's own registrations.
 *
 * The editor's main realm never executes project code, so a game's
 * `registerAction('game.startRun', …)` cannot be in the live registry — it
 * arrives as an artifact instead (`.esengine/cache/schemas.json`, written by the
 * same pure-node extractor that already reports the project's components:
 * schema-as-artifact, applied to actions).
 *
 * Everything that offers a name — the FSM state hooks, the BT leaves, an event
 * wire — asks HERE rather than the registry directly, so all three see one
 * vocabulary. A name in neither source is still legal to type: the palettes have
 * always allowed free text, because a game may register more at runtime.
 */
import { aiRegistry } from 'esengine';
import type { AiParamDef } from 'esengine';

/** A project action as serialized in `schemas.json` (see electron/extractSchemas.ts). */
export interface ProjectActionSchema {
  name: string;
  params?: AiParamDef[];
  separator?: string;
}

const projectActions = new Map<string, ProjectActionSchema>();
let projectConditions: string[] = [];

const listeners = new Set<() => void>();
let revision = 0;

/** Subscribe to catalog changes (project open / re-extract), for useSyncExternalStore. */
export const subscribeActionCatalog = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};
export const getActionCatalogRevision = (): number => revision;

/** Replace the project half of the catalog. Notifies subscribers. */
export function setProjectActions(actions: readonly ProjectActionSchema[], conditions: readonly string[]): void {
  projectActions.clear();
  for (const a of actions) projectActions.set(a.name, a);
  projectConditions = [...conditions];
  revision++;
  for (const l of listeners) l();
}

/** Every offerable action name — engine builtins first, then the project's. */
export function actionNames(): string[] {
  const names = aiRegistry.actionNames();
  const seen = new Set(names);
  for (const name of projectActions.keys()) if (!seen.has(name)) names.push(name);
  return names;
}

export function conditionNames(): string[] {
  const names = aiRegistry.conditionNames();
  const seen = new Set(names);
  for (const name of projectConditions) if (!seen.has(name)) names.push(name);
  return names;
}

/** Whether the catalog knows `name` at all (an unknown name is still authorable). */
export function isKnownAction(name: string): boolean {
  return aiRegistry.hasAction(name) || projectActions.has(name);
}

/**
 * The parameters `name` declares. The live registry wins: if the edit realm has
 * the action, its declaration is first-hand, and the artifact could be one
 * extract behind.
 */
export function actionParams(name: string): readonly AiParamDef[] {
  if (aiRegistry.hasAction(name)) return aiRegistry.getActionParams(name);
  return projectActions.get(name)?.params ?? [];
}

/** The separator joining `name`'s parameters in the canonical string form. */
export function actionSeparator(name: string): string {
  if (aiRegistry.hasAction(name)) return aiRegistry.getActionSeparator(name);
  return projectActions.get(name)?.separator ?? ':';
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    paramOptions.ts
 * @brief   Choice providers for an action parameter declared with an
 *          `optionsSource` — the dynamic-enum escape hatch, for actions.
 *
 * A declared parameter can name a source instead of listing options, because the
 * real choices depend on the scene: which controllers the target entity resolves,
 * which pages the chosen controller has. This is the same shape (and for the same
 * reason) as `setEnumSource` for component fields — one keyed provider map,
 * consulted by whoever renders the control. Separate because the context differs:
 * a field's source sees a component, an action's sees a row's target + sibling
 * parameters. Kept out of the SDK registry on purpose: the sdk declares WHAT a
 * parameter is, the editor knows what is on screen to choose from.
 */
import { resolveControllers } from '@/controller/controllerModel';
import type { EntityId } from '@/types';
import type { AiParamValue } from 'esengine';

/** One choice: the value stored, and the label shown when it reads differently. */
export interface AiParamOption { value: string; label?: string }

export interface AiParamOptionContext {
  /** The entity the action will run on — a row's resolved target, not its owner. */
  entityId: EntityId;
  /** The row's current parameter values, for a parameter that narrows a sibling. */
  params: Readonly<Record<string, AiParamValue>>;
}

export type AiParamOptionProvider = (ctx: AiParamOptionContext) => readonly (string | AiParamOption)[];

const providers = new Map<string, AiParamOptionProvider>();

export function registerAiParamOptions(source: string, provider: AiParamOptionProvider): void {
  providers.set(source, provider);
}

/** Options for an `optionsSource`, or null when unknown / nothing to offer. */
export function aiParamOptions(source: string, ctx: AiParamOptionContext): AiParamOption[] | null {
  const opts = providers.get(source)?.(ctx);
  if (!opts || opts.length === 0) return null;
  return opts.map((o) => (typeof o === 'string' ? { value: o } : o));
}

// — Engine-provided sources —
// Registered here (module load) rather than by any one panel, so the Events
// section and the FSM/BT editors see the same list.

/** Every controller the target entity resolves — its own plus its ancestors'. */
registerAiParamOptions('uiController', ({ entityId }) =>
  resolveControllers(entityId).map((rc) => ({
    value: rc.ctrl.name,
    label: rc.inherited ? `${rc.ctrl.name} · ${rc.ownerName}` : rc.ctrl.name,
  })),
);

/** The pages of whichever controller the sibling `controller` parameter names. */
registerAiParamOptions('uiControllerPage', ({ entityId, params }) => {
  const name = typeof params.controller === 'string' ? params.controller : '';
  if (!name) return [];
  return resolveControllers(entityId).find((rc) => rc.ctrl.name === name)?.ctrl.pages ?? [];
});

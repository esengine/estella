// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    registry.ts
 * @brief   AiRegistry — names → leaf action/condition functions, plus the
 *          parameters those names take.
 *
 * The binding between code-free data (`.esfsm`/`.esbt`/`EventBinding` referencing
 * names) and real gameplay logic. Generic over the context type `Ctx` so the pure
 * core stays wasm-free; the engine layer instantiates it with a concrete AiContext
 * (a BehaviorContext superset) and exposes the `registerAction`/`registerCondition`
 * free functions over a shared singleton.
 *
 * An action may DECLARE its parameters ({@link AiParamDef}), which is what lets an
 * editor render real controls instead of one free-text box. Declaring them changes
 * nothing on disk: every action keeps a canonical string form (`"tabs:settings"`),
 * and {@link invokeAction} projects between the two in both directions — so
 * authored data written before the declaration still runs, data written as
 * parameters still reaches an action that only reads `arg`, and the FSM, the
 * behaviour tree and an event wire all dispatch through one path.
 */

import type { Blackboard } from './Blackboard';
import type { Status } from '../status';

/** A parameter value as it is authored and serialized. */
export type AiParamValue = string | number | boolean;
/** Declared parameters of one action reference, keyed by {@link AiParamDef.name}. */
export type AiParams = Readonly<Record<string, AiParamValue>>;

// Returns Status (a BT leaf that may run across frames) or nothing (a one-shot
// FSM action). FSM ignores the return; BT reads it, treating void as Success.
// `arg` is the canonical string form of the reference (what authored data has
// always carried); `params` is the same input keyed by declared parameter name,
// empty for an action that declares none. An action reads whichever it prefers —
// both are always supplied, so neither channel is a second way to be wrong.
export type AiAction<Ctx> = (
    ctx: Ctx,
    bb: Blackboard,
    arg?: string,
    params?: AiParams,
) => void | Status;
export type AiCondition<Ctx> = (ctx: Ctx, bb: Blackboard) => boolean;

/**
 * One declared parameter. The vocabulary is deliberately the component-field one
 * (`enum` options, numeric range, tooltip) so an editor renders action parameters
 * with the very same controls it renders component fields with — including
 * `optionsSource`, the dynamic-enum escape hatch for choices that depend on the
 * entity (a controller's name, one of its pages).
 */
export interface AiParamDef {
    /** Key in the params record, and the fallback label. */
    name: string;
    /** Control kind. Asset/entity references are deliberately absent until the
     *  cook's discovery pass and the scene's entity remapper can see them. */
    type: 'string' | 'number' | 'bool' | 'enum';
    /** Human label; defaults to a prettified `name`. */
    label?: string;
    tooltip?: string;
    /** Fixed choices for `type: 'enum'`. */
    options?: readonly { label: string; value: string }[];
    /** Editor-resolved choice provider (e.g. `'uiController'`, `'uiControllerPage'`). */
    optionsSource?: string;
    min?: number;
    max?: number;
    step?: number;
}

/** An action registered with metadata rather than as a bare function. */
export interface AiActionSpec<Ctx> {
    run: AiAction<Ctx>;
    /** Declared parameters, in canonical string order. */
    params?: readonly AiParamDef[];
    /**
     * Separator joining the parameters in the canonical string form. Default
     * `':'` — the convention authored data already uses (`"tabs:settings"`).
     * The LAST parameter absorbs any remaining separators, so a value may
     * contain one.
     */
    separator?: string;
}

interface ActionEntry<Ctx> {
    fn: AiAction<Ctx>;
    params: readonly AiParamDef[];
    separator: string;
}

export class AiRegistry<Ctx = unknown> {
    private actions = new Map<string, ActionEntry<Ctx>>();
    private conditions = new Map<string, AiCondition<Ctx>>();

    /**
     * Register `name`, either as a bare function (input is the raw `arg` string,
     * as it always was) or with declared parameters.
     *
     * A declared action is stored WRAPPED in the projection, so both shapes are
     * filled in no matter how it is reached — {@link invokeAction}, a direct
     * `getAction(name)(ctx, bb, "tabs:settings")`, anything. Normalizing once
     * here is what keeps the two forms from becoming two contracts.
     */
    registerAction(name: string, fn: AiAction<Ctx> | AiActionSpec<Ctx>): void {
        const spec = typeof fn === 'function' ? { run: fn } : fn;
        const params = spec.params ?? [];
        const separator = spec.separator ?? ':';
        const run = spec.run;
        const wrapped: AiAction<Ctx> = params.length === 0
            ? run // no declaration, no projection — byte-identical behaviour
            : (ctx, bb, arg, given) => {
                const named = given && Object.keys(given).length > 0
                    ? given
                    : parseActionArg(arg, params, separator);
                return run(ctx, bb, arg ?? formatActionArg(named, params, separator), named);
            };
        this.actions.set(name, { fn: wrapped, params, separator });
    }

    registerCondition(name: string, fn: AiCondition<Ctx>): void {
        this.conditions.set(name, fn);
    }

    getAction(name: string): AiAction<Ctx> | undefined {
        return this.actions.get(name)?.fn;
    }

    /** The declared parameters of `name` (empty when it takes a bare string). */
    getActionParams(name: string): readonly AiParamDef[] {
        return this.actions.get(name)?.params ?? [];
    }

    /** The separator joining `name`'s parameters in the canonical string form. */
    getActionSeparator(name: string): string {
        return this.actions.get(name)?.separator ?? ':';
    }

    getCondition(name: string): AiCondition<Ctx> | undefined {
        return this.conditions.get(name);
    }

    hasAction(name: string): boolean {
        return this.actions.has(name);
    }

    hasCondition(name: string): boolean {
        return this.conditions.has(name);
    }

    /** Registered action/condition names, for editor palettes. */
    actionNames(): string[] {
        return [...this.actions.keys()];
    }

    conditionNames(): string[] {
        return [...this.conditions.keys()];
    }

    /** Drop all registrations (tests / hot-reload). */
    clear(): void {
        this.actions.clear();
        this.conditions.clear();
    }
}

/** How an authored reference carries its input: a string, named values, or both. */
export interface AiActionInput {
    arg?: string;
    params?: Readonly<Record<string, AiParamValue>>;
}

/**
 * Split a canonical string into declared parameters. The last parameter absorbs
 * the remainder, so `"tabs:a:b"` against `[controller, page]` yields
 * `{controller: 'tabs', page: 'a:b'}` — the same rule `ui.setPage` hand-rolled.
 * Numbers and booleans are coerced to their declared type.
 */
export function parseActionArg(
    arg: string | undefined,
    params: readonly AiParamDef[],
    separator = ':',
): Record<string, AiParamValue> {
    const out: Record<string, AiParamValue> = {};
    if (!arg || params.length === 0) return out;
    const parts: string[] = [];
    let rest = arg;
    for (let i = 0; i < params.length - 1; i++) {
        const at = rest.indexOf(separator);
        if (at < 0) break;
        parts.push(rest.slice(0, at));
        rest = rest.slice(at + separator.length);
    }
    parts.push(rest);
    for (let i = 0; i < parts.length && i < params.length; i++) {
        out[params[i].name] = coerce(parts[i], params[i].type);
    }
    return out;
}

/**
 * Join declared parameters back into the canonical string — so data authored as
 * parameters still reaches an action (or a tool) that only speaks `arg`.
 * Trailing empties are dropped, keeping `"tabs"` rather than `"tabs:"`.
 */
export function formatActionArg(
    params: Readonly<Record<string, AiParamValue>> | undefined,
    defs: readonly AiParamDef[],
    separator = ':',
): string | undefined {
    if (!params || defs.length === 0) return undefined;
    const parts = defs.map((d) => {
        const v = params[d.name];
        return v === undefined || v === null ? '' : String(v);
    });
    while (parts.length && parts[parts.length - 1] === '') parts.pop();
    return parts.length ? parts.join(separator) : undefined;
}

/**
 * The one dispatch path for a named action, shared by the FSM, the behaviour
 * tree and event wires: resolve the name and hand it whichever form the authored
 * data carries — the registration wrapper fills in the other. An unknown name is
 * a silent no-op, so each caller reports it in its own vocabulary (a BT leaf
 * fails, an event wire warns).
 */
export function invokeAction<Ctx>(
    registry: AiRegistry<Ctx>,
    name: string,
    ctx: Ctx,
    bb: Blackboard,
    input: AiActionInput = {},
): void | Status {
    const fn = registry.getAction(name);
    if (!fn) return undefined;
    // Named values win over the string when the row carries both.
    const named = input.params && Object.keys(input.params).length > 0 ? input.params : undefined;
    const arg = named
        ? formatActionArg(named, registry.getActionParams(name), registry.getActionSeparator(name)) ?? input.arg
        : input.arg;
    return fn(ctx, bb, arg, named);
}

function coerce(raw: string, type: AiParamDef['type']): AiParamValue {
    if (type === 'number') {
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
    }
    if (type === 'bool') return raw === 'true' || raw === '1';
    return raw;
}

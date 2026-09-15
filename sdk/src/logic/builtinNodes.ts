// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    builtinNodes.ts
 * @brief   The engine's own value vocabulary — maths, comparison, logic, reading
 *          the world — registered as ordinary names.
 *
 * Deliberately not built into the interpreter: an addition node reaches the
 * graph through the same door a project's own `registerValue` does, so there is
 * no privileged set to imitate. Namespaced to stay clear of game names, and a
 * name already present is never overwritten, so game code wins whatever the
 * registration order was.
 *
 * Everything here is `pure`: it answers a question and changes nothing. That is
 * also what keeps it out of the FSM and behaviour-tree palettes, where a name
 * that changes nothing would be a hook that does nothing.
 */

import { aiRegistry, type AiContext } from '../ai/fsm/AiContext';
import type { AiOutputDef, AiOutputs, AiParamDef, AiParams, AiTouches } from '../ai/fsm/registry';
import { getEntityProperty, setEntityProperty } from '../ecs/propertyPath';
import { Name } from '../ecs/component';
import type { Entity } from '../types';
import { log } from '../util/logger';

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);
const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

const N = (name: string): AiParamDef => ({ name, type: 'number' });
const B = (name: string): AiParamDef => ({ name, type: 'bool' });
const OUT_N: AiOutputDef[] = [{ name: 'result', type: 'number' }];
const OUT_B: AiOutputDef[] = [{ name: 'result', type: 'bool' }];
const OUT_S: AiOutputDef[] = [{ name: 'result', type: 'string' }];

function value(
    name: string,
    params: readonly AiParamDef[],
    outputs: readonly AiOutputDef[],
    evaluate: (ctx: AiContext, params: AiParams, out: AiOutputs) => void,
    touches?: AiTouches,
): void {
    if (aiRegistry.hasAction(name)) return;
    aiRegistry.registerValue(name, {
        params, outputs, touches,
        evaluate: (ctx, _bb, p, out) => evaluate(ctx, p, out),
    });
}

/**
 * Register the engine's built-in graph vocabulary. Idempotent (and safe after an
 * `aiRegistry.clear()`): each name registers only if absent.
 */
export function ensureBuiltinScriptNodes(): void {
    value('math.add', [N('a'), N('b')], OUT_N, (_c, p, out) => { out.result = num(p.a) + num(p.b); });
    value('math.subtract', [N('a'), N('b')], OUT_N, (_c, p, out) => { out.result = num(p.a) - num(p.b); });
    value('math.multiply', [N('a'), N('b')], OUT_N, (_c, p, out) => { out.result = num(p.a) * num(p.b); });
    value('math.divide', [N('a'), N('b')], OUT_N, (_c, p, out) => {
        // Division by zero is an authoring mistake with no right answer; zero at
        // least keeps the rest of the graph running on a number.
        const b = num(p.b);
        out.result = b === 0 ? 0 : num(p.a) / b;
    });
    value('math.min', [N('a'), N('b')], OUT_N, (_c, p, out) => { out.result = Math.min(num(p.a), num(p.b)); });
    value('math.max', [N('a'), N('b')], OUT_N, (_c, p, out) => { out.result = Math.max(num(p.a), num(p.b)); });
    value('math.abs', [N('a')], OUT_N, (_c, p, out) => { out.result = Math.abs(num(p.a)); });
    value('math.clamp', [N('value'), N('min'), N('max')], OUT_N, (_c, p, out) => {
        out.result = Math.min(Math.max(num(p.value), num(p.min)), num(p.max));
    });
    value('math.lerp', [N('a'), N('b'), N('t')], OUT_N, (_c, p, out) => {
        const t = num(p.t);
        out.result = num(p.a) + (num(p.b) - num(p.a)) * t;
    });
    // A fresh number per activation of the node reading it — the memo makes one
    // wire one value, which is the only guarantee a random node can honour.
    value('math.random', [N('min'), N('max')], OUT_N, (_c, p, out) => {
        const min = num(p.min);
        const max = num(p.max);
        out.result = min + Math.random() * (max - min);
    });

    value('compare.equal', [N('a'), N('b')], OUT_B, (_c, p, out) => { out.result = num(p.a) === num(p.b); });
    value('compare.less', [N('a'), N('b')], OUT_B, (_c, p, out) => { out.result = num(p.a) < num(p.b); });
    value('compare.greater', [N('a'), N('b')], OUT_B, (_c, p, out) => { out.result = num(p.a) > num(p.b); });

    value('logic.and', [B('a'), B('b')], OUT_B, (_c, p, out) => { out.result = Boolean(p.a) && Boolean(p.b); });
    value('logic.or', [B('a'), B('b')], OUT_B, (_c, p, out) => { out.result = Boolean(p.a) || Boolean(p.b); });
    value('logic.not', [B('a')], OUT_B, (_c, p, out) => { out.result = !p.a; });

    value('string.concat',
        [{ name: 'a', type: 'string' }, { name: 'b', type: 'string' }], OUT_S,
        (_c, p, out) => { out.result = str(p.a) + str(p.b); });

    // The read half of `property.set`, and the same addressing. Numbers come
    // back as numbers and everything else as its string, so one node serves
    // every field; `entity` 0 is the one this graph rides on.
    value('property.get',
        [
            { name: 'path', type: 'string', tooltip: 'Component.field, e.g. Transform.position.x' },
            { name: 'entity', type: 'number', tooltip: 'Leave 0 for this entity' },
        ],
        [{ name: 'value', type: 'number' }, { name: 'text', type: 'string' }],
        (ctx, p, out) => {
            const path = str(p.path).trim();
            const target = (Number(p.entity ?? 0) || (ctx.entity as number)) as Entity;
            const raw = path ? getEntityProperty(ctx.world, target, path) : undefined;
            out.value = typeof raw === 'number' ? raw : Number(raw) || 0;
            out.text = str(raw);
        },
        // Which component it reads is the first segment of the authored path;
        // with no readable path it admits it cannot say.
        { opaque: true },
    );

    value('entity.self', [], [{ name: 'entity', type: 'entity' }],
        (ctx, _p, out) => { out.entity = ctx.entity as number; });

    // — Input. A leaf that cannot see the keyboard is a leaf no game logic can
    //   be written in; every authored surface reads the same InputState a
    //   `defineBehavior` does. —
    value('input.down', [{ name: 'key', type: 'string', tooltip: 'KeyboardEvent.code, e.g. ArrowLeft' }], OUT_B,
        (ctx, p, out) => { out.result = ctx.input.isKeyDown(str(p.key)); }, {});
    value('input.pressed', [{ name: 'key', type: 'string' }], OUT_B,
        (ctx, p, out) => { out.result = ctx.input.isKeyPressed(str(p.key)); }, {});
    // The 1-D axis a character moves along: two keys, one number, so a graph
    // spends one node on "left or right" instead of a branch per direction.
    value('input.axis',
        [{ name: 'negative', type: 'string' }, { name: 'positive', type: 'string' }], OUT_N,
        (ctx, p, out) => {
            out.result = (ctx.input.isKeyDown(str(p.positive)) ? 1 : 0)
                - (ctx.input.isKeyDown(str(p.negative)) ? 1 : 0);
        }, {});
    value('input.pointer', [], [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }],
        (ctx, _p, out) => {
            const m = ctx.input.getMousePosition();
            out.x = m.x; out.y = m.y;
        }, {});

    // — Other entities. A game is entities acting on each other, and a graph
    //   that can only reach the one it rides on cannot express that. —
    value('entity.byName', [{ name: 'name', type: 'string' }], [{ name: 'entity', type: 'entity' }],
        (ctx, p, out) => { out.entity = findByName(ctx, str(p.name)) as number; }, { reads: [Name._name] });

    if (!aiRegistry.hasAction('entity.despawn')) {
        aiRegistry.registerAction('entity.despawn', {
            params: [{ name: 'entity', type: 'number', tooltip: 'Leave 0 for this entity' }],
            touches: { opaque: true },
            run: (ctx, _bb, _arg, params) => {
                const target = Number(params?.entity ?? 0) || (ctx.entity as number);
                ctx.commands.despawn(target as Entity);
            },
        });
    }

    // An effectful name, so it carries an exec pin and sequences like any other
    // statement — a log line that ran "somewhere in the data" would be useless.
    if (!aiRegistry.hasAction('debug.log')) {
        aiRegistry.registerAction('debug.log', {
            params: [{ name: 'message', type: 'string' }],
            touches: {},
            run: (_ctx, _bb, _arg, params) => { log.info('logic', str(params?.message)); },
        });
    }
}

/** The nearest entity carrying `name`, or 0. The world's own index — the same
 *  answer `findEntityByName` gives every other caller. */
function findByName(ctx: AiContext, name: string): Entity {
    if (!name) return 0 as Entity;
    return (ctx.world.findEntityByName(name) ?? 0) as Entity;
}

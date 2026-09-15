// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    main.ts
 * @brief   One registered value node — the half of a script graph that is code.
 *
 * A graph is structure; the verbs it calls are names. The engine ships a
 * vocabulary (maths, comparison, `property.get`/`set`, …) and a project extends
 * it through the same door: `registerValue` for a name that answers a question,
 * `registerAction` for one that does something. Either shows up in the editor's
 * palette with the pins it declares, so nothing about a built-in node is
 * privileged.
 */
import { registerValue } from 'esengine';

/**
 * A triangle wave: `t` folded into `0 → range → 0`. The engine has no such node
 * and should not — this is the demo's own idea of motion, and one function is
 * the whole of teaching the graph about it.
 */
registerValue('demo.pingPong', {
    params: [
        { name: 't', type: 'number', tooltip: 'Seconds elapsed' },
        { name: 'range', type: 'number', tooltip: 'Peak value' },
    ],
    outputs: [{ name: 'value', type: 'number' }],
    // Pure: it reads nothing and writes nothing, so the graph may pull it
    // whenever the node reading it runs.
    touches: {},
    evaluate: (_ctx, _bb, params, out) => {
        const range = Number(params.range ?? 0);
        if (range <= 0) { out.value = 0; return; }
        const span = range * 2;
        const wrapped = Math.abs(Number(params.t ?? 0)) % span;
        out.value = wrapped <= range ? wrapped : span - wrapped;
    },
});

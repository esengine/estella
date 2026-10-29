// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A Cocos `.animgraph` as an engine `.esanimator`.
 *
 * A graph is layers of state machines. A state plays a motion (one clip, or clips blended along a number), and transitions between states wait on
 * conditions over named variables, optionally for the clip to end. The engine's Animator is the same model: parameters (numbers, flags,
 * triggers), states with motions of any registered kind, transitions with conditions, an any-state, layers. So the conversion is a rename, and
 * what the Animator cannot state is counted: a mask on a layer, `<=` and `>=` (the Animator has only
 * `<` and `>`).
 */
type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const typeOf = (o: unknown): string => (isObj(o) && typeof o.__type__ === 'string' ? o.__type__.replace('cc.animation.', '') : '');

export interface GraphContext {
    /** The timeline a clip uuid plays as on the node the controller is put on, or null when it cannot be found there. */
    clip(clipUuid: string): string | null;
    /** Called with a short code for something the Animator cannot state. */
    note(code: string): void;
}

interface Condition { param: string; op: string; value?: number }
interface Transition { to: string; conditions: Condition[]; duration?: number; hasExitTime?: boolean }
interface State { name: string; motion?: Raw; speed?: number; speedParameter?: string; transitions: Transition[] }
interface Scope { states: State[]; initialState: string; anyStateTransitions: Transition[] }

export interface ConvertedGraph {
    document: Raw;
    /** Clip uuids the graph plays, found or not. */
    clips: string[];
}

export function convertAnimationGraph(objects: unknown, ctx: GraphContext): ConvertedGraph {
    const d = Array.isArray(objects) ? objects : [objects];
    const at = (v: unknown): unknown => (isObj(v) && typeof v.__id__ === 'number' ? d[v.__id__] : v);
    const root = d[0];
    const clips: string[] = [];

    // ---- parameters --------------------------------------------------------------------------------------------------------------------
    const parameters: Raw[] = [];
    const variables = isObj(root) && isObj(root._variables) ? root._variables : {};
    for (const [name, ref] of Object.entries(variables)) {
        const v = at(ref);
        const kind = typeOf(v);
        if (kind === 'TriggerVariable') parameters.push({ name, type: 'trigger' });
        else if (isObj(v) && num(v._type, 0) === 2) parameters.push({ name, type: 'bool', default: v._value === true });
        else parameters.push({ name, type: 'float', default: isObj(v) ? num(v._value, 0) : 0 });
    }
    const boolean = new Set(parameters.filter((p) => p.type === 'bool').map((p) => p.name as string));

    // ---- motions -----------------------------------------------------------------------------------------------------------------------
    const clipMotion = (ref: unknown): Raw | null => {
        const motion = at(ref);
        if (typeOf(motion) === 'ClipMotion' && isObj(motion)) {
            const uuid = isObj(motion.clip) && typeof motion.clip.__uuid__ === 'string' ? motion.clip.__uuid__ : '';
            if (!uuid) return null;
            clips.push(uuid);
            const timeline = ctx.clip(uuid);
            if (!timeline) { ctx.note('graph-clip-not-found'); return null; }
            return { kind: 'timeline', clip: timeline };
        }
        if (typeOf(motion) === 'AnimationBlend1D' && isObj(motion)) {
            const param = at(motion.param);
            const parameter = isObj(param) && typeof param.variable === 'string' ? param.variable : '';
            const thresholds = (Array.isArray(motion._items) ? motion._items : []).flatMap((item) => {
                const it = at(item);
                const inner = isObj(it) ? clipMotion(it.motion) : null;
                return inner && isObj(it) ? [{ value: num(it.threshold, 0), motion: inner }] : [];
            });
            if (!parameter || thresholds.length === 0) { ctx.note('graph-blend-empty'); return null; }
            return { kind: 'blend1d', parameter, thresholds };
        }
        if (motion !== undefined && motion !== null) ctx.note(`graph-motion-${typeOf(motion) || 'unknown'}`);
        return null;
    };

    // ---- one state machine as a scope ----------------------------------------------------------------------------------------------
    const scope = (machineRef: unknown): Scope => {
        const machine = at(machineRef);
        const m: Raw = isObj(machine) ? machine : {};
        const names = new Map<unknown, string>();
        const used = new Set<string>();
        const unique = (name: string): string => {
            let n = name || 'state';
            for (let i = 2; used.has(n); i++) n = `${name || 'state'}_${i}`;
            used.add(n);
            return n;
        };
        const stateRefs = Array.isArray(m._states) ? (m._states as unknown[]) : [];
        const entry = at(m._entryState), exit = at(m._exitState), any = at(m._anyState);
        const states: State[] = [];
        for (const ref of stateRefs) {
            const s = at(ref);
            if (s === entry || s === exit || s === any || !isObj(s)) continue;
            const name = unique(typeof s.name === 'string' ? s.name : '');
            names.set(s, name);
            const state: State = { name, transitions: [] };
            if (typeOf(s) === 'Motion') {
                const motion = clipMotion(s.motion);
                if (motion) state.motion = motion;
                state.speed = num(s.speed, 1);
                // the variable scales the state's clock; it has to be a number the graph declares
                if (s.speedMultiplierEnabled === true && typeof s.speedMultiplier === 'string' && s.speedMultiplier !== '') {
                    if (parameters.some((p) => p.name === s.speedMultiplier && p.type === 'float')) state.speedParameter = s.speedMultiplier;
                    else ctx.note('graph-speed-variable-missing');
                }
            } else {
                ctx.note(`graph-state-${typeOf(s) || 'unknown'}`);
            }
            states.push(state);
        }
        const conditionOf = (ref: unknown): Condition | null => {
            const c = at(ref);
            const kind = typeOf(c);
            if (kind === 'TriggerCondition' && isObj(c)) return typeof c.trigger === 'string' ? { param: c.trigger, op: 'trigger' } : null;
            if (kind === 'UnaryCondition' && isObj(c)) {
                const operand = at(c.operand);
                const param = isObj(operand) && typeof operand.variable === 'string' ? operand.variable : '';
                if (!param) { ctx.note('graph-condition-constant'); return null; }
                return { param, op: num(c.operator, 0) === 0 ? 'true' : 'false' };
            }
            if (kind === 'BinaryCondition' && isObj(c)) {
                const lhs = at(c.lhs), rhs = at(c.rhs);
                const param = isObj(lhs) && typeof lhs.variable === 'string' ? lhs.variable : '';
                const value = isObj(rhs) ? num(rhs.value, 0) : 0;
                if (!param) { ctx.note('graph-condition-constant'); return null; }
                const operator = num(c.operator, 0);
                if (operator === 3 || operator === 5) ctx.note('graph-condition-inclusive');
                if (boolean.has(param)) return { param, op: value !== 0 && operator !== 1 ? 'true' : 'false' };
                return { param, op: ['eq', 'neq', 'lt', 'lt', 'gt', 'gt'][operator] ?? 'eq', value };
            }
            ctx.note(`graph-condition-${kind || 'unknown'}`);
            return null;
        };
        let initialState = '';
        const transitions = Array.isArray(m._transitions) ? (m._transitions as unknown[]) : [];
        const anyStateTransitions: Transition[] = [];
        for (const ref of transitions) {
            const t = at(ref);
            if (!isObj(t)) continue;
            const from = at(t.from), to = at(t.to);
            if (from === entry) {
                const target = names.get(to);
                if (target && initialState === '') initialState = target;
                continue;
            }
            const target = names.get(to);
            if (to === exit || target === undefined) { ctx.note('graph-transition-to-exit'); continue; }
            const kind = typeOf(t);
            const conditions = (Array.isArray(t.conditions) ? t.conditions : []).map(conditionOf).filter((c): c is Condition => c !== null);
            const out: Transition = { to: target, conditions };
            if (kind === 'AnimationTransition') {
                const duration = num(t.duration, 0);
                if (duration > 0) out.duration = duration;
                if (t.relativeDuration === true && duration > 0) ctx.note('graph-duration-relative');
                if (t.exitConditionEnabled === true) out.hasExitTime = true;
            }
            if (from === any) anyStateTransitions.push(out);
            else {
                const owner = states.find((s) => names.get(from) === s.name);
                if (owner) owner.transitions.push(out);
            }
        }
        return { states, initialState: initialState || states[0]?.name || '', anyStateTransitions };
    };

    const layers = isObj(root) && Array.isArray(root._layers) ? (root._layers as unknown[]) : [];
    const built = layers.map((ref) => {
        const layer = at(ref);
        return { layer: isObj(layer) ? layer : ({} as Raw), scope: scope(isObj(layer) ? layer._stateMachine : undefined) };
    });
    const base = built[0]?.scope ?? { states: [], initialState: '', anyStateTransitions: [] };
    const toState = (s: State): Raw => ({
        name: s.name,
        ...(s.motion ? { motion: s.motion } : {}),
        ...(s.speed !== undefined && s.speed !== 1 ? { speed: s.speed } : {}),
        ...(s.speedParameter ? { speedParameter: s.speedParameter } : {}),
        transitions: s.transitions,
    });
    const scopeDoc = (s: Scope): Raw => ({
        states: s.states.map(toState), initialState: s.initialState,
        ...(s.anyStateTransitions.length > 0 ? { anyStateTransitions: s.anyStateTransitions } : {}),
    });
    const extra = built.slice(1).map(({ layer, scope: s }) => {
        if (layer.mask) ctx.note('graph-layer-mask');
        return { name: typeof layer.name === 'string' && layer.name ? layer.name : 'layer', weight: num(layer.weight, 1), blend: 'override', ...scopeDoc(s) };
    });
    return {
        document: { version: 2, parameters, ...scopeDoc(base), ...(extra.length > 0 ? { layers: extra } : {}) },
        clips,
    };
}

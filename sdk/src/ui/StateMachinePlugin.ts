import type { App, Plugin } from '../app';
import { defineSystem, Schedule } from '../system';
import { registerComponent } from '../component';
import type { Entity } from '../types';
import type { World } from '../world';
import { StateMachine } from './StateMachine';
import type { StateMachineData, StateNode, Condition, ListenerDef, InputDef } from './StateMachine';
import { UIInteraction } from './UIInteraction';
import type { UIInteractionData } from './UIInteraction';
import { Tween } from '../animation/Tween';
import { EasingType } from '../animation/ValueTween';
import type { ValueTweenHandle } from '../animation/ValueTween';
import { getEntityProperty, setEntityProperty } from './propertyPath';

const EASING_MAP: Record<string, EasingType> = {
    linear: EasingType.Linear,
    easeInQuad: EasingType.EaseInQuad,
    easeOutQuad: EasingType.EaseOutQuad,
    easeInOutQuad: EasingType.EaseInOutQuad,
    easeInCubic: EasingType.EaseInCubic,
    easeOutCubic: EasingType.EaseOutCubic,
    easeInOutCubic: EasingType.EaseInOutCubic,
    easeInBack: EasingType.EaseInBack,
    easeOutBack: EasingType.EaseOutBack,
    easeInOutBack: EasingType.EaseInOutBack,
    easeInElastic: EasingType.EaseInElastic,
    easeOutElastic: EasingType.EaseOutElastic,
    easeInOutElastic: EasingType.EaseInOutElastic,
    easeOutBounce: EasingType.EaseOutBounce,
};

interface LayerRuntime {
    currentState: string;
    inputs: Map<string, boolean | number>;
    activeTweens: ValueTweenHandle[];
    prevHovered: boolean;
}

function createRuntime(data: StateMachineData): LayerRuntime {
    const inputs = new Map<string, boolean | number>();
    for (const def of data.inputs) {
        if (def.type === 'bool') {
            inputs.set(def.name, def.defaultValue as boolean ?? false);
        } else if (def.type === 'number') {
            inputs.set(def.name, def.defaultValue as number ?? 0);
        } else {
            inputs.set(def.name, false);
        }
    }
    return {
        currentState: data.initialState,
        inputs,
        activeTweens: [],
        prevHovered: false,
    };
}

function applyListenerAction(
    inputs: Map<string, boolean | number>,
    listener: ListenerDef,
): void {
    const current = inputs.get(listener.inputName);
    if (current === undefined) return;

    if (listener.action === 'set') {
        inputs.set(listener.inputName, listener.value ?? true);
    } else if (listener.action === 'reset') {
        inputs.set(listener.inputName, listener.value ?? false);
    } else if (listener.action === 'toggle') {
        inputs.set(listener.inputName, !current);
    }
}

export function evaluateCondition(
    condition: Condition,
    inputs: Map<string, boolean | number>,
): boolean {
    const val = inputs.get(condition.inputName);
    if (val === undefined) return false;

    switch (condition.comparator) {
        case 'eq': return val === condition.value;
        case 'neq': return val !== condition.value;
        case 'gt': return (val as number) > (condition.value as number);
        case 'lt': return (val as number) < (condition.value as number);
        case 'gte': return (val as number) >= (condition.value as number);
        case 'lte': return (val as number) <= (condition.value as number);
        default: return false;
    }
}

function cancelActiveTweens(runtime: LayerRuntime): void {
    for (const handle of runtime.activeTweens) {
        handle.cancel();
    }
    runtime.activeTweens.length = 0;
}

function resolveEasing(name?: string): EasingType {
    if (!name) return EasingType.Linear;
    return EASING_MAP[name] ?? EasingType.Linear;
}

function applyStateProperties(
    world: World,
    entity: Entity,
    state: StateNode,
    duration: number,
    easing: EasingType,
    runtime: LayerRuntime,
): void {
    if (!state.properties) return;

    for (const [path, targetValue] of Object.entries(state.properties)) {
        if (duration > 0 && typeof targetValue === 'number') {
            const currentValue = getEntityProperty(world, entity, path);
            if (typeof currentValue !== 'number') {
                setEntityProperty(world, entity, path, targetValue);
                continue;
            }
            const from = currentValue;
            const to = targetValue;
            const handle = Tween.value(from, to, duration, (v) => {
                setEntityProperty(world, entity, path, v);
            }, { easing });
            runtime.activeTweens.push(handle);
        } else {
            setEntityProperty(world, entity, path, targetValue);
        }
    }
}

export class StateMachinePlugin implements Plugin {
    build(app: App): void {
        registerComponent('StateMachine', StateMachine);

        const world = app.world;
        const runtimes = new Map<Entity, LayerRuntime>();

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [],
            () => {
                for (const entity of runtimes.keys()) {
                    if (!world.valid(entity)) runtimes.delete(entity);
                }

                const entities = world.getEntitiesWithComponents([StateMachine]);

                for (const entity of entities) {
                    const data = world.get(entity, StateMachine) as StateMachineData;
                    if (!data.initialState || !data.states[data.initialState]) continue;

                    let runtime = runtimes.get(entity);
                    if (!runtime) {
                        runtime = createRuntime(data);
                        runtimes.set(entity, runtime);
                    }

                    const hasInteraction = world.has(entity, UIInteraction);
                    if (hasInteraction) {
                        const interaction = world.get(entity, UIInteraction) as UIInteractionData;
                        const justEntered = interaction.hovered && !runtime.prevHovered;
                        const justExited = !interaction.hovered && runtime.prevHovered;
                        runtime.prevHovered = interaction.hovered;

                        for (const listener of data.listeners) {
                            let matched = false;
                            switch (listener.event) {
                                case 'pointerDown': matched = interaction.justPressed; break;
                                case 'pointerUp': matched = interaction.justReleased; break;
                                case 'pointerEnter': matched = justEntered; break;
                                case 'pointerExit': matched = justExited; break;
                            }
                            if (matched) {
                                applyListenerAction(runtime.inputs, listener);
                            }
                        }
                    }

                    const currentState = data.states[runtime.currentState];
                    if (!currentState) continue;

                    for (const transition of currentState.transitions) {
                        const allMet = transition.conditions.every(
                            c => evaluateCondition(c, runtime!.inputs)
                        );
                        if (!allMet) continue;

                        const targetState = data.states[transition.target];
                        if (!targetState) continue;

                        cancelActiveTweens(runtime);

                        if (targetState.timeline) {
                            console.warn(`StateMachine: Timeline mode not yet supported (state: ${transition.target})`);
                        }

                        applyStateProperties(
                            world, entity, targetState,
                            transition.duration,
                            resolveEasing(transition.easing),
                            runtime,
                        );

                        runtime.currentState = transition.target;
                        break;
                    }

                    for (const inputDef of data.inputs) {
                        if (inputDef.type === 'trigger') {
                            runtime.inputs.set(inputDef.name, false);
                        }
                    }
                }
            },
            { name: 'StateMachineSystem' }
        ), { runAfter: ['ButtonSystem'] });
    }
}

export const stateMachinePlugin = new StateMachinePlugin();

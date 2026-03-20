import type { App, Plugin } from '../app';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { Time, type TimeData } from '../resource';
import { registerComponent } from '../component';
import { isEditor, isPlayMode } from '../env';
import type { Entity } from '../types';
import type { World } from '../world';
import { StateMachine } from './StateMachine';
import type {
    StateMachineData, StateNode, Condition, ListenerDef,
    LayerData, BlendEntry,
} from './StateMachine';
import { UIInteraction } from './UIInteraction';
import type { UIInteractionData } from './UIInteraction';
import { Tween } from '../animation/Tween';
import { EasingType } from '../animation/ValueTween';
import type { ValueTweenHandle } from '../animation/ValueTween';
import { getEntityProperty, setEntityProperty } from './propertyPath';
import { WrapMode } from '../timeline/TimelineTypes';
import { getTimelineAsset } from '../timeline/TimelinePlugin';
import { setTimelineModule } from '../timeline/TimelineControl';
import {
    createTimelineHandle,
    destroyTimelineHandle,
    resolveTrackTargets,
    advanceAndProcess,
} from '../timeline/TimelineRuntime';
import type { UploadResult } from '../timeline/TimelineUploader';
import type { ESEngineModule } from '../wasm';
import { Assets, type AssetsData } from '../asset/AssetPlugin';
import { EntityStateMap } from './uiHelpers';
import { SystemLabel, PluginName } from '../systemLabels';
import {
    isAssetPropertyPath, normalizeAssetValue, collectAssetPaths,
    StateMachineAssetCache,
} from './StateMachineAssets';

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

const WRAP_MODE_MAP: Record<string, number> = {
    once: WrapMode.Once,
    loop: WrapMode.Loop,
};

const EXIT_STATE = '__exit__';

interface PropertyContext {
    world: World;
    entity: Entity;
    assets: StateMachineAssetCache;
}

interface LayerRuntime {
    currentState: string;
    activeTweens: ValueTweenHandle[];
    timelineHandle: number;
    timelineUpload: UploadResult | null;
    timelinePath: string;
    timelineDuration: number;
    isExited: boolean;
    pendingAssetApply: boolean;
}

interface EntityRuntime {
    inputs: Map<string, boolean | number>;
    layers: LayerRuntime[];
    prevHovered: boolean;
    assets: StateMachineAssetCache;
}

function createInputs(data: StateMachineData): Map<string, boolean | number> {
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
    return inputs;
}

function createLayerRuntime(initialState: string): LayerRuntime {
    return {
        currentState: initialState,
        activeTweens: [],
        timelineHandle: 0,
        timelineUpload: null,
        timelinePath: '',
        timelineDuration: 0,
        isExited: false,
        pendingAssetApply: true,
    };
}

function getLayers(data: StateMachineData): LayerData[] {
    if (data.layers && data.layers.length > 0) {
        return data.layers;
    }
    return [{ name: 'Base', states: data.states, initialState: data.initialState }];
}

function gatherAllAssetPaths(data: StateMachineData): string[] {
    const paths: string[] = [];
    const scanStates = (states: Record<string, StateNode>) => {
        for (const state of Object.values(states)) {
            paths.push(...collectAssetPaths(state.properties));
            if (state.blendStates) {
                for (const entry of state.blendStates) {
                    paths.push(...collectAssetPaths(entry.properties));
                }
            }
        }
    };
    for (const layer of getLayers(data)) {
        scanStates(layer.states);
    }
    return paths;
}

function createEntityRuntime(data: StateMachineData): EntityRuntime {
    const layers = getLayers(data);
    return {
        inputs: createInputs(data),
        layers: layers.map(l => createLayerRuntime(l.initialState)),
        prevHovered: false,
        assets: new StateMachineAssetCache(gatherAllAssetPaths(data)),
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

function resolveAssetProperty(
    ctx: PropertyContext,
    path: string,
    value: unknown,
): boolean {
    const normalized = normalizeAssetValue(value);
    if (!normalized) return false;
    const handle = ctx.assets.getHandle(normalized);
    if (handle !== undefined) {
        setEntityProperty(ctx.world, ctx.entity, path, handle);
        return true;
    }
    return false;
}

function stateHasUnresolvedAssets(state: StateNode, assets: StateMachineAssetCache): boolean {
    if (!state.properties) return false;
    for (const [key, value] of Object.entries(state.properties)) {
        if (!isAssetPropertyPath(key)) continue;
        const normalized = normalizeAssetValue(value);
        if (normalized && assets.getHandle(normalized) === undefined) return true;
    }
    return false;
}

function applyStateProperties(
    ctx: PropertyContext,
    state: StateNode,
    duration: number,
    easing: EasingType,
    runtime: LayerRuntime,
): void {
    if (!state.properties) return;

    for (const [path, targetValue] of Object.entries(state.properties)) {
        if (isAssetPropertyPath(path)) {
            resolveAssetProperty(ctx, path, targetValue);
            continue;
        }

        if (duration > 0 && typeof targetValue === 'number') {
            const currentValue = getEntityProperty(ctx.world, ctx.entity, path);
            if (typeof currentValue !== 'number') {
                setEntityProperty(ctx.world, ctx.entity, path, targetValue);
                continue;
            }
            const from = currentValue;
            const to = targetValue;
            const handle = Tween.value(from, to, duration, (v) => {
                setEntityProperty(ctx.world, ctx.entity, path, v);
            }, { easing });
            runtime.activeTweens.push(handle);
        } else {
            setEntityProperty(ctx.world, ctx.entity, path, targetValue);
        }
    }
}

function applyBlendEntryProperties(
    ctx: PropertyContext,
    entry: BlendEntry,
    weight: number,
): void {
    if (!entry.properties || weight <= 0) return;

    for (const [path, targetValue] of Object.entries(entry.properties)) {
        if (isAssetPropertyPath(path)) {
            resolveAssetProperty(ctx, path, targetValue);
            continue;
        }

        if (typeof targetValue === 'number') {
            const current = getEntityProperty(ctx.world, ctx.entity, path);
            if (typeof current === 'number') {
                setEntityProperty(ctx.world, ctx.entity, path, current + (targetValue - current) * weight);
            }
        }
    }
}

function applyBlend1D(
    ctx: PropertyContext,
    state: StateNode,
    inputs: Map<string, boolean | number>,
): void {
    if (!state.blendInput || !state.blendStates || state.blendStates.length === 0) return;

    const inputValue = (inputs.get(state.blendInput) as number) ?? 0;
    const entries = state.blendStates.slice().sort((a, b) => (a.threshold ?? 0) - (b.threshold ?? 0));

    if (entries.length === 1) {
        applyBlendEntryProperties(ctx, entries[0], 1);
        return;
    }

    const minThreshold = entries[0].threshold ?? 0;
    const maxThreshold = entries[entries.length - 1].threshold ?? 0;

    if (inputValue <= minThreshold) {
        applyBlendEntryProperties(ctx, entries[0], 1);
        return;
    }
    if (inputValue >= maxThreshold) {
        applyBlendEntryProperties(ctx, entries[entries.length - 1], 1);
        return;
    }

    for (let i = 0; i < entries.length - 1; i++) {
        const lo = entries[i].threshold ?? 0;
        const hi = entries[i + 1].threshold ?? 0;
        if (inputValue >= lo && inputValue <= hi) {
            const range = hi - lo;
            const t = range > 0 ? (inputValue - lo) / range : 0;
            const nearLo = t <= 0.5;
            if (entries[i].properties && entries[i + 1].properties) {
                for (const [path, loVal] of Object.entries(entries[i].properties!)) {
                    const hiVal = entries[i + 1].properties![path];
                    const isAsset = isAssetPropertyPath(path);
                    if (isAsset) {
                        const loNorm = normalizeAssetValue(loVal);
                        const hiNorm = normalizeAssetValue(hiVal);
                        const loHandle = loNorm ? ctx.assets.getHandle(loNorm) : undefined;
                        const hiHandle = hiNorm ? ctx.assets.getHandle(hiNorm) : undefined;
                        if (loHandle !== undefined || hiHandle !== undefined) {
                            const snapped = nearLo ? loHandle : hiHandle;
                            if (snapped !== undefined) {
                                setEntityProperty(ctx.world, ctx.entity, path, snapped);
                            }
                        }
                    } else if (typeof loVal === 'number' && typeof hiVal === 'number') {
                        const blended = loVal + (hiVal - loVal) * t;
                        setEntityProperty(ctx.world, ctx.entity, path, blended);
                    }
                }
            }
            break;
        }
    }
}

function applyBlendDirect(
    ctx: PropertyContext,
    state: StateNode,
    inputs: Map<string, boolean | number>,
): void {
    if (!state.blendStates) return;

    for (const entry of state.blendStates) {
        let mix: number;
        if (entry.mixInput) {
            mix = (inputs.get(entry.mixInput) as number) ?? 0;
        } else {
            mix = entry.mixValue ?? 1;
        }
        applyBlendEntryProperties(ctx, entry, mix);
    }
}

function enterTimelineState(
    world: any, module: ESEngineModule,
    entity: Entity, state: StateNode, runtime: LayerRuntime,
): void {
    cleanupTimelineHandle(module, runtime);

    const path = state.timeline!;
    const asset = getTimelineAsset(path);
    if (!asset) return;

    const uploadResult = createTimelineHandle(module, asset);
    if (!uploadResult.handle) return;

    resolveTrackTargets(world, module, uploadResult, entity);

    const wrapMode = WRAP_MODE_MAP[state.timelineWrapMode ?? 'once'] ?? WrapMode.Once;
    module._tl_setWrapMode(uploadResult.handle, wrapMode);
    module._tl_play(uploadResult.handle);

    runtime.timelineHandle = uploadResult.handle;
    runtime.timelineUpload = uploadResult;
    runtime.timelinePath = path;
    runtime.timelineDuration = asset.duration;
}

function cleanupTimelineHandle(module: ESEngineModule | null, runtime: LayerRuntime): void {
    if (runtime.timelineHandle && module) {
        destroyTimelineHandle(module, runtime.timelineHandle);
    }
    runtime.timelineHandle = 0;
    runtime.timelineUpload = null;
    runtime.timelinePath = '';
    runtime.timelineDuration = 0;
}

function cleanupEntityRuntime(module: ESEngineModule | null, er: EntityRuntime, assets?: AssetsData | null): void {
    for (const layer of er.layers) {
        cancelActiveTweens(layer);
        cleanupTimelineHandle(module, layer);
    }
    if (assets) {
        er.assets.release(assets);
    }
}

function processLayer(
    ctx: PropertyContext,
    module: ESEngineModule,
    layerData: LayerData,
    layer: LayerRuntime,
    inputs: Map<string, boolean | number>,
    dt: number,
): void {
    if (layer.isExited) return;

    if (layer.timelineHandle && layer.timelineUpload && module) {
        setTimelineModule(module);
        advanceAndProcess(
            ctx.world, module,
            layer.timelineHandle, ctx.entity,
            dt, 1.0,
            layer.timelineUpload,
        );
    }

    const currentState = layerData.states[layer.currentState];
    if (!currentState) return;

    const anyState = layerData.states['__any__'];
    const allTransitions = anyState
        ? [...currentState.transitions, ...anyState.transitions]
        : currentState.transitions;

    for (const transition of allTransitions) {
        if (transition.exitTime !== undefined && transition.exitTime > 0) {
            if (layer.timelineHandle && module && layer.timelineDuration > 0) {
                const currentTime = module._tl_getTime(layer.timelineHandle);
                if (currentTime / layer.timelineDuration < transition.exitTime) {
                    continue;
                }
            }
        }

        const allMet = transition.conditions.every(
            c => evaluateCondition(c, inputs)
        );
        if (!allMet) continue;

        if (transition.target === EXIT_STATE) {
            cancelActiveTweens(layer);
            cleanupTimelineHandle(module, layer);
            layer.currentState = EXIT_STATE;
            layer.isExited = true;
            break;
        }

        const targetState = layerData.states[transition.target];
        if (!targetState) continue;

        cancelActiveTweens(layer);

        const stateType = targetState.type ?? 'standard';

        if (stateType === 'blend1d') {
            cleanupTimelineHandle(module, layer);
            applyBlend1D(ctx, targetState, inputs);
        } else if (stateType === 'blendDirect') {
            cleanupTimelineHandle(module, layer);
            applyBlendDirect(ctx, targetState, inputs);
        } else if (targetState.timeline) {
            if (module) {
                setTimelineModule(module);
                enterTimelineState(ctx.world, module, ctx.entity, targetState, layer);
            }
        } else {
            cleanupTimelineHandle(module, layer);
            applyStateProperties(
                ctx, targetState,
                transition.duration,
                resolveEasing(transition.easing),
                layer,
            );
        }

        layer.currentState = transition.target;
        layer.pendingAssetApply = stateHasUnresolvedAssets(targetState, ctx.assets);
        break;
    }

    const activeState = layerData.states[layer.currentState];
    if (activeState) {
        const activeType = activeState.type ?? 'standard';
        if (activeType === 'blend1d') {
            applyBlend1D(ctx, activeState, inputs);
        } else if (activeType === 'blendDirect') {
            applyBlendDirect(ctx, activeState, inputs);
        } else if (layer.pendingAssetApply && !stateHasUnresolvedAssets(activeState, ctx.assets)) {
            applyStateProperties(ctx, activeState, 0, EasingType.Linear, layer);
            layer.pendingAssetApply = false;
        }
    }
}

export class StateMachinePlugin implements Plugin {
    name = PluginName.StateMachine;
    dependencies = [PluginName.UIInteraction];

    build(app: App): void {
        registerComponent('StateMachine', StateMachine);

        const world = app.world;
        const runtimes = new EntityStateMap<EntityRuntime>();
        let wasPlayMode = false;

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time)],
            (time: TimeData) => {
                const module = world.getWasmModule() as ESEngineModule;
                const assetServer = app.getResource(Assets);

                const inPlayMode = !isEditor() || isPlayMode();
                if (!inPlayMode) {
                    if (wasPlayMode) {
                        for (const [, er] of runtimes) {
                            cleanupEntityRuntime(module, er, assetServer);
                        }
                        runtimes.clear();
                    }
                    wasPlayMode = false;
                    return;
                }
                wasPlayMode = true;

                runtimes.cleanup(world);

                const entities = world.getEntitiesWithComponents([StateMachine]);

                for (const entity of entities) {
                    const data = world.get(entity, StateMachine) as StateMachineData;
                    const layerDefs = getLayers(data);

                    if (layerDefs.length === 0) continue;
                    if (!layerDefs[0].initialState || !layerDefs[0].states[layerDefs[0].initialState]) continue;

                    let er = runtimes.get(entity);
                    if (!er) {
                        er = createEntityRuntime(data);
                        runtimes.set(entity, er);

                        for (let i = 0; i < layerDefs.length; i++) {
                            const initialState = layerDefs[i].states[er.layers[i].currentState];
                            if (initialState?.timeline && module) {
                                setTimelineModule(module);
                                enterTimelineState(world, module, entity, initialState, er.layers[i]);
                            }
                        }
                    }

                    if (assetServer && er.assets.paths.length > 0 && !er.assets.allLoaded) {
                        er.assets.startLoading(assetServer);
                    }

                    const hasInteraction = world.has(entity, UIInteraction);
                    if (hasInteraction) {
                        const interaction = world.get(entity, UIInteraction) as UIInteractionData;
                        const justEntered = interaction.hovered && !er.prevHovered;
                        const justExited = !interaction.hovered && er.prevHovered;
                        er.prevHovered = interaction.hovered;

                        for (const listener of data.listeners) {
                            let matched = false;
                            switch (listener.event) {
                                case 'pointerDown': matched = interaction.justPressed; break;
                                case 'pointerUp': matched = interaction.justReleased; break;
                                case 'pointerEnter': matched = justEntered; break;
                                case 'pointerExit': matched = justExited; break;
                            }
                            if (matched) {
                                applyListenerAction(er.inputs, listener);
                            }
                        }
                    }

                    const ctx: PropertyContext = { world, entity, assets: er.assets };
                    for (let i = 0; i < layerDefs.length; i++) {
                        if (i < er.layers.length) {
                            processLayer(ctx, module, layerDefs[i], er.layers[i], er.inputs, time.delta);
                        }
                    }

                    for (const inputDef of data.inputs) {
                        if (inputDef.type === 'trigger') {
                            er.inputs.set(inputDef.name, false);
                        }
                    }
                }
            },
            { name: 'StateMachineSystem' }
        ), { runAfter: [SystemLabel.Button] });
    }
}

export const stateMachinePlugin = new StateMachinePlugin();

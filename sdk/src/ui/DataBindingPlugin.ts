import type { App, Plugin } from '../app';
import type { Entity } from '../types';
import type { AnyComponentDef } from '../component';
import { defineSystem, Schedule } from '../system';
import { registerComponent, getComponent } from '../component';
import { playModeOnly } from '../env';
import { DataBinding, type DataBindingData, type BindingEntry } from './DataBinding';
import { compileExpression } from './DataBindingExpression';
import { SystemLabel } from '../systemLabels';

const componentDefCache = new Map<string, AnyComponentDef | null>();

function getCachedComponentDef(name: string): AnyComponentDef | null {
    if (componentDefCache.has(name)) return componentDefCache.get(name)!;
    const def = getComponent(name) ?? null;
    componentDefCache.set(name, def);
    return def;
}

export class DataBindingPlugin implements Plugin {
    name = 'dataBinding';

    build(app: App): void {
        registerComponent('DataBinding', DataBinding);

        const world = app.world;
        const lastSourceTick = new Map<Entity, number>();

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [],
            () => {
                for (const entity of lastSourceTick.keys()) {
                    if (!world.valid(entity) || !world.has(entity, DataBinding)) {
                        lastSourceTick.delete(entity);
                    }
                }

                const entities = world.getEntitiesWithComponents([DataBinding]);
                for (const entity of entities) {
                    const binding = world.get(entity, DataBinding) as DataBindingData;
                    if (!binding.source || binding.bindings.length === 0) continue;

                    const currentTick = app.getResourceChangeTick(binding.source);
                    const prevTick = lastSourceTick.get(entity) ?? -1;
                    if (currentTick === prevTick) continue;
                    lastSourceTick.set(entity, currentTick);

                    const sourceData = app.getResourceByName(binding.source);
                    if (sourceData == null || typeof sourceData !== 'object') continue;

                    for (const raw of binding.bindings) {
                        const entry = normalizeBinding(raw);
                        if (entry) applyBinding(world, entity, entry, sourceData as Record<string, unknown>);
                    }
                }
            },
            { name: 'DataBindingSystem' }
        ), { runBefore: [SystemLabel.Text, SystemLabel.Image], runIf: playModeOnly });
    }
}

function normalizeBinding(raw: unknown): BindingEntry | null {
    if (typeof raw === 'string') {
        const eqIdx = raw.indexOf('=');
        if (eqIdx === -1) return null;
        return { target: raw.slice(0, eqIdx), expression: raw.slice(eqIdx + 1) };
    }
    if (raw && typeof raw === 'object' && 'target' in raw && 'expression' in raw) {
        return raw as BindingEntry;
    }
    return null;
}

function coerceValue(raw: unknown, existing: unknown): unknown {
    if (raw == null) return raw;
    if (existing == null) return raw;

    const existingType = typeof existing;
    const rawType = typeof raw;

    if (existingType === rawType) return raw;

    if (existingType === 'number' && rawType === 'string') {
        const n = Number(raw);
        return isNaN(n) ? existing : n;
    }
    if (existingType === 'string' && rawType !== 'string') {
        return String(raw);
    }
    if (existingType === 'boolean') {
        return Boolean(raw);
    }

    if (existingType === 'object' && rawType === 'object') {
        return raw;
    }

    return raw;
}

function shallowEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== 'object' || typeof b !== 'object') return false;
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    if (ak.length !== bk.length) return false;
    for (const key of ak) {
        if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) return false;
    }
    return true;
}

function applyBinding(
    world: import('../world').World,
    entity: Entity,
    entry: BindingEntry,
    source: Record<string, unknown>,
): void {
    const dotIdx = entry.target.indexOf('.');
    if (dotIdx === -1) return;

    const componentName = entry.target.slice(0, dotIdx);
    const fieldName = entry.target.slice(dotIdx + 1);

    const componentDef = getCachedComponentDef(componentName);
    if (!componentDef || !world.has(entity, componentDef)) return;

    const compiled = compileExpression(entry.expression);
    const rawValue = compiled.evaluate(source);

    const data = world.get(entity, componentDef) as Record<string, unknown>;
    const coerced = coerceValue(rawValue, data[fieldName]);
    if (shallowEqual(data[fieldName], coerced)) return;

    data[fieldName] = coerced;
    world.insert(entity, componentDef, data);
}

export const dataBindingPlugin = new DataBindingPlugin();

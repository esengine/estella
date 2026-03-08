/**
 * @file    PostProcessVolumeInspector.ts
 * @brief   Custom inspector for PostProcessVolume component
 */

import {
    getAllEffectDefs,
    getEffectDef,
    syncPostProcessVolume,
    type PostProcessEffectData,
    type PostProcessVolumeData,
} from 'esengine';
import type { ComponentInspectorContext, ComponentInspectorInstance } from './InspectorRegistry';
import { createFloatEditor, createIntEditor, createVec2Editor } from './SharedEditors';
import { icons } from '../../utils/icons';
import type { PluginRegistrar } from '../../container';
import { COMPONENT_INSPECTOR } from '../../container/tokens';

function cloneEffects(effects: PostProcessEffectData[]): PostProcessEffectData[] {
    return effects.map(e => ({
        type: e.type,
        enabled: e.enabled,
        uniforms: { ...e.uniforms },
    }));
}

interface VolumeProps {
    isGlobal: boolean;
    shape: 'box' | 'sphere';
    size: { x: number; y: number };
    priority: number;
    weight: number;
    blendDistance: number;
}

function extractVolumeProps(data: Record<string, unknown>): VolumeProps {
    return {
        isGlobal: (data.isGlobal as boolean) ?? true,
        shape: (data.shape as 'box' | 'sphere') ?? 'box',
        size: (data.size as { x: number; y: number }) ?? { x: 5, y: 5 },
        priority: (data.priority as number) ?? 0,
        weight: (data.weight as number) ?? 1,
        blendDistance: (data.blendDistance as number) ?? 0,
    };
}

function buildVolumeData(effects: PostProcessEffectData[], props: VolumeProps): PostProcessVolumeData {
    return { effects, ...props };
}

function renderInspector(
    container: HTMLElement,
    ctx: ComponentInspectorContext,
): ComponentInspectorInstance {
    let currentEffects: PostProcessEffectData[] =
        (ctx.componentData.effects as PostProcessEffectData[]) ?? [];
    let volumeProps = extractVolumeProps(ctx.componentData);

    function emitEffectsChange(newEffects: PostProcessEffectData[]): void {
        const old = cloneEffects(currentEffects);
        currentEffects = newEffects;
        ctx.onChange('effects', old, cloneEffects(newEffects));
        syncToRuntime();
    }

    function emitPropChange<K extends keyof VolumeProps>(key: K, oldVal: VolumeProps[K], newVal: VolumeProps[K]): void {
        volumeProps[key] = newVal;
        ctx.onChange(key, oldVal, newVal);
        syncToRuntime();
    }

    function syncToRuntime(): void {
        syncPostProcessVolume(ctx.entity, buildVolumeData(currentEffects, volumeProps));
    }

    function rebuild(): void {
        container.innerHTML = '';
        renderVolumeProps(container, volumeProps, emitPropChange, rebuild);
        renderEffectList(container, currentEffects, emitEffectsChange);
        renderAddButton(container, currentEffects, emitEffectsChange);
    }

    rebuild();
    syncToRuntime();

    return {
        dispose() {},
        update(data: Record<string, unknown>) {
            currentEffects = (data.effects as PostProcessEffectData[]) ?? [];
            volumeProps = extractVolumeProps(data);
            rebuild();
            syncToRuntime();
        },
    };
}

function renderVolumeProps(
    container: HTMLElement,
    props: VolumeProps,
    onChange: <K extends keyof VolumeProps>(key: K, oldVal: VolumeProps[K], newVal: VolumeProps[K]) => void,
    rebuild: () => void,
): void {
    const section = document.createElement('div');
    section.className = 'es-pp-volume-props';

    const createRow = (label: string): { row: HTMLElement; value: HTMLElement } => {
        const row = document.createElement('div');
        row.className = 'es-property-row';
        const propLabel = document.createElement('span');
        propLabel.className = 'es-property-label';
        propLabel.textContent = label;
        const propValue = document.createElement('div');
        propValue.className = 'es-property-value';
        row.appendChild(propLabel);
        row.appendChild(propValue);
        return { row, value: propValue };
    };

    // isGlobal
    {
        const { row, value } = createRow('Is Global');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'es-input es-input-checkbox';
        input.checked = props.isGlobal;
        input.addEventListener('change', () => {
            const old = props.isGlobal;
            onChange('isGlobal', old, input.checked);
            rebuild();
        });
        value.appendChild(input);
        section.appendChild(row);
    }

    // priority
    {
        const { row, value } = createRow('Priority');
        createIntEditor(value, props.priority, (v) => {
            const old = props.priority;
            onChange('priority', old, v);
        });
        section.appendChild(row);
    }

    // weight
    {
        const { row, value } = createRow('Weight');
        createFloatEditor(value, props.weight, (v) => {
            const old = props.weight;
            onChange('weight', old, v);
        }, 0, 1, 0.01);
        section.appendChild(row);
    }

    if (!props.isGlobal) {
        // shape
        {
            const { row, value } = createRow('Shape');
            const select = document.createElement('select');
            select.className = 'es-input es-input-select';
            for (const opt of ['box', 'sphere'] as const) {
                const option = document.createElement('option');
                option.value = opt;
                option.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
                if (opt === props.shape) option.selected = true;
                select.appendChild(option);
            }
            select.addEventListener('change', () => {
                const old = props.shape;
                onChange('shape', old, select.value as 'box' | 'sphere');
            });
            value.appendChild(select);
            section.appendChild(row);
        }

        // size
        {
            const { row, value } = createRow('Size');
            createVec2Editor(value, { ...props.size }, (v) => {
                const old = { ...props.size };
                onChange('size', old, v);
            });
            section.appendChild(row);
        }

        // blendDistance
        {
            const { row, value } = createRow('Blend Distance');
            createFloatEditor(value, props.blendDistance, (v) => {
                const old = props.blendDistance;
                onChange('blendDistance', old, v);
            }, 0, undefined, 0.1);
            section.appendChild(row);
        }
    }

    container.appendChild(section);
}

function renderEffectList(
    container: HTMLElement,
    effects: PostProcessEffectData[],
    onChange: (effects: PostProcessEffectData[]) => void,
): void {
    for (let i = 0; i < effects.length; i++) {
        const effect = effects[i];
        const def = getEffectDef(effect.type);
        if (!def) continue;

        const section = document.createElement('div');
        section.className = 'es-pp-effect es-collapsible es-expanded';

        const header = document.createElement('div');
        header.className = 'es-pp-effect-header es-collapsible-header';

        const collapseIcon = document.createElement('span');
        collapseIcon.className = 'es-collapse-icon';
        collapseIcon.innerHTML = icons.chevronDown(8);

        const label = document.createElement('span');
        label.className = 'es-pp-effect-label';
        label.textContent = def.label;

        const spacer = document.createElement('span');
        spacer.style.flex = '1';

        const enableCb = document.createElement('input');
        enableCb.type = 'checkbox';
        enableCb.checked = effect.enabled;
        enableCb.title = 'Enable/Disable';
        enableCb.addEventListener('change', (e) => {
            e.stopPropagation();
            const updated = cloneEffects(effects);
            updated[i].enabled = enableCb.checked;
            onChange(updated);
        });

        const removeBtn = document.createElement('span');
        removeBtn.className = 'es-pp-effect-remove';
        removeBtn.innerHTML = icons.x(12);
        removeBtn.title = 'Remove effect';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const updated = cloneEffects(effects);
            updated.splice(i, 1);
            onChange(updated);
        });

        header.appendChild(collapseIcon);
        header.appendChild(label);
        header.appendChild(spacer);
        header.appendChild(enableCb);
        header.appendChild(removeBtn);

        header.addEventListener('click', () => {
            section.classList.toggle('es-expanded');
        });

        section.appendChild(header);

        const body = document.createElement('div');
        body.className = 'es-pp-effect-body es-collapsible-content';

        for (const uDef of def.uniforms) {
            const row = document.createElement('div');
            row.className = 'es-property-row';

            const propLabel = document.createElement('span');
            propLabel.className = 'es-property-label';
            propLabel.textContent = uDef.label;

            const propValue = document.createElement('div');
            propValue.className = 'es-property-value';

            const currentVal = effect.uniforms[uDef.name] ?? uDef.defaultValue;
            createFloatEditor(propValue, currentVal, (v) => {
                const updated = cloneEffects(effects);
                updated[i].uniforms[uDef.name] = v;
                onChange(updated);
            }, uDef.min, uDef.max, uDef.step);

            row.appendChild(propLabel);
            row.appendChild(propValue);
            body.appendChild(row);
        }

        section.appendChild(body);
        container.appendChild(section);
    }
}

function renderAddButton(
    container: HTMLElement,
    effects: PostProcessEffectData[],
    onChange: (effects: PostProcessEffectData[]) => void,
): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'es-pp-add-wrapper';

    const btn = document.createElement('button');
    btn.className = 'es-btn es-btn-small es-pp-add-btn';
    btn.textContent = 'Add Effect';

    btn.addEventListener('click', () => {
        const allDefs = getAllEffectDefs();
        const existingTypes = new Set(effects.map(e => e.type));
        const available = allDefs.filter(d => !existingTypes.has(d.type));

        if (available.length === 0) return;

        const menu = document.createElement('div');
        menu.className = 'es-pp-add-menu';

        for (const def of available) {
            const item = document.createElement('div');
            item.className = 'es-pp-add-menu-item';
            item.textContent = def.label;
            item.addEventListener('click', () => {
                menu.remove();

                const uniforms: Record<string, number> = {};
                for (const u of def.uniforms) {
                    uniforms[u.name] = u.defaultValue;
                }

                const updated = cloneEffects(effects);
                updated.push({ type: def.type, enabled: true, uniforms });
                onChange(updated);
            });
            menu.appendChild(item);
        }

        const rect = btn.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.left = `${rect.left}px`;
        menu.style.top = `${rect.bottom + 2}px`;
        menu.style.zIndex = '9999';
        document.body.appendChild(menu);

        const dismiss = (e: MouseEvent) => {
            if (!menu.contains(e.target as Node)) {
                menu.remove();
                document.removeEventListener('mousedown', dismiss);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
    });

    wrapper.appendChild(btn);
    container.appendChild(wrapper);
}

export function registerPostProcessVolumeInspector(registrar: PluginRegistrar): void {
    registrar.provide(COMPONENT_INSPECTOR, 'PostProcessVolume', {
        id: 'PostProcessVolume',
        componentType: 'PostProcessVolume',
        render: renderInspector,
    });
}

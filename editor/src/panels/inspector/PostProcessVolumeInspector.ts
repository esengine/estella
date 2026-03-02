/**
 * @file    PostProcessVolumeInspector.ts
 * @brief   Custom inspector for PostProcessVolume component
 */

import {
    getAllEffectDefs,
    getEffectDef,
    syncPostProcessVolume,
    type PostProcessEffectData,
} from 'esengine';
import type { ComponentInspectorContext, ComponentInspectorInstance } from './InspectorRegistry';
import { registerComponentInspector } from './InspectorRegistry';
import { createFloatEditor } from './SharedEditors';
import { icons } from '../../utils/icons';

function cloneEffects(effects: PostProcessEffectData[]): PostProcessEffectData[] {
    return effects.map(e => ({
        type: e.type,
        enabled: e.enabled,
        uniforms: { ...e.uniforms },
    }));
}

function renderInspector(
    container: HTMLElement,
    ctx: ComponentInspectorContext,
): ComponentInspectorInstance {
    let currentEffects: PostProcessEffectData[] =
        (ctx.componentData.effects as PostProcessEffectData[]) ?? [];

    function emitChange(newEffects: PostProcessEffectData[]): void {
        const old = cloneEffects(currentEffects);
        currentEffects = newEffects;
        ctx.onChange('effects', old, cloneEffects(newEffects));

        syncToRuntime();
    }

    function syncToRuntime(): void {
        syncPostProcessVolume(ctx.entity, { effects: currentEffects });
    }

    function rebuild(): void {
        container.innerHTML = '';
        renderEffectList(container, currentEffects, emitChange);
        renderAddButton(container, currentEffects, emitChange);
    }

    rebuild();
    syncToRuntime();

    return {
        dispose() {},
        update(data: Record<string, unknown>) {
            const newEffects = (data.effects as PostProcessEffectData[]) ?? [];
            currentEffects = newEffects;
            rebuild();
            syncToRuntime();
        },
    };
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

export function registerPostProcessVolumeInspector(): void {
    registerComponentInspector({
        id: 'postprocess-volume',
        componentType: 'PostProcessVolume',
        render: renderInspector,
    });
}

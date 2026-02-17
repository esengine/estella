import type { RuntimeEntityData, GameViewBridge } from '../game-view/GameViewBridge';
import { icons } from '../../utils/icons';

export function renderRuntimeEntity(
    container: HTMLElement,
    data: RuntimeEntityData,
    bridge: GameViewBridge | null,
): void {
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'es-inspector-entity-header';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'es-entity-icon';
    iconSpan.innerHTML = icons.box(16);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'es-entity-name';
    nameSpan.textContent = data.name || 'Entity ' + data.entityId;

    const idSpan = document.createElement('span');
    idSpan.className = 'es-entity-id';
    idSpan.textContent = '#' + data.entityId;

    header.appendChild(iconSpan);
    header.appendChild(nameSpan);
    header.appendChild(idSpan);
    container.appendChild(header);

    for (const comp of data.components) {
        const section = document.createElement('div');
        section.className = 'es-component-section es-collapsible es-expanded';

        const compHeader = document.createElement('div');
        compHeader.className = 'es-component-header es-collapsible-header';

        const collapseIcon = document.createElement('span');
        collapseIcon.className = 'es-collapse-icon';
        collapseIcon.innerHTML = icons.chevronDown(12);

        const titleSpan = document.createElement('span');
        titleSpan.className = 'es-component-title';
        titleSpan.textContent = comp.type;

        compHeader.appendChild(collapseIcon);
        compHeader.appendChild(titleSpan);
        compHeader.addEventListener('click', () => section.classList.toggle('es-expanded'));
        section.appendChild(compHeader);

        const props = document.createElement('div');
        props.className = 'es-component-properties es-collapsible-content';

        for (const [key, value] of Object.entries(comp.data)) {
            const row = document.createElement('div');
            row.className = 'es-property-row';

            const label = document.createElement('label');
            label.className = 'es-property-label';
            label.textContent = key;

            const editor = document.createElement('div');
            editor.className = 'es-property-editor';
            createRuntimePropertyEditor(editor, data.entityId, comp.type, key, value, bridge);

            row.appendChild(label);
            row.appendChild(editor);
            props.appendChild(row);
        }

        section.appendChild(props);
        container.appendChild(section);
    }
}

export function updateRuntimeEntityValues(
    container: HTMLElement,
    data: RuntimeEntityData,
): void {
    for (const comp of data.components) {
        for (const [key, value] of Object.entries(comp.data)) {
            const el = container.querySelector(
                `[data-rt-comp="${comp.type}"][data-rt-prop="${key}"]`
            ) as HTMLElement | null;
            if (!el) continue;

            if (el.getAttribute('data-rt-kind') === 'object' && value && typeof value === 'object') {
                const obj = value as Record<string, number>;
                for (const [subKey, subVal] of Object.entries(obj)) {
                    const inp = el.querySelector(`[data-rt-key="${subKey}"]`) as HTMLInputElement | null;
                    if (!inp || document.activeElement === inp) continue;
                    inp.value = String(Math.round(subVal * 1000) / 1000);
                }
                continue;
            }

            const input = el as HTMLInputElement;
            if (document.activeElement === input) continue;

            if (input.type === 'checkbox') {
                input.checked = Boolean(value);
            } else if (input.type === 'number') {
                input.value = String(Math.round((value as number) * 1000) / 1000);
            } else {
                input.value = String(value ?? '');
            }
        }
    }
}

function createRuntimePropertyEditor(
    container: HTMLElement,
    entityId: number,
    componentType: string,
    property: string,
    value: unknown,
    bridge: GameViewBridge | null,
): void {
    if (typeof value === 'number') {
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'es-input es-runtime-input';
        input.value = String(Math.round(value * 1000) / 1000);
        input.step = 'any';
        input.dataset.rtComp = componentType;
        input.dataset.rtProp = property;
        input.addEventListener('change', () => {
            bridge?.setEntityProperty(entityId, componentType, property, parseFloat(input.value));
        });
        container.appendChild(input);
    } else if (typeof value === 'boolean') {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = value;
        input.dataset.rtComp = componentType;
        input.dataset.rtProp = property;
        input.addEventListener('change', () => {
            bridge?.setEntityProperty(entityId, componentType, property, input.checked);
        });
        container.appendChild(input);
    } else if (typeof value === 'string') {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'es-input es-runtime-input';
        input.value = value;
        input.dataset.rtComp = componentType;
        input.dataset.rtProp = property;
        input.addEventListener('change', () => {
            bridge?.setEntityProperty(entityId, componentType, property, input.value);
        });
        container.appendChild(input);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        const obj = value as Record<string, number>;
        const vecWrapper = document.createElement('div');
        vecWrapper.className = 'es-runtime-vec-wrapper';
        vecWrapper.setAttribute('data-rt-comp', componentType);
        vecWrapper.setAttribute('data-rt-prop', property);
        vecWrapper.setAttribute('data-rt-kind', 'object');
        for (const k of Object.keys(obj)) {
            const field = document.createElement('span');
            field.className = 'es-runtime-vec-field';
            const lbl = document.createElement('span');
            lbl.className = 'es-runtime-vec-label';
            lbl.textContent = k;
            const inp = document.createElement('input');
            inp.type = 'number';
            inp.className = 'es-input es-runtime-vec-input';
            inp.value = String(Math.round(obj[k] * 1000) / 1000);
            inp.step = 'any';
            inp.dataset.rtKey = k;
            inp.addEventListener('change', () => {
                const newObj = { ...obj, [k]: parseFloat(inp.value) };
                bridge?.setEntityProperty(entityId, componentType, property, newObj);
            });
            field.appendChild(lbl);
            field.appendChild(inp);
            vecWrapper.appendChild(field);
        }
        container.appendChild(vecWrapper);
    } else {
        const span = document.createElement('span');
        span.className = 'es-runtime-readonly';
        span.textContent = JSON.stringify(value);
        container.appendChild(span);
    }
}

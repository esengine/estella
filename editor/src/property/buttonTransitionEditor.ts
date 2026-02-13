/**
 * @file    buttonTransitionEditor.ts
 * @brief   Custom editor for Button.transition (collapsible sub-section with 4 state colors)
 */

import type { PropertyEditorContext, PropertyEditorInstance } from './PropertyEditor';
import { colorToHex, hexToColor } from './editorUtils';

// =============================================================================
// Types
// =============================================================================

interface Color {
    r: number;
    g: number;
    b: number;
    a: number;
}

interface ButtonTransition {
    normalColor: Color;
    hoveredColor: Color;
    pressedColor: Color;
    disabledColor: Color;
}

// =============================================================================
// Defaults
// =============================================================================

function defaultTransition(): ButtonTransition {
    return {
        normalColor:   { r: 1, g: 1, b: 1, a: 1 },
        hoveredColor:  { r: 0.9, g: 0.9, b: 0.9, a: 1 },
        pressedColor:  { r: 0.7, g: 0.7, b: 0.7, a: 1 },
        disabledColor: { r: 0.5, g: 0.5, b: 0.5, a: 0.5 },
    };
}

const CHEVRON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

// =============================================================================
// Editor
// =============================================================================

const COLOR_FIELDS: { key: keyof ButtonTransition; label: string }[] = [
    { key: 'normalColor', label: 'Normal' },
    { key: 'hoveredColor', label: 'Hovered' },
    { key: 'pressedColor', label: 'Pressed' },
    { key: 'disabledColor', label: 'Disabled' },
];

export function createButtonTransitionEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange } = ctx;

    let current = value as ButtonTransition | null;

    const propertyRow = container.closest('.es-property-row');
    if (propertyRow) {
        (propertyRow as HTMLElement).style.display = 'none';
    }

    const section = document.createElement('div');
    section.className = 'es-btn-transition-section es-collapsible';
    if (current != null) {
        section.classList.add('es-expanded');
    }

    const header = document.createElement('div');
    header.className = 'es-btn-transition-header';

    const collapseIcon = document.createElement('span');
    collapseIcon.className = 'es-collapse-icon';
    collapseIcon.innerHTML = CHEVRON_SVG;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'es-input es-input-checkbox';
    checkbox.checked = current != null;

    const title = document.createElement('span');
    title.className = 'es-btn-transition-title';
    title.textContent = 'Color Transition';

    header.appendChild(collapseIcon);
    header.appendChild(checkbox);
    header.appendChild(title);
    section.appendChild(header);

    const content = document.createElement('div');
    content.className = 'es-btn-transition-content es-collapsible-content';

    interface ColorRowRef {
        colorInput: HTMLInputElement;
        alphaInput: HTMLInputElement;
    }

    const colorRefs: ColorRowRef[] = [];

    for (const field of COLOR_FIELDS) {
        const row = document.createElement('div');
        row.className = 'es-property-row';

        const label = document.createElement('label');
        label.className = 'es-property-label';
        label.textContent = field.label;

        const editorCell = document.createElement('div');
        editorCell.className = 'es-color-editor';

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.className = 'es-input es-input-color';

        const alphaInput = document.createElement('input');
        alphaInput.type = 'number';
        alphaInput.className = 'es-input es-input-number es-input-alpha';
        alphaInput.min = '0';
        alphaInput.max = '1';
        alphaInput.step = '0.01';

        const onColorChange = () => {
            if (!current) return;
            const newColor = hexToColor(colorInput.value);
            newColor.a = parseFloat(alphaInput.value) || 1;
            current = { ...current!, [field.key]: newColor };
            onChange(current);
        };

        colorInput.addEventListener('change', onColorChange);
        alphaInput.addEventListener('change', onColorChange);

        editorCell.appendChild(colorInput);
        editorCell.appendChild(alphaInput);

        row.appendChild(label);
        row.appendChild(editorCell);
        content.appendChild(row);

        colorRefs.push({ colorInput, alphaInput });
    }

    section.appendChild(content);

    const syncUI = () => {
        const enabled = current != null;
        checkbox.checked = enabled;
        if (enabled) {
            section.classList.add('es-expanded');
            for (let i = 0; i < COLOR_FIELDS.length; i++) {
                const color = current![COLOR_FIELDS[i].key];
                colorRefs[i].colorInput.value = colorToHex(color);
                colorRefs[i].alphaInput.value = String(color.a);
            }
        } else {
            section.classList.remove('es-expanded');
        }
    };

    header.addEventListener('click', (e) => {
        if (e.target === checkbox) return;
        if (current != null) {
            section.classList.toggle('es-expanded');
        } else {
            checkbox.checked = true;
            current = defaultTransition();
            onChange(current);
            syncUI();
        }
    });

    checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
            current = defaultTransition();
            onChange(current);
        } else {
            current = null;
            onChange(null);
        }
        syncUI();
    });

    syncUI();

    const insertTarget = propertyRow?.parentElement ?? container;
    insertTarget.appendChild(section);

    return {
        update(v: unknown) {
            current = v as ButtonTransition | null;
            syncUI();
        },
        dispose() {
            section.remove();
            if (propertyRow) {
                (propertyRow as HTMLElement).style.display = '';
            }
        },
    };
}

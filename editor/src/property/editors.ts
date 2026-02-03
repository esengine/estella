/**
 * @file    editors.ts
 * @brief   Built-in property editors
 */

import {
    registerPropertyEditor,
    type PropertyEditorContext,
    type PropertyEditorInstance,
} from './PropertyEditor';

// =============================================================================
// Number Editor
// =============================================================================

function createNumberEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, meta, onChange } = ctx;
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'es-input es-input-number';
    input.value = String(value ?? 0);

    if (meta.min !== undefined) input.min = String(meta.min);
    if (meta.max !== undefined) input.max = String(meta.max);
    if (meta.step !== undefined) input.step = String(meta.step);

    input.addEventListener('change', () => {
        onChange(parseFloat(input.value) || 0);
    });

    container.appendChild(input);

    return {
        update(v: unknown) {
            input.value = String(v ?? 0);
        },
        dispose() {
            input.remove();
        },
    };
}

// =============================================================================
// String Editor
// =============================================================================

function createStringEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange } = ctx;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'es-input es-input-string';
    input.value = String(value ?? '');

    input.addEventListener('change', () => {
        onChange(input.value);
    });

    container.appendChild(input);

    return {
        update(v: unknown) {
            input.value = String(v ?? '');
        },
        dispose() {
            input.remove();
        },
    };
}

// =============================================================================
// Boolean Editor
// =============================================================================

function createBooleanEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange } = ctx;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'es-input es-input-checkbox';
    input.checked = Boolean(value);

    input.addEventListener('change', () => {
        onChange(input.checked);
    });

    container.appendChild(input);

    return {
        update(v: unknown) {
            input.checked = Boolean(v);
        },
        dispose() {
            input.remove();
        },
    };
}

// =============================================================================
// Vec2 Editor
// =============================================================================

interface Vec2 {
    x: number;
    y: number;
}

function createVec2Editor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange } = ctx;
    const vec = (value as Vec2) ?? { x: 0, y: 0 };

    const wrapper = document.createElement('div');
    wrapper.className = 'es-vec-editor es-vec2-editor';

    const inputs: HTMLInputElement[] = [];
    const labels = ['X', 'Y'];

    labels.forEach((label, i) => {
        const group = document.createElement('div');
        group.className = 'es-vec-field';

        const span = document.createElement('span');
        span.className = 'es-vec-label';
        span.textContent = label;

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'es-input es-input-number';
        input.step = '0.01';
        input.value = String(i === 0 ? vec.x : vec.y);

        input.addEventListener('change', () => {
            const newVec = { ...vec };
            if (i === 0) newVec.x = parseFloat(input.value) || 0;
            else newVec.y = parseFloat(input.value) || 0;
            onChange(newVec);
        });

        group.appendChild(span);
        group.appendChild(input);
        wrapper.appendChild(group);
        inputs.push(input);
    });

    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            const newVec = (v as Vec2) ?? { x: 0, y: 0 };
            inputs[0].value = String(newVec.x);
            inputs[1].value = String(newVec.y);
        },
        dispose() {
            wrapper.remove();
        },
    };
}

// =============================================================================
// Vec3 Editor
// =============================================================================

interface Vec3 {
    x: number;
    y: number;
    z: number;
}

function createVec3Editor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange } = ctx;
    const vec = (value as Vec3) ?? { x: 0, y: 0, z: 0 };

    const wrapper = document.createElement('div');
    wrapper.className = 'es-vec-editor es-vec3-editor';

    const inputs: HTMLInputElement[] = [];
    const labels = ['X', 'Y', 'Z'];
    const keys: (keyof Vec3)[] = ['x', 'y', 'z'];

    labels.forEach((label, i) => {
        const group = document.createElement('div');
        group.className = 'es-vec-field';

        const span = document.createElement('span');
        span.className = 'es-vec-label';
        span.textContent = label;

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'es-input es-input-number';
        input.step = '0.01';
        input.value = String(vec[keys[i]]);

        input.addEventListener('change', () => {
            const newVec = { ...vec };
            newVec[keys[i]] = parseFloat(input.value) || 0;
            onChange(newVec);
        });

        group.appendChild(span);
        group.appendChild(input);
        wrapper.appendChild(group);
        inputs.push(input);
    });

    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            const newVec = (v as Vec3) ?? { x: 0, y: 0, z: 0 };
            inputs[0].value = String(newVec.x);
            inputs[1].value = String(newVec.y);
            inputs[2].value = String(newVec.z);
        },
        dispose() {
            wrapper.remove();
        },
    };
}

// =============================================================================
// Vec4 Editor
// =============================================================================

interface Vec4 {
    x: number;
    y: number;
    z: number;
    w: number;
}

function createVec4Editor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange } = ctx;
    const vec = (value as Vec4) ?? { x: 0, y: 0, z: 0, w: 1 };

    const wrapper = document.createElement('div');
    wrapper.className = 'es-vec-editor es-vec4-editor';

    const inputs: HTMLInputElement[] = [];
    const labels = ['X', 'Y', 'Z', 'W'];
    const keys: (keyof Vec4)[] = ['x', 'y', 'z', 'w'];

    labels.forEach((label, i) => {
        const group = document.createElement('div');
        group.className = 'es-vec-field';

        const span = document.createElement('span');
        span.className = 'es-vec-label';
        span.textContent = label;

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'es-input es-input-number';
        input.step = '0.01';
        input.value = String(vec[keys[i]]);

        input.addEventListener('change', () => {
            const newVec = { ...vec };
            newVec[keys[i]] = parseFloat(input.value) || 0;
            onChange(newVec);
        });

        group.appendChild(span);
        group.appendChild(input);
        wrapper.appendChild(group);
        inputs.push(input);
    });

    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            const newVec = (v as Vec4) ?? { x: 0, y: 0, z: 0, w: 1 };
            inputs[0].value = String(newVec.x);
            inputs[1].value = String(newVec.y);
            inputs[2].value = String(newVec.z);
            inputs[3].value = String(newVec.w);
        },
        dispose() {
            wrapper.remove();
        },
    };
}

// =============================================================================
// Color Editor
// =============================================================================

function createColorEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange } = ctx;
    const color = (value as Vec4) ?? { x: 1, y: 1, z: 1, w: 1 };

    const wrapper = document.createElement('div');
    wrapper.className = 'es-color-editor';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'es-input es-input-color';
    colorInput.value = vec4ToHex(color);

    const alphaInput = document.createElement('input');
    alphaInput.type = 'number';
    alphaInput.className = 'es-input es-input-number es-input-alpha';
    alphaInput.min = '0';
    alphaInput.max = '1';
    alphaInput.step = '0.01';
    alphaInput.value = String(color.w);

    const updateColor = () => {
        const hex = colorInput.value;
        const newColor = hexToVec4(hex);
        newColor.w = parseFloat(alphaInput.value) || 1;
        onChange(newColor);
    };

    colorInput.addEventListener('change', updateColor);
    alphaInput.addEventListener('change', updateColor);

    wrapper.appendChild(colorInput);
    wrapper.appendChild(alphaInput);
    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            const newColor = (v as Vec4) ?? { x: 1, y: 1, z: 1, w: 1 };
            colorInput.value = vec4ToHex(newColor);
            alphaInput.value = String(newColor.w);
        },
        dispose() {
            wrapper.remove();
        },
    };
}

function vec4ToHex(color: Vec4): string {
    const r = Math.round(color.x * 255).toString(16).padStart(2, '0');
    const g = Math.round(color.y * 255).toString(16).padStart(2, '0');
    const b = Math.round(color.z * 255).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
}

function hexToVec4(hex: string): Vec4 {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return { x: r, y: g, z: b, w: 1 };
}

// =============================================================================
// Enum Editor
// =============================================================================

function createEnumEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, meta, onChange } = ctx;
    const options = meta.options ?? [];

    const select = document.createElement('select');
    select.className = 'es-input es-input-select';

    options.forEach(opt => {
        const option = document.createElement('option');
        option.value = String(opt.value);
        option.textContent = opt.label;
        if (opt.value === value) {
            option.selected = true;
        }
        select.appendChild(option);
    });

    select.addEventListener('change', () => {
        const selected = options.find(o => String(o.value) === select.value);
        if (selected) {
            onChange(selected.value);
        }
    });

    container.appendChild(select);

    return {
        update(v: unknown) {
            select.value = String(v);
        },
        dispose() {
            select.remove();
        },
    };
}

// =============================================================================
// Register All Editors
// =============================================================================

export function registerBuiltinEditors(): void {
    registerPropertyEditor('number', createNumberEditor);
    registerPropertyEditor('string', createStringEditor);
    registerPropertyEditor('boolean', createBooleanEditor);
    registerPropertyEditor('vec2', createVec2Editor);
    registerPropertyEditor('vec3', createVec3Editor);
    registerPropertyEditor('vec4', createVec4Editor);
    registerPropertyEditor('color', createColorEditor);
    registerPropertyEditor('enum', createEnumEditor);
}

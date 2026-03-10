/**
 * @file    SharedEditors.ts
 * @brief   Shared editor factory functions for float, int, vec, color, texture editors
 */

import type { ShaderProperty } from '../../shader/ShaderPropertyParser';
import { ShaderPropertyType, getDefaultPropertyValue } from '../../shader/ShaderPropertyParser';
import { openAssetInBrowser } from './InspectorHelpers';
import { setupDragLabel } from '../../property/editorUtils';
import { handleAssetDrop, BROWSE_ICON } from '../../property/editors';
import { showAssetPicker } from '../../ui/asset-picker';
import { AssetType } from '../../constants/AssetTypes';

// =============================================================================
// Numeric Editors
// =============================================================================

export function createFloatEditor(
    container: HTMLElement,
    value: number,
    onChange: (v: number) => void,
    min?: number,
    max?: number,
    step?: number
): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'es-number-editor';

    const label = document.createElement('span');
    label.className = 'es-number-drag-label';
    label.innerHTML = '⋮⋮';
    label.title = 'Drag to adjust value';

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'es-input es-input-number';
    input.step = String(step ?? 0.01);
    input.value = String(parseFloat((value ?? 0).toFixed(4)));
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    input.addEventListener('change', () => {
        let val = parseFloat(input.value) || 0;
        if (min !== undefined && val < min) val = min;
        if (max !== undefined && val > max) val = max;
        val = parseFloat(val.toFixed(4));
        input.value = String(val);
        onChange(val);
    });

    setupDragLabel(label, input, (v) => onChange(parseFloat(v.toFixed(4))), step ?? 0.01, min, max);

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    container.appendChild(wrapper);
}

export function createIntEditor(
    container: HTMLElement,
    value: number,
    onChange: (v: number) => void,
    min?: number,
    max?: number,
    step?: number
): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'es-number-editor';

    const label = document.createElement('span');
    label.className = 'es-number-drag-label';
    label.innerHTML = '⋮⋮';
    label.title = 'Drag to adjust value';

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'es-input es-input-number';
    input.step = String(step ?? 1);
    input.value = String(value ?? 0);
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    input.addEventListener('change', () => {
        let val = parseInt(input.value, 10) || 0;
        if (min !== undefined && val < min) val = min;
        if (max !== undefined && val > max) val = max;
        input.value = String(val);
        onChange(val);
    });

    setupDragLabel(label, input, (v) => onChange(Math.round(v)), step ?? 1, min, max);

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    container.appendChild(wrapper);
}

// =============================================================================
// Vector Editors
// =============================================================================

export function createVec2Editor(
    container: HTMLElement,
    value: { x: number; y: number },
    onChange: (v: { x: number; y: number }) => void
): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'es-vec-editor es-vec2-editor';

    const val = value ?? { x: 0, y: 0 };
    const keys: ('x' | 'y')[] = ['x', 'y'];
    const labels = ['X', 'Y'];
    const classes = ['es-vec-x', 'es-vec-y'];

    keys.forEach((key, i) => {
        const group = document.createElement('div');
        group.className = `es-vec-field ${classes[i]}`;

        const label = document.createElement('span');
        label.className = 'es-vec-label';
        label.textContent = labels[i];

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'es-input es-input-number';
        input.step = '0.01';
        input.value = String(parseFloat(val[key].toFixed(4)));
        input.addEventListener('change', () => {
            val[key] = parseFloat((parseFloat(input.value) || 0).toFixed(4));
            onChange({ ...val });
        });

        setupDragLabel(label, input, (v) => {
            val[key] = parseFloat(v.toFixed(4));
            onChange({ ...val });
        });

        group.appendChild(label);
        group.appendChild(input);
        wrapper.appendChild(group);
    });

    container.appendChild(wrapper);
}

export function createVec3Editor(
    container: HTMLElement,
    value: { x: number; y: number; z: number },
    onChange: (v: { x: number; y: number; z: number }) => void
): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'es-vec-editor es-vec3-editor';

    const val = value ?? { x: 0, y: 0, z: 0 };
    const keys: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
    const labels = ['X', 'Y', 'Z'];
    const classes = ['es-vec-x', 'es-vec-y', 'es-vec-z'];

    keys.forEach((key, i) => {
        const group = document.createElement('div');
        group.className = `es-vec-field ${classes[i]}`;

        const label = document.createElement('span');
        label.className = 'es-vec-label';
        label.textContent = labels[i];

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'es-input es-input-number';
        input.step = '0.01';
        input.value = String(parseFloat(val[key].toFixed(4)));
        input.addEventListener('change', () => {
            val[key] = parseFloat((parseFloat(input.value) || 0).toFixed(4));
            onChange({ ...val });
        });

        setupDragLabel(label, input, (v) => {
            val[key] = parseFloat(v.toFixed(4));
            onChange({ ...val });
        });

        group.appendChild(label);
        group.appendChild(input);
        wrapper.appendChild(group);
    });

    container.appendChild(wrapper);
}

export function createVec4Editor(
    container: HTMLElement,
    value: { x: number; y: number; z: number; w: number },
    onChange: (v: { x: number; y: number; z: number; w: number }) => void
): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'es-vec-editor es-vec4-editor';

    const val = value ?? { x: 0, y: 0, z: 0, w: 1 };
    const keys: ('x' | 'y' | 'z' | 'w')[] = ['x', 'y', 'z', 'w'];
    const labels = ['X', 'Y', 'Z', 'W'];
    const classes = ['es-vec-x', 'es-vec-y', 'es-vec-z', 'es-vec-w'];

    keys.forEach((key, i) => {
        const group = document.createElement('div');
        group.className = `es-vec-field ${classes[i]}`;

        const label = document.createElement('span');
        label.className = 'es-vec-label';
        label.textContent = labels[i];

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'es-input es-input-number';
        input.step = '0.01';
        input.value = String(parseFloat(val[key].toFixed(4)));
        input.addEventListener('change', () => {
            val[key] = parseFloat((parseFloat(input.value) || 0).toFixed(4));
            onChange({ ...val });
        });

        setupDragLabel(label, input, (v) => {
            val[key] = parseFloat(v.toFixed(4));
            onChange({ ...val });
        });

        group.appendChild(label);
        group.appendChild(input);
        wrapper.appendChild(group);
    });

    container.appendChild(wrapper);
}

// =============================================================================
// Color Editor
// =============================================================================

export function colorToHex(color: { r: number; g: number; b: number; a: number }): string {
    const clamp = (v: number) => Math.max(0, Math.min(255, Math.round((Number.isFinite(v) ? v : 0) * 255)));
    const r = clamp(color.r).toString(16).padStart(2, '0');
    const g = clamp(color.g).toString(16).padStart(2, '0');
    const b = clamp(color.b).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
}

export function hexToColor(hex: string): { r: number; g: number; b: number; a: number } {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return { r, g, b, a: 1 };
}

export function createColorEditor(
    container: HTMLElement,
    value: { r: number; g: number; b: number; a: number },
    onChange: (v: { r: number; g: number; b: number; a: number }) => void
): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'es-color-editor';

    const val = value ?? { r: 1, g: 1, b: 1, a: 1 };

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'es-input es-input-color';
    colorInput.value = colorToHex(val);

    const alphaInput = document.createElement('input');
    alphaInput.type = 'number';
    alphaInput.className = 'es-input es-input-number es-input-alpha';
    alphaInput.min = '0';
    alphaInput.max = '1';
    alphaInput.step = '0.01';
    alphaInput.value = String(val.a);

    const update = () => {
        const hex = colorInput.value;
        const newColor = hexToColor(hex);
        newColor.a = parseFloat(alphaInput.value) || 1;
        onChange(newColor);
    };

    colorInput.addEventListener('input', update);
    colorInput.addEventListener('change', update);
    alphaInput.addEventListener('change', update);

    wrapper.appendChild(colorInput);
    wrapper.appendChild(alphaInput);
    container.appendChild(wrapper);
}

// =============================================================================
// Texture Editor
// =============================================================================

export function createTextureEditor(container: HTMLElement, value: string, onChange: (v: string) => void): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'es-file-editor';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'es-input es-input-file es-asset-link';
    input.value = value ?? '';
    input.placeholder = 'None';
    input.readOnly = true;

    const browseBtn = document.createElement('button');
    browseBtn.className = 'es-btn es-btn-icon es-btn-browse';
    browseBtn.title = 'Browse';
    browseBtn.innerHTML = BROWSE_ICON;

    input.addEventListener('click', () => {
        if (input.value) openAssetInBrowser(input.value);
    });

    handleAssetDrop(wrapper, [AssetType.IMAGE], (relativePath) => {
        input.value = relativePath;
        onChange(relativePath);
    });

    browseBtn.addEventListener('click', async () => {
        const result = await showAssetPicker({ title: 'Select Texture', allowedTypes: ['image'], extensions: ['png', 'jpg', 'jpeg', 'webp'] });
        if (result) {
            input.value = result.relativePath;
            onChange(result.relativePath);
        }
    });

    wrapper.appendChild(input);
    wrapper.appendChild(browseBtn);
    container.appendChild(wrapper);
}

// =============================================================================
// Shader Property Router
// =============================================================================

export function createPropertyEditorForType(
    container: HTMLElement,
    prop: ShaderProperty,
    value: unknown,
    onChange: (value: unknown) => void
): void {
    switch (prop.type) {
        case ShaderPropertyType.Float:
            createFloatEditor(container, value as number, onChange, prop.min, prop.max, prop.step);
            break;
        case ShaderPropertyType.Int:
            createIntEditor(container, value as number, onChange, prop.min, prop.max, prop.step);
            break;
        case ShaderPropertyType.Vec2:
            createVec2Editor(container, value as { x: number; y: number }, onChange);
            break;
        case ShaderPropertyType.Vec3:
            createVec3Editor(container, value as { x: number; y: number; z: number }, onChange);
            break;
        case ShaderPropertyType.Vec4:
            createVec4Editor(container, value as { x: number; y: number; z: number; w: number }, onChange);
            break;
        case ShaderPropertyType.Color:
            createColorEditor(container, value as { r: number; g: number; b: number; a: number }, onChange);
            break;
        case ShaderPropertyType.Texture:
            createTextureEditor(container, value as string, onChange);
            break;
        default:
            container.textContent = 'Unknown type';
    }
}

// =============================================================================
// Shader File Input
// =============================================================================

export function createShaderFileInput(
    container: HTMLElement,
    currentPath: string,
    onChange: (path: string) => void
): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'es-file-editor';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'es-input es-input-file es-asset-link';
    input.value = currentPath;
    input.placeholder = 'None';
    input.readOnly = true;

    const browseBtn = document.createElement('button');
    browseBtn.className = 'es-btn es-btn-icon es-btn-browse';
    browseBtn.title = 'Browse';
    browseBtn.innerHTML = BROWSE_ICON;

    input.addEventListener('click', () => {
        if (input.value) openAssetInBrowser(input.value);
    });

    handleAssetDrop(wrapper, [AssetType.SHADER], (relativePath) => {
        input.value = relativePath;
        onChange(relativePath);
    });

    browseBtn.addEventListener('click', async () => {
        const result = await showAssetPicker({ title: 'Select Shader', extensions: ['esshader'] });
        if (result) {
            input.value = result.relativePath;
            onChange(result.relativePath);
        }
    });

    wrapper.appendChild(input);
    wrapper.appendChild(browseBtn);
    container.appendChild(wrapper);
}

export function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object' || a === null || b === null) return false;

    const keysA = Object.keys(a as object);
    const keysB = Object.keys(b as object);
    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
        if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
            return false;
        }
    }
    return true;
}

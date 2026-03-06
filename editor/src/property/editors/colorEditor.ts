import {
    type PropertyEditorContext,
    type PropertyEditorInstance,
} from '../PropertyEditor';
import { colorToHex, hexToColor } from '../editorUtils';

type RGBA = { r: number; g: number; b: number; a: number };

function sanitizeColor(color: RGBA | null | undefined): RGBA {
    if (!color || typeof color !== 'object') return { r: 1, g: 1, b: 1, a: 1 };
    const s = (v: unknown) => (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
    return { r: s(color.r), g: s(color.g), b: s(color.b), a: s(color.a) || 1 };
}

export function createColorEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange } = ctx;
    const raw = value as { r: number; g: number; b: number; a: number } | null | undefined;
    const color = sanitizeColor(raw);

    const wrapper = document.createElement('div');
    wrapper.className = 'es-color-editor';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'es-input es-input-color';
    colorInput.value = colorToHex(color);

    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'es-input es-input-hex';
    hexInput.value = colorToHex(color).toUpperCase();

    const alphaInput = document.createElement('input');
    alphaInput.type = 'number';
    alphaInput.className = 'es-input es-input-number es-input-alpha';
    alphaInput.min = '0';
    alphaInput.max = '1';
    alphaInput.step = '0.01';
    alphaInput.value = String(color.a);

    const applyColor = (hex: string, alpha: number) => {
        const newColor = hexToColor(hex);
        newColor.a = alpha;
        onChange(newColor);
    };

    colorInput.addEventListener('change', () => {
        hexInput.value = colorInput.value.toUpperCase();
        applyColor(colorInput.value, parseFloat(alphaInput.value) || 1);
    });

    alphaInput.addEventListener('change', () => {
        applyColor(colorInput.value, parseFloat(alphaInput.value) || 1);
    });

    hexInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        let hex = hexInput.value.trim();
        if (!hex.startsWith('#')) hex = '#' + hex;
        if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
            colorInput.value = hex;
            hexInput.value = hex.toUpperCase();
            applyColor(hex, parseFloat(alphaInput.value) || 1);
        } else {
            hexInput.value = colorInput.value.toUpperCase();
        }
    });

    wrapper.appendChild(colorInput);
    wrapper.appendChild(hexInput);
    wrapper.appendChild(alphaInput);
    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            const newColor = sanitizeColor(v as { r: number; g: number; b: number; a: number } | null | undefined);
            colorInput.value = colorToHex(newColor);
            hexInput.value = colorToHex(newColor).toUpperCase();
            alphaInput.value = String(newColor.a);
        },
        dispose() {
            wrapper.remove();
        },
    };
}

import {
    type PropertyEditorContext,
    type PropertyEditorInstance,
} from '../PropertyEditor';

const AVAILABLE_FONTS = [
    'Arial',
    'Helvetica',
    'Times New Roman',
    'Georgia',
    'Verdana',
    'Tahoma',
    'Trebuchet MS',
    'Courier New',
    'Lucida Console',
    'Impact',
    'Comic Sans MS',
    'Microsoft YaHei',
    'SimHei',
    'SimSun',
    'KaiTi',
    'FangSong',
];

function getAvailableFonts(): string[] {
    const testString = 'mmmmmmmmmmlli';
    const testSize = '72px';
    const baseline = 'monospace';

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.font = `${testSize} ${baseline}`;
    const baselineWidth = ctx.measureText(testString).width;

    const available: string[] = [];
    for (const font of AVAILABLE_FONTS) {
        ctx.font = `${testSize} "${font}", ${baseline}`;
        const width = ctx.measureText(testString).width;
        if (width !== baselineWidth) {
            available.push(font);
        }
    }

    return available.length > 0 ? available : ['Arial', 'sans-serif'];
}

export function createFontEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange } = ctx;

    const wrapper = document.createElement('div');
    wrapper.className = 'es-font-editor';

    const select = document.createElement('select');
    select.className = 'es-input es-input-select';

    const fonts = getAvailableFonts();
    const currentFont = String(value ?? 'Arial');

    if (!fonts.includes(currentFont)) {
        fonts.unshift(currentFont);
    }

    for (const font of fonts) {
        const option = document.createElement('option');
        option.value = font;
        option.textContent = font;
        option.style.fontFamily = font;
        if (font === currentFont) {
            option.selected = true;
        }
        select.appendChild(option);
    }

    select.addEventListener('change', () => {
        onChange(select.value);
    });

    wrapper.appendChild(select);
    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            select.value = String(v ?? 'Arial');
        },
        dispose() {
            wrapper.remove();
        },
    };
}

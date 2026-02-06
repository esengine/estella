/**
 * @file    editors.ts
 * @brief   Built-in property editors
 */

import {
    registerPropertyEditor,
    type PropertyEditorContext,
    type PropertyEditorInstance,
} from './PropertyEditor';
import { getPlatformAdapter } from '../platform/PlatformAdapter';

// =============================================================================
// Drag Helper
// =============================================================================

function setupDragLabel(
    label: HTMLElement,
    input: HTMLInputElement,
    onChange: (delta: number) => void,
    step: number = 0.1
): void {
    let startX = 0;
    let startValue = 0;
    let isDragging = false;

    const onMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;
        const delta = (e.clientX - startX) * step;
        const newValue = startValue + delta;
        input.value = newValue.toFixed(2);
        onChange(newValue);
    };

    const onMouseUp = () => {
        isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
    };

    label.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isDragging = true;
        startX = e.clientX;
        startValue = parseFloat(input.value) || 0;
        document.body.style.cursor = 'ew-resize';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

// =============================================================================
// Number Editor
// =============================================================================

function createNumberEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, meta, onChange } = ctx;

    const wrapper = document.createElement('div');
    wrapper.className = 'es-number-editor';

    const label = document.createElement('span');
    label.className = 'es-number-drag-label';
    label.innerHTML = '⋮⋮';
    label.title = 'Drag to adjust value';

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'es-input es-input-number';
    input.value = String(value ?? 0);

    if (meta.min !== undefined) input.min = String(meta.min);
    if (meta.max !== undefined) input.max = String(meta.max);
    if (meta.step !== undefined) input.step = String(meta.step);

    const step = meta.step ?? 1;

    input.addEventListener('change', () => {
        onChange(parseFloat(input.value) || 0);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            input.blur();
            onChange(parseFloat(input.value) || 0);
        }
    });

    setupDragLabel(label, input, (newValue) => {
        onChange(newValue);
    }, step);

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            input.value = String(v ?? 0);
        },
        dispose() {
            wrapper.remove();
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
    let currentVec = (value as Vec2) ?? { x: 0, y: 0 };

    const wrapper = document.createElement('div');
    wrapper.className = 'es-vec-editor es-vec2-editor';

    const inputs: HTMLInputElement[] = [];
    const labelTexts = ['X', 'Y'];
    const colorClasses = ['es-vec-x', 'es-vec-y'];
    const keys: (keyof Vec2)[] = ['x', 'y'];

    labelTexts.forEach((labelText, i) => {
        const group = document.createElement('div');
        group.className = `es-vec-field ${colorClasses[i]}`;

        const label = document.createElement('span');
        label.className = 'es-vec-label';
        label.textContent = labelText;

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'es-input es-input-number';
        input.step = '0.01';
        input.value = String(currentVec[keys[i]]);

        input.addEventListener('change', () => {
            currentVec = { ...currentVec, [keys[i]]: parseFloat(input.value) || 0 };
            onChange(currentVec);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur();
                currentVec = { ...currentVec, [keys[i]]: parseFloat(input.value) || 0 };
                onChange(currentVec);
            }
        });

        setupDragLabel(label, input, (newValue) => {
            currentVec = { ...currentVec, [keys[i]]: newValue };
            onChange(currentVec);
        });

        group.appendChild(label);
        group.appendChild(input);
        wrapper.appendChild(group);
        inputs.push(input);
    });

    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            currentVec = (v as Vec2) ?? { x: 0, y: 0 };
            inputs[0].value = String(currentVec.x);
            inputs[1].value = String(currentVec.y);
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
    let currentVec = (value as Vec3) ?? { x: 0, y: 0, z: 0 };

    const wrapper = document.createElement('div');
    wrapper.className = 'es-vec-editor es-vec3-editor';

    const inputs: HTMLInputElement[] = [];
    const labelTexts = ['X', 'Y', 'Z'];
    const keys: (keyof Vec3)[] = ['x', 'y', 'z'];
    const colorClasses = ['es-vec-x', 'es-vec-y', 'es-vec-z'];

    labelTexts.forEach((labelText, i) => {
        const group = document.createElement('div');
        group.className = `es-vec-field ${colorClasses[i]}`;

        const label = document.createElement('span');
        label.className = 'es-vec-label';
        label.textContent = labelText;

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'es-input es-input-number';
        input.step = '0.01';
        input.value = String(currentVec[keys[i]]);

        input.addEventListener('change', () => {
            currentVec = { ...currentVec, [keys[i]]: parseFloat(input.value) || 0 };
            onChange(currentVec);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur();
                currentVec = { ...currentVec, [keys[i]]: parseFloat(input.value) || 0 };
                onChange(currentVec);
            }
        });

        setupDragLabel(label, input, (newValue) => {
            currentVec = { ...currentVec, [keys[i]]: newValue };
            onChange(currentVec);
        });

        group.appendChild(label);
        group.appendChild(input);
        wrapper.appendChild(group);
        inputs.push(input);
    });

    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            currentVec = (v as Vec3) ?? { x: 0, y: 0, z: 0 };
            inputs[0].value = String(currentVec.x);
            inputs[1].value = String(currentVec.y);
            inputs[2].value = String(currentVec.z);
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
    let currentVec = (value as Vec4) ?? { x: 0, y: 0, z: 0, w: 1 };

    const wrapper = document.createElement('div');
    wrapper.className = 'es-vec-editor es-vec4-editor';

    const inputs: HTMLInputElement[] = [];
    const labelTexts = ['X', 'Y', 'Z', 'W'];
    const keys: (keyof Vec4)[] = ['x', 'y', 'z', 'w'];
    const colorClasses = ['es-vec-x', 'es-vec-y', 'es-vec-z', 'es-vec-w'];

    labelTexts.forEach((labelText, i) => {
        const group = document.createElement('div');
        group.className = `es-vec-field ${colorClasses[i]}`;

        const label = document.createElement('span');
        label.className = 'es-vec-label';
        label.textContent = labelText;

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'es-input es-input-number';
        input.step = '0.01';
        input.value = String(currentVec[keys[i]]);

        input.addEventListener('change', () => {
            currentVec = { ...currentVec, [keys[i]]: parseFloat(input.value) || 0 };
            onChange(currentVec);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur();
                currentVec = { ...currentVec, [keys[i]]: parseFloat(input.value) || 0 };
                onChange(currentVec);
            }
        });

        setupDragLabel(label, input, (newValue) => {
            currentVec = { ...currentVec, [keys[i]]: newValue };
            onChange(currentVec);
        });

        group.appendChild(label);
        group.appendChild(input);
        wrapper.appendChild(group);
        inputs.push(input);
    });

    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            currentVec = (v as Vec4) ?? { x: 0, y: 0, z: 0, w: 1 };
            inputs[0].value = String(currentVec.x);
            inputs[1].value = String(currentVec.y);
            inputs[2].value = String(currentVec.z);
            inputs[3].value = String(currentVec.w);
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
// Euler Angle Editor (displays degrees, stores as quaternion)
// =============================================================================

interface Quat {
    x: number;
    y: number;
    z: number;
    w: number;
}

interface EulerAngles {
    x: number;
    y: number;
    z: number;
}

function quatToEuler(q: Quat): EulerAngles {
    const { x, y, z, w } = q;

    const sinrCosp = 2 * (w * x + y * z);
    const cosrCosp = 1 - 2 * (x * x + y * y);
    const roll = Math.atan2(sinrCosp, cosrCosp);

    const sinp = 2 * (w * y - z * x);
    let pitch: number;
    if (Math.abs(sinp) >= 1) {
        pitch = Math.sign(sinp) * Math.PI / 2;
    } else {
        pitch = Math.asin(sinp);
    }

    const sinyCosp = 2 * (w * z + x * y);
    const cosyCosp = 1 - 2 * (y * y + z * z);
    const yaw = Math.atan2(sinyCosp, cosyCosp);

    const toDeg = 180 / Math.PI;
    return {
        x: roll * toDeg,
        y: pitch * toDeg,
        z: yaw * toDeg,
    };
}

function eulerToQuat(euler: EulerAngles): Quat {
    const toRad = Math.PI / 180;
    const roll = euler.x * toRad;
    const pitch = euler.y * toRad;
    const yaw = euler.z * toRad;

    const cr = Math.cos(roll * 0.5);
    const sr = Math.sin(roll * 0.5);
    const cp = Math.cos(pitch * 0.5);
    const sp = Math.sin(pitch * 0.5);
    const cy = Math.cos(yaw * 0.5);
    const sy = Math.sin(yaw * 0.5);

    return {
        w: cr * cp * cy + sr * sp * sy,
        x: sr * cp * cy - cr * sp * sy,
        y: cr * sp * cy + sr * cp * sy,
        z: cr * cp * sy - sr * sp * cy,
    };
}

function createEulerEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange } = ctx;
    const quat = (value as Quat) ?? { x: 0, y: 0, z: 0, w: 1 };
    let currentEuler = quatToEuler(quat);

    const wrapper = document.createElement('div');
    wrapper.className = 'es-vec-editor es-vec3-editor';

    const inputs: HTMLInputElement[] = [];
    const labelTexts = ['X', 'Y', 'Z'];
    const keys: (keyof EulerAngles)[] = ['x', 'y', 'z'];
    const colorClasses = ['es-vec-x', 'es-vec-y', 'es-vec-z'];

    labelTexts.forEach((labelText, i) => {
        const group = document.createElement('div');
        group.className = `es-vec-field ${colorClasses[i]}`;

        const label = document.createElement('span');
        label.className = 'es-vec-label';
        label.textContent = labelText;

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'es-input es-input-number';
        input.step = '0.1';
        input.value = currentEuler[keys[i]].toFixed(1);

        input.addEventListener('change', () => {
            currentEuler = { ...currentEuler, [keys[i]]: parseFloat(input.value) || 0 };
            onChange(eulerToQuat(currentEuler));
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur();
                currentEuler = { ...currentEuler, [keys[i]]: parseFloat(input.value) || 0 };
                onChange(eulerToQuat(currentEuler));
            }
        });

        setupDragLabel(label, input, (newValue) => {
            currentEuler = { ...currentEuler, [keys[i]]: newValue };
            onChange(eulerToQuat(currentEuler));
        }, 1);

        group.appendChild(label);
        group.appendChild(input);
        wrapper.appendChild(group);
        inputs.push(input);
    });

    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            const q = (v as Quat) ?? { x: 0, y: 0, z: 0, w: 1 };
            currentEuler = quatToEuler(q);
            inputs[0].value = currentEuler.x.toFixed(1);
            inputs[1].value = currentEuler.y.toFixed(1);
            inputs[2].value = currentEuler.z.toFixed(1);
        },
        dispose() {
            wrapper.remove();
        },
    };
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
// Texture Editor
// =============================================================================

interface NativeFS {
    readFile(path: string): Promise<string | null>;
    readBinaryFile(path: string): Promise<Uint8Array | null>;
}

function getNativeFS(): NativeFS | null {
    return (window as any).__esengine_fs ?? null;
}

function getProjectDir(): string | null {
    const editor = (window as any).__esengine_editor;
    const projectPath = editor?.projectPath;
    if (!projectPath) return null;
    return projectPath.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
}

function getMimeType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'png': return 'image/png';
        case 'jpg':
        case 'jpeg': return 'image/jpeg';
        case 'gif': return 'image/gif';
        case 'webp': return 'image/webp';
        case 'bmp': return 'image/bmp';
        default: return 'image/png';
    }
}

function createTextureEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange } = ctx;
    let currentBlobUrl: string | null = null;

    const wrapper = document.createElement('div');
    wrapper.className = 'es-texture-editor';

    const preview = document.createElement('div');
    preview.className = 'es-texture-preview';
    preview.title = 'Click to locate in Content Browser';

    const previewImg = document.createElement('img');
    previewImg.className = 'es-texture-preview-img';
    preview.appendChild(previewImg);

    const inputRow = document.createElement('div');
    inputRow.className = 'es-texture-input-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'es-input es-input-texture';
    input.value = String(value ?? '');
    input.placeholder = 'None';

    const browseBtn = document.createElement('button');
    browseBtn.className = 'es-btn es-btn-icon es-btn-browse';
    browseBtn.title = 'Browse';
    browseBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"></path></svg>`;

    const locateBtn = document.createElement('button');
    locateBtn.className = 'es-btn es-btn-icon es-btn-locate';
    locateBtn.title = 'Locate in Content Browser';
    locateBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.35-4.35"></path></svg>`;

    const updatePreview = async (texturePath: string) => {
        if (currentBlobUrl) {
            URL.revokeObjectURL(currentBlobUrl);
            currentBlobUrl = null;
        }

        const projectDir = getProjectDir();
        const fs = getNativeFS();

        if (texturePath && projectDir && fs) {
            const fullPath = `${projectDir}/${texturePath}`;
            try {
                const data = await fs.readBinaryFile(fullPath);
                if (data) {
                    const blob = new Blob([data.buffer as ArrayBuffer], { type: getMimeType(texturePath) });
                    currentBlobUrl = URL.createObjectURL(blob);
                    previewImg.src = currentBlobUrl;
                    previewImg.style.display = 'block';
                    preview.classList.add('es-has-preview');
                    return;
                }
            } catch (err) {
                console.warn('Failed to load texture preview:', err);
            }
        }

        previewImg.src = '';
        previewImg.style.display = 'none';
        preview.classList.remove('es-has-preview');
    };

    const navigateToAsset = async (e: Event) => {
        e.stopPropagation();
        const texturePath = input.value;
        if (!texturePath) return;

        const editor = (window as any).__esengine_editor;
        if (editor?.navigateToAsset) {
            await editor.navigateToAsset(texturePath);
        }
    };

    updatePreview(String(value ?? ''));

    input.addEventListener('change', () => {
        const newValue = input.value || '';
        onChange(newValue);
        updatePreview(newValue);
    });

    preview.addEventListener('click', navigateToAsset);
    locateBtn.addEventListener('click', navigateToAsset);

    browseBtn.addEventListener('click', async () => {
        const projectDir = getProjectDir();
        if (!projectDir) return;

        const assetsDir = `${projectDir}/assets`;

        try {
            const platform = getPlatformAdapter();
            const result = await platform.openFileDialog({
                title: 'Select Texture',
                defaultPath: assetsDir,
                filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
            });
            if (result) {
                const normalizedPath = result.replace(/\\/g, '/');
                const assetsIndex = normalizedPath.indexOf('/assets/');
                if (assetsIndex !== -1) {
                    const relativePath = normalizedPath.substring(assetsIndex + 1);
                    input.value = relativePath;
                    onChange(relativePath);
                    updatePreview(relativePath);
                }
            }
        } catch (err) {
            console.error('Failed to open file dialog:', err);
        }
    });

    inputRow.appendChild(input);
    inputRow.appendChild(browseBtn);
    inputRow.appendChild(locateBtn);
    wrapper.appendChild(preview);
    wrapper.appendChild(inputRow);
    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            const newValue = String(v ?? '');
            input.value = newValue;
            updatePreview(newValue);
        },
        dispose() {
            if (currentBlobUrl) {
                URL.revokeObjectURL(currentBlobUrl);
            }
            wrapper.remove();
        },
    };
}

// =============================================================================
// Font Editor
// =============================================================================

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

function createFontEditor(
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

// =============================================================================
// Spine File Editor
// =============================================================================

function createSpineFileEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, meta, onChange } = ctx;
    const fileFilter = meta.fileFilter ?? ['.json', '.skel'];

    const wrapper = document.createElement('div');
    wrapper.className = 'es-file-editor';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'es-input es-input-file';
    input.value = String(value ?? '');
    input.placeholder = 'None';

    const browseBtn = document.createElement('button');
    browseBtn.className = 'es-btn es-btn-icon es-btn-browse';
    browseBtn.title = 'Browse';
    browseBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"></path></svg>`;

    input.addEventListener('change', () => {
        onChange(input.value || '');
    });

    browseBtn.addEventListener('click', async () => {
        const projectDir = getProjectDir();
        if (!projectDir) return;

        const assetsDir = `${projectDir}/assets`;

        try {
            const platform = getPlatformAdapter();
            const extensions = fileFilter.map(f => f.replace('.', ''));
            const result = await platform.openFileDialog({
                title: 'Select File',
                defaultPath: assetsDir,
                filters: [{ name: 'Spine Files', extensions }],
            });
            if (result) {
                const normalizedPath = result.replace(/\\/g, '/');
                const assetsIndex = normalizedPath.indexOf('/assets/');
                if (assetsIndex !== -1) {
                    const relativePath = normalizedPath.substring(assetsIndex + 1);
                    input.value = relativePath;
                    onChange(relativePath);
                }
            }
        } catch (err) {
            console.error('Failed to open file dialog:', err);
        }
    });

    wrapper.appendChild(input);
    wrapper.appendChild(browseBtn);
    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            input.value = String(v ?? '');
        },
        dispose() {
            wrapper.remove();
        },
    };
}

// =============================================================================
// Spine Animation Editor (dynamic dropdown from skeleton file)
// =============================================================================

interface SpineSkeletonData {
    animations?: Record<string, unknown>;
    skins?: Array<{ name: string }> | Record<string, unknown>;
}

async function loadSpineSkeletonData(skeletonPath: string): Promise<SpineSkeletonData | null> {
    if (!skeletonPath) return null;

    const projectDir = getProjectDir();
    const fs = getNativeFS();
    if (!projectDir || !fs) return null;

    const fullPath = `${projectDir}/${skeletonPath}`;

    try {
        const content = await fs.readFile(fullPath);
        if (!content) return null;
        return JSON.parse(content) as SpineSkeletonData;
    } catch (err) {
        console.warn('Failed to load spine skeleton:', err);
        return null;
    }
}

function getAnimationNames(data: SpineSkeletonData): string[] {
    if (!data.animations) return [];
    return Object.keys(data.animations);
}

function getSkinNames(data: SpineSkeletonData): string[] {
    if (!data.skins) return [];
    if (Array.isArray(data.skins)) {
        return data.skins.map(s => s.name);
    }
    return Object.keys(data.skins);
}

function createSpineAnimationEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange, getComponentValue } = ctx;

    const wrapper = document.createElement('div');
    wrapper.className = 'es-spine-animation-editor';

    const select = document.createElement('select');
    select.className = 'es-input es-input-select';

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'es-btn es-btn-icon es-btn-refresh';
    refreshBtn.title = 'Refresh animations';
    refreshBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>`;

    let currentAnimations: string[] = [];

    const updateOptions = (animations: string[], currentValue: string) => {
        select.innerHTML = '';

        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = '(None)';
        select.appendChild(emptyOption);

        for (const anim of animations) {
            const option = document.createElement('option');
            option.value = anim;
            option.textContent = anim;
            if (anim === currentValue) {
                option.selected = true;
            }
            select.appendChild(option);
        }

        currentAnimations = animations;
    };

    const loadAnimations = async () => {
        const skeletonPath = getComponentValue?.('skeletonPath') as string;
        if (!skeletonPath) {
            updateOptions([], String(value ?? ''));
            return;
        }

        const data = await loadSpineSkeletonData(skeletonPath);
        if (data) {
            const animations = getAnimationNames(data);
            updateOptions(animations, String(value ?? ''));
        } else {
            updateOptions([], String(value ?? ''));
        }
    };

    select.addEventListener('change', () => {
        onChange(select.value);
    });

    refreshBtn.addEventListener('click', () => {
        loadAnimations();
    });

    wrapper.appendChild(select);
    wrapper.appendChild(refreshBtn);
    container.appendChild(wrapper);

    loadAnimations();

    return {
        update(v: unknown) {
            const newValue = String(v ?? '');
            if (currentAnimations.includes(newValue) || newValue === '') {
                select.value = newValue;
            } else {
                loadAnimations();
            }
        },
        dispose() {
            wrapper.remove();
        },
    };
}

// =============================================================================
// Spine Skin Editor (dynamic dropdown from skeleton file)
// =============================================================================

function createSpineSkinEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange, getComponentValue } = ctx;

    const wrapper = document.createElement('div');
    wrapper.className = 'es-spine-skin-editor';

    const select = document.createElement('select');
    select.className = 'es-input es-input-select';

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'es-btn es-btn-icon es-btn-refresh';
    refreshBtn.title = 'Refresh skins';
    refreshBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>`;

    let currentSkins: string[] = [];

    const updateOptions = (skins: string[], currentValue: string) => {
        select.innerHTML = '';

        for (const skin of skins) {
            const option = document.createElement('option');
            option.value = skin;
            option.textContent = skin;
            if (skin === currentValue) {
                option.selected = true;
            }
            select.appendChild(option);
        }

        if (skins.length === 0) {
            const defaultOption = document.createElement('option');
            defaultOption.value = 'default';
            defaultOption.textContent = 'default';
            select.appendChild(defaultOption);
        }

        currentSkins = skins;
    };

    const loadSkins = async () => {
        const skeletonPath = getComponentValue?.('skeletonPath') as string;
        if (!skeletonPath) {
            updateOptions(['default'], String(value ?? 'default'));
            return;
        }

        const data = await loadSpineSkeletonData(skeletonPath);
        if (data) {
            const skins = getSkinNames(data);
            updateOptions(skins.length > 0 ? skins : ['default'], String(value ?? 'default'));
        } else {
            updateOptions(['default'], String(value ?? 'default'));
        }
    };

    select.addEventListener('change', () => {
        onChange(select.value);
    });

    refreshBtn.addEventListener('click', () => {
        loadSkins();
    });

    wrapper.appendChild(select);
    wrapper.appendChild(refreshBtn);
    container.appendChild(wrapper);

    loadSkins();

    return {
        update(v: unknown) {
            const newValue = String(v ?? 'default');
            if (currentSkins.includes(newValue)) {
                select.value = newValue;
            } else {
                loadSkins();
            }
        },
        dispose() {
            wrapper.remove();
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
    registerPropertyEditor('euler', createEulerEditor);
    registerPropertyEditor('texture', createTextureEditor);
    registerPropertyEditor('font', createFontEditor);
    registerPropertyEditor('spine-file', createSpineFileEditor);
    registerPropertyEditor('spine-animation', createSpineAnimationEditor);
    registerPropertyEditor('spine-skin', createSpineSkinEditor);
}

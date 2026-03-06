import {
    type PropertyEditorContext,
    type PropertyEditorInstance,
} from '../PropertyEditor';
import { setupDragLabel } from '../editorUtils';
import { validateVec2, validateVec3, showValidationError } from '../validation';

interface Vec2 {
    x: number;
    y: number;
}

export function createVec2Editor(
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

        const handleChange = () => {
            const updatedVec = { ...currentVec, [keys[i]]: parseFloat(input.value) || 0 };
            const result = validateVec2(updatedVec, ctx.meta);
            if (!result.valid) {
                showValidationError(input, result.error!);
                currentVec = result.value as Vec2;
                input.value = String(currentVec[keys[i]]);
            } else {
                currentVec = updatedVec;
            }
            onChange(currentVec);
        };

        input.addEventListener('change', handleChange);

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur();
                handleChange();
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

interface Vec3 {
    x: number;
    y: number;
    z: number;
}

export function createVec3Editor(
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

        const handleChange = () => {
            const updatedVec = { ...currentVec, [keys[i]]: parseFloat(input.value) || 0 };
            const result = validateVec3(updatedVec, ctx.meta);
            if (!result.valid) {
                showValidationError(input, result.error!);
                currentVec = result.value as Vec3;
                input.value = String(currentVec[keys[i]]);
            } else {
                currentVec = updatedVec;
            }
            onChange(currentVec);
        };

        input.addEventListener('change', handleChange);

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur();
                handleChange();
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

interface Vec4 {
    x: number;
    y: number;
    z: number;
    w: number;
}

export function createVec4Editor(
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

interface PaddingValue { left: number; top: number; right: number; bottom: number }

export function createPaddingEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const wrapper = document.createElement('div');
    wrapper.className = 'vec-editor';

    const keys: (keyof PaddingValue)[] = ['left', 'top', 'right', 'bottom'];
    const labels = ['L', 'T', 'R', 'B'];
    let currentPad: PaddingValue = { left: 0, top: 0, right: 0, bottom: 0 };
    const inputs: HTMLInputElement[] = [];

    const onChange = (value: PaddingValue) => {
        ctx.onChange(value);
    };

    keys.forEach((key, i) => {
        const group = document.createElement('div');
        group.className = 'vec-component';
        const label = document.createElement('span');
        label.className = 'vec-label';
        label.textContent = labels[i];
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'property-input vec-input';
        input.value = String(currentPad[key]);

        input.addEventListener('change', () => {
            currentPad = { ...currentPad, [key]: parseFloat(input.value) || 0 };
            onChange(currentPad);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur();
                currentPad = { ...currentPad, [key]: parseFloat(input.value) || 0 };
                onChange(currentPad);
            }
        });

        setupDragLabel(label, input, (newValue) => {
            currentPad = { ...currentPad, [key]: newValue };
            onChange(currentPad);
        });

        group.appendChild(label);
        group.appendChild(input);
        wrapper.appendChild(group);
        inputs.push(input);
    });

    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            currentPad = (v as PaddingValue) ?? { left: 0, top: 0, right: 0, bottom: 0 };
            inputs[0].value = String(currentPad.left);
            inputs[1].value = String(currentPad.top);
            inputs[2].value = String(currentPad.right);
            inputs[3].value = String(currentPad.bottom);
        },
        dispose() {
            wrapper.remove();
        },
    };
}

import {
    type PropertyEditorContext,
    type PropertyEditorInstance,
} from '../PropertyEditor';
import { setupDragLabel } from '../editorUtils';

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

export function createEulerEditor(
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

import {
    type PropertyEditorContext,
    type PropertyEditorInstance,
} from '../PropertyEditor';
import { setupDragLabel } from '../editorUtils';
import { validateNumber, showValidationError } from '../validation';

export function createNumberEditor(
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

    const handleChange = () => {
        const result = validateNumber(input.value, meta);
        if (!result.valid) {
            showValidationError(input, result.error!);
            input.value = String(result.value);
        }
        onChange(result.value);
    };

    input.addEventListener('change', handleChange);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            input.blur();
            handleChange();
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

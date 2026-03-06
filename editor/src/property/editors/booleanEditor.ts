import {
    type PropertyEditorContext,
    type PropertyEditorInstance,
} from '../PropertyEditor';

export function createBooleanEditor(
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

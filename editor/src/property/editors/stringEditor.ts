import {
    type PropertyEditorContext,
    type PropertyEditorInstance,
} from '../PropertyEditor';

export function createStringEditor(
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

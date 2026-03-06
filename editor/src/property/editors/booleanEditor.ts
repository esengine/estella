import {
    type PropertyEditorContext,
    type PropertyEditorInstance,
} from '../PropertyEditor';

export function createBooleanEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange } = ctx;

    const toggle = document.createElement('label');
    toggle.className = 'es-toggle';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'es-toggle-input';
    input.checked = Boolean(value);

    const track = document.createElement('span');
    track.className = 'es-toggle-track';

    input.addEventListener('change', () => {
        onChange(input.checked);
    });

    toggle.appendChild(input);
    toggle.appendChild(track);
    container.appendChild(toggle);

    return {
        update(v: unknown) {
            input.checked = Boolean(v);
        },
        dispose() {
            toggle.remove();
        },
    };
}

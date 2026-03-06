import {
    type PropertyEditorContext,
    type PropertyEditorInstance,
} from '../PropertyEditor';

const SEGMENTED_MAX_OPTIONS = 5;

function createSegmentedEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, meta, onChange } = ctx;
    const options = meta.options ?? [];

    const wrapper = document.createElement('div');
    wrapper.className = 'es-segmented';

    const buttons: HTMLButtonElement[] = [];

    for (const opt of options) {
        const btn = document.createElement('button');
        btn.className = 'es-segmented-btn';
        btn.textContent = opt.label;
        btn.type = 'button';
        if (opt.value === value) {
            btn.classList.add('es-active');
        }
        btn.addEventListener('click', () => {
            for (const b of buttons) b.classList.remove('es-active');
            btn.classList.add('es-active');
            onChange(opt.value);
        });
        buttons.push(btn);
        wrapper.appendChild(btn);
    }

    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            for (let i = 0; i < options.length; i++) {
                buttons[i].classList.toggle('es-active', options[i].value === v);
            }
        },
        dispose() {
            wrapper.remove();
        },
    };
}

function createDropdownEditor(
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

export function createEnumEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const options = ctx.meta.options ?? [];
    if (options.length <= SEGMENTED_MAX_OPTIONS) {
        return createSegmentedEditor(container, ctx);
    }
    return createDropdownEditor(container, ctx);
}

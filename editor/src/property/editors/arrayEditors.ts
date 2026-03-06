import {
    type PropertyEditorContext,
    type PropertyEditorInstance,
} from '../PropertyEditor';
import { setupDragLabel } from '../editorUtils';

type Vec2Item = { x: number; y: number };

export function createVec2ArrayEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, meta, onChange } = ctx;
    let items: Vec2Item[] = Array.isArray(value)
        ? (value as Vec2Item[]).map(v => ({ x: v.x, y: v.y }))
        : [];

    const wrapper = document.createElement('div');
    wrapper.className = 'es-vec2-array-editor';

    const listEl = document.createElement('div');
    listEl.className = 'es-vec2-array-list';

    const addBtn = document.createElement('button');
    addBtn.className = 'es-btn es-btn-sm es-btn-add-item';
    addBtn.textContent = '+';
    addBtn.title = 'Add vertex';

    function emitChange() {
        onChange(items.map(v => ({ x: v.x, y: v.y })));
    }

    function updateAddButton() {
        if (meta.max !== undefined && items.length >= meta.max) {
            addBtn.style.display = 'none';
        } else {
            addBtn.style.display = '';
        }
    }

    function renderItems() {
        listEl.innerHTML = '';
        items.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = 'es-vec2-array-row';

            const indexLabel = document.createElement('span');
            indexLabel.className = 'es-vec2-array-index';
            indexLabel.textContent = String(index);

            const xGroup = document.createElement('div');
            xGroup.className = 'es-vec-field es-vec-x';
            const xLabel = document.createElement('span');
            xLabel.className = 'es-vec-label';
            xLabel.textContent = 'X';
            const xInput = document.createElement('input');
            xInput.type = 'number';
            xInput.className = 'es-input es-input-number';
            xInput.step = '0.01';
            xInput.value = String(item.x);
            xInput.addEventListener('change', () => {
                items[index] = { ...items[index], x: parseFloat(xInput.value) || 0 };
                emitChange();
            });
            setupDragLabel(xLabel, xInput, (newValue) => {
                items[index] = { ...items[index], x: newValue };
                emitChange();
            });
            xGroup.appendChild(xLabel);
            xGroup.appendChild(xInput);

            const yGroup = document.createElement('div');
            yGroup.className = 'es-vec-field es-vec-y';
            const yLabel = document.createElement('span');
            yLabel.className = 'es-vec-label';
            yLabel.textContent = 'Y';
            const yInput = document.createElement('input');
            yInput.type = 'number';
            yInput.className = 'es-input es-input-number';
            yInput.step = '0.01';
            yInput.value = String(item.y);
            yInput.addEventListener('change', () => {
                items[index] = { ...items[index], y: parseFloat(yInput.value) || 0 };
                emitChange();
            });
            setupDragLabel(yLabel, yInput, (newValue) => {
                items[index] = { ...items[index], y: newValue };
                emitChange();
            });
            yGroup.appendChild(yLabel);
            yGroup.appendChild(yInput);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'es-btn es-btn-icon es-btn-clear';
            removeBtn.title = 'Remove';
            removeBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
            removeBtn.addEventListener('click', () => {
                items.splice(index, 1);
                emitChange();
                renderItems();
            });

            row.appendChild(indexLabel);
            row.appendChild(xGroup);
            row.appendChild(yGroup);
            row.appendChild(removeBtn);
            listEl.appendChild(row);
        });
        updateAddButton();
    }

    addBtn.addEventListener('click', () => {
        items.push({ x: 0, y: 0 });
        emitChange();
        renderItems();
    });

    renderItems();
    wrapper.appendChild(listEl);
    wrapper.appendChild(addBtn);
    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            items = Array.isArray(v)
                ? (v as Vec2Item[]).map(vi => ({ x: vi.x, y: vi.y }))
                : [];
            renderItems();
        },
        dispose() {
            wrapper.remove();
        },
    };
}

export function createStringArrayEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange } = ctx;
    let items = Array.isArray(value) ? [...value as string[]] : [];

    const wrapper = document.createElement('div');
    wrapper.className = 'es-string-array-editor';

    const listEl = document.createElement('div');
    listEl.className = 'es-string-array-list';

    const addBtn = document.createElement('button');
    addBtn.className = 'es-btn es-btn-sm es-btn-add-item';
    addBtn.textContent = '+';
    addBtn.title = 'Add item';

    function renderItems() {
        listEl.innerHTML = '';
        items.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = 'es-string-array-row';

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'es-input es-input-string';
            input.value = item;

            input.addEventListener('change', () => {
                items[index] = input.value;
                onChange([...items]);
            });

            const removeBtn = document.createElement('button');
            removeBtn.className = 'es-btn es-btn-icon es-btn-clear';
            removeBtn.title = 'Remove';
            removeBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

            removeBtn.addEventListener('click', () => {
                items.splice(index, 1);
                onChange([...items]);
                renderItems();
            });

            row.appendChild(input);
            row.appendChild(removeBtn);
            listEl.appendChild(row);
        });
    }

    addBtn.addEventListener('click', () => {
        items.push('');
        onChange([...items]);
        renderItems();
        const lastInput = listEl.querySelector('.es-string-array-row:last-child input') as HTMLInputElement;
        lastInput?.focus();
    });

    renderItems();
    wrapper.appendChild(listEl);
    wrapper.appendChild(addBtn);
    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            items = Array.isArray(v) ? [...v as string[]] : [];
            renderItems();
        },
        dispose() {
            wrapper.remove();
        },
    };
}

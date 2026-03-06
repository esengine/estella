import {
    type PropertyEditorContext,
    type PropertyEditorInstance,
} from '../PropertyEditor';
import { getEditorStore } from '../../store/EditorStore';
import { openEntityPicker } from '../EntityPicker';
import { getEntityIcon } from '../../panels/hierarchy/HierarchyTree';

export function createEntityEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange } = ctx;
    let currentValue = Number(value) || 0;
    let closePicker: (() => void) | null = null;

    const wrapper = document.createElement('div');
    wrapper.className = 'es-entity-field';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'es-entity-field-icon';

    const label = document.createElement('span');
    label.className = 'es-entity-field-label';
    updateLabel(currentValue);

    label.addEventListener('click', () => {
        if (currentValue === 0) return;
        getEditorStore().selectEntity(currentValue);
    });

    const pickerBtn = document.createElement('button');
    pickerBtn.className = 'es-entity-field-btn';
    pickerBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.2"/><circle cx="6" cy="6" r="1.5" fill="currentColor"/></svg>';
    pickerBtn.title = 'Pick entity';

    pickerBtn.addEventListener('click', () => {
        if (closePicker) return;
        closePicker = openEntityPicker({
            anchorEl: wrapper,
            currentValue,
            onSelect: (id: number) => {
                currentValue = id;
                updateLabel(id);
                onChange(id);
            },
            onClose: () => { closePicker = null; },
        });
    });

    const ENTITY_MIME = 'application/esengine-entity';

    wrapper.addEventListener('dragover', (e) => {
        if (e.dataTransfer?.types.includes(ENTITY_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'link';
            wrapper.classList.add('es-drag-over');
        }
    });

    wrapper.addEventListener('dragleave', () => {
        wrapper.classList.remove('es-drag-over');
    });

    wrapper.addEventListener('drop', (e) => {
        wrapper.classList.remove('es-drag-over');
        const raw = e.dataTransfer?.getData(ENTITY_MIME);
        if (!raw) return;
        e.preventDefault();
        const entityId = parseInt(raw, 10);
        if (!isNaN(entityId) && entityId > 0) {
            currentValue = entityId;
            updateLabel(entityId);
            onChange(entityId);
        }
    });

    wrapper.appendChild(iconSpan);
    wrapper.appendChild(label);
    wrapper.appendChild(pickerBtn);
    container.appendChild(wrapper);

    function updateLabel(entityId: number) {
        if (entityId === 0) {
            label.textContent = '(None)';
            label.classList.add('es-none');
            iconSpan.innerHTML = '';
            iconSpan.style.display = 'none';
        } else {
            label.classList.remove('es-none');
            const entity = getEditorStore().scene.entities.find((e: { id: number }) => e.id === entityId);
            label.textContent = entity ? entity.name : `Entity ${entityId}`;
            if (entity) {
                iconSpan.innerHTML = getEntityIcon(entity);
                iconSpan.style.display = '';
            } else {
                iconSpan.innerHTML = '';
                iconSpan.style.display = 'none';
            }
        }
    }

    return {
        update(v: unknown) {
            currentValue = Number(v) || 0;
            updateLabel(currentValue);
        },
        dispose() {
            if (closePicker) closePicker();
            wrapper.remove();
        },
    };
}

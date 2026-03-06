import {
    type PropertyEditorContext,
    type PropertyEditorInstance,
} from '../PropertyEditor';
import { getNamedLayers, layerIndexFromBits, bitsFromLayerIndex } from '../../settings/collisionLayers';
import { onSettingsChange } from '../../settings/SettingsRegistry';

export function createCollisionLayerEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange } = ctx;

    const select = document.createElement('select');
    select.className = 'es-input es-input-select';

    function populateOptions(): void {
        select.innerHTML = '';
        const layers = getNamedLayers();
        for (const layer of layers) {
            const option = document.createElement('option');
            option.value = String(layer.index);
            option.textContent = `${layer.index}: ${layer.name}`;
            select.appendChild(option);
        }
    }

    populateOptions();
    const currentIndex = layerIndexFromBits(value as number);
    select.value = String(currentIndex);

    select.addEventListener('change', () => {
        const idx = parseInt(select.value, 10);
        onChange(bitsFromLayerIndex(idx));
    });

    const unsubscribe = onSettingsChange((id) => {
        if (id.startsWith('physics.layerName')) {
            const prev = select.value;
            populateOptions();
            select.value = prev;
        }
    });

    container.appendChild(select);

    return {
        update(newValue: unknown) {
            populateOptions();
            const idx = layerIndexFromBits(newValue as number);
            select.value = String(idx);
        },
        dispose() {
            unsubscribe();
            select.remove();
        },
    };
}

import {
    type PropertyEditorContext,
    type PropertyEditorInstance,
} from '../PropertyEditor';
import { setupDragLabel } from '../editorUtils';
import { validateNumber, showValidationError } from '../validation';

function setupSlider(
    slider: HTMLElement,
    input: HTMLInputElement,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
): void {
    const updateFill = () => {
        const val = parseFloat(input.value) || 0;
        const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
        slider.style.setProperty('--slider-pct', `${pct}%`);
    };
    updateFill();

    const inputObserver = new MutationObserver(updateFill);
    inputObserver.observe(input, { attributes: true, attributeFilter: ['value'] });

    const origSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    const patched = function (this: HTMLInputElement, v: string) {
        origSet.call(this, v);
        updateFill();
    };
    Object.defineProperty(input, 'value', { set: patched, get: Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.get });

    const applyFromEvent = (e: MouseEvent) => {
        const rect = slider.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        let val = min + pct * (max - min);
        val = Math.round(val / step) * step;
        val = parseFloat(val.toFixed(4));
        input.value = String(val);
        updateFill();
        onChange(val);
    };

    slider.addEventListener('mousedown', (e) => {
        e.preventDefault();
        applyFromEvent(e);
        const onMove = (ev: MouseEvent) => applyFromEvent(ev);
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
        };
        document.body.style.cursor = 'ew-resize';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

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
    label.dataset.tooltip = 'Drag to adjust value';

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'es-input es-input-number';
    input.value = String(value ?? 0);

    if (meta.min !== undefined) input.min = String(meta.min);
    if (meta.max !== undefined) input.max = String(meta.max);
    if (meta.step !== undefined) input.step = String(meta.step);

    const step = meta.step ?? 1;
    const hasRange = meta.min !== undefined && meta.max !== undefined;

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
    }, step, meta.min, meta.max);

    wrapper.appendChild(label);
    wrapper.appendChild(input);

    if (hasRange) {
        const slider = document.createElement('div');
        slider.className = 'es-number-slider';
        setupSlider(slider, input, meta.min!, meta.max!, step, onChange);
        wrapper.appendChild(slider);
    }

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

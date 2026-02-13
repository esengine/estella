export function setupDragLabel(
    label: HTMLElement,
    input: HTMLInputElement,
    onChange: (delta: number) => void,
    step: number = 0.1
): void {
    let startX = 0;
    let startValue = 0;
    let isDragging = false;

    const onMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;
        const delta = (e.clientX - startX) * step;
        const newValue = startValue + delta;
        input.value = newValue.toFixed(2);
        onChange(newValue);
    };

    const onMouseUp = () => {
        isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
    };

    label.style.cursor = 'ew-resize';
    label.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isDragging = true;
        startX = e.clientX;
        startValue = parseFloat(input.value) || 0;
        document.body.style.cursor = 'ew-resize';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

export function colorToHex(color: { r: number; g: number; b: number; a: number }): string {
    const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
    const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
    const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
}

export function hexToColor(hex: string): { r: number; g: number; b: number; a: number } {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return { r, g, b, a: 1 };
}

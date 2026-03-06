import { AddressablePanel } from '../panels/AddressablePanel';
import { getEditorStore } from '../store';

let activeWindow: { element: HTMLElement; panel: AddressablePanel; keyHandler: (e: KeyboardEvent) => void } | null = null;

export function showAddressableWindow(): void {
    if (activeWindow) {
        activeWindow.element.style.zIndex = '1001';
        return;
    }

    const store = getEditorStore();
    const win = document.createElement('div');
    win.className = 'es-floating-window es-addressable-window';
    win.innerHTML = `
        <div class="es-floating-header">
            <span class="es-floating-title">Addressable Groups</span>
            <button class="es-dialog-close">&times;</button>
        </div>
        <div class="es-floating-body"></div>
    `;

    const body = win.querySelector('.es-floating-body') as HTMLElement;
    const panel = new AddressablePanel(body, store);

    const close = () => {
        panel.dispose();
        win.remove();
        document.removeEventListener('keydown', keyHandler);
        activeWindow = null;
    };

    win.querySelector('.es-dialog-close')!.addEventListener('click', close);

    const header = win.querySelector('.es-floating-header') as HTMLElement;
    header.addEventListener('mousedown', (e) => {
        if ((e.target as HTMLElement).closest('.es-dialog-close')) return;
        const rect = win.getBoundingClientRect();
        win.style.left = `${rect.left}px`;
        win.style.top = `${rect.top}px`;
        win.style.transform = 'none';
        const offsetX = e.clientX - rect.left;
        const offsetY = e.clientY - rect.top;
        const onMove = (ev: MouseEvent) => {
            const w = win.offsetWidth;
            const h = win.offsetHeight;
            const x = Math.max(0, Math.min(ev.clientX - offsetX, window.innerWidth - w));
            const y = Math.max(0, Math.min(ev.clientY - offsetY, window.innerHeight - h));
            win.style.left = `${x}px`;
            win.style.top = `${y}px`;
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    const keyHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', keyHandler);

    document.body.appendChild(win);
    activeWindow = { element: win, panel, keyHandler };
}

export function closeAddressableWindow(): void {
    if (!activeWindow) return;
    activeWindow.panel.dispose();
    activeWindow.element.remove();
    document.removeEventListener('keydown', activeWindow.keyHandler);
    activeWindow = null;
}

export function hasAddressableWindow(): boolean {
    return activeWindow !== null;
}

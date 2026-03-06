import { getEditorContext } from '../context/EditorContext';
import { icons } from '../utils/icons';

export function showAboutDialog(): void {
    const hasUpdater = !!getEditorContext().onCheckUpdate;
    const overlay = document.createElement('div');
    overlay.className = 'es-dialog-overlay';
    overlay.innerHTML = `
        <div class="es-dialog" style="max-width: 360px;">
            <div class="es-dialog-header">
                <span class="es-dialog-title">About ESEngine</span>
                <button class="es-dialog-close">&times;</button>
            </div>
            <div class="es-dialog-body" style="text-align: center; padding: 24px;">
                <div style="margin-bottom: 16px;">${icons.logo(64)}</div>
                <h3 style="margin: 0 0 8px; color: var(--es-text-primary);">ESEngine Editor</h3>
                <p style="margin: 0 0 16px; color: var(--es-text-secondary);">Version ${getEditorContext().version ?? '0.0.0'}</p>
                <p style="margin: 0; font-size: 12px; color: var(--es-text-secondary);">
                    A lightweight 2D game engine<br>for web and mini-programs.
                </p>
            </div>
            <div class="es-dialog-footer" style="justify-content: center; gap: 8px;">
                ${hasUpdater ? '<button class="es-dialog-btn" id="about-check-update">Check for Updates</button>' : ''}
                <button class="es-dialog-btn es-dialog-btn-primary">OK</button>
            </div>
        </div>
    `;

    const close = () => overlay.remove();
    overlay.querySelector('.es-dialog-close')?.addEventListener('click', close);
    overlay.querySelector('.es-dialog-btn-primary')?.addEventListener('click', close);
    overlay.querySelector('#about-check-update')?.addEventListener('click', () => {
        close();
        getEditorContext().onCheckUpdate?.();
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });

    document.body.appendChild(overlay);
}

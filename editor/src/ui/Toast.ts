/**
 * @file    Toast.ts
 * @brief   Toast notification component for build progress and status
 */

import { icons } from '../utils/icons';

// =============================================================================
// Types
// =============================================================================

export type ToastType = 'info' | 'success' | 'error' | 'progress';

export interface ToastOptions {
    type: ToastType;
    title: string;
    message?: string;
    duration?: number; // ms, 0 = manual close
    progress?: number; // 0-100, only for progress type
    actions?: ToastAction[];
}

export interface ToastAction {
    label: string;
    primary?: boolean;
    onClick: () => void;
}

// =============================================================================
// Toast Manager (Singleton)
// =============================================================================

class ToastManager {
    private container_: HTMLElement | null = null;
    private toasts_: Map<string, HTMLElement> = new Map();
    private counter_ = 0;

    private getContainer(): HTMLElement {
        if (!this.container_) {
            this.container_ = document.createElement('div');
            this.container_.className = 'es-toast-container';
            document.body.appendChild(this.container_);
        }
        return this.container_;
    }

    show(options: ToastOptions): string {
        const id = `toast-${++this.counter_}`;
        const container = this.getContainer();

        const toast = document.createElement('div');
        toast.className = `es-toast es-toast-${options.type}`;
        toast.dataset.toastId = id;

        const iconHtml = this.getIcon(options.type);
        const progressHtml = options.type === 'progress'
            ? `<div class="es-toast-progress-bar"><div class="es-toast-progress-fill" style="width: ${options.progress ?? 0}%"></div></div>`
            : '';

        const actionsHtml = options.actions?.length
            ? `<div class="es-toast-actions">${options.actions.map((a, i) =>
                `<button class="es-toast-btn ${a.primary ? 'es-toast-btn-primary' : ''}" data-action-index="${i}">${a.label}</button>`
            ).join('')}</div>`
            : '';

        toast.innerHTML = `
            <div class="es-toast-icon">${iconHtml}</div>
            <div class="es-toast-content">
                <div class="es-toast-title"></div>
                ${options.message ? `<div class="es-toast-message"></div>` : ''}
                ${progressHtml}
                ${actionsHtml}
            </div>
            <button class="es-toast-close">${icons.x(12)}</button>
        `;
        toast.querySelector('.es-toast-title')!.textContent = options.title;
        if (options.message) {
            toast.querySelector('.es-toast-message')!.textContent = options.message;
        }

        // Event listeners
        toast.querySelector('.es-toast-close')?.addEventListener('click', () => {
            this.dismiss(id);
        });

        if (options.actions) {
            options.actions.forEach((action, index) => {
                toast.querySelector(`[data-action-index="${index}"]`)?.addEventListener('click', () => {
                    action.onClick();
                    this.dismiss(id);
                });
            });
        }

        container.appendChild(toast);
        this.toasts_.set(id, toast);

        // Animate in
        requestAnimationFrame(() => {
            toast.classList.add('es-toast-show');
        });

        // Auto dismiss
        if (options.duration && options.duration > 0) {
            setTimeout(() => this.dismiss(id), options.duration);
        }

        return id;
    }

    update(id: string, updates: Partial<ToastOptions>): void {
        const toast = this.toasts_.get(id);
        if (!toast) return;

        if (updates.title !== undefined) {
            const titleEl = toast.querySelector('.es-toast-title');
            if (titleEl) titleEl.textContent = updates.title;
        }

        if (updates.message !== undefined) {
            let messageEl = toast.querySelector('.es-toast-message');
            if (updates.message) {
                if (!messageEl) {
                    messageEl = document.createElement('div');
                    messageEl.className = 'es-toast-message';
                    toast.querySelector('.es-toast-content')?.appendChild(messageEl);
                }
                messageEl.textContent = updates.message;
            } else if (messageEl) {
                messageEl.remove();
            }
        }

        if (updates.progress !== undefined) {
            const fillEl = toast.querySelector('.es-toast-progress-fill') as HTMLElement;
            if (fillEl) {
                fillEl.style.width = `${updates.progress}%`;
            }
        }

        if (updates.type !== undefined) {
            toast.className = `es-toast es-toast-${updates.type} es-toast-show`;
            const iconEl = toast.querySelector('.es-toast-icon');
            if (iconEl) iconEl.innerHTML = this.getIcon(updates.type);
        }
    }

    dismiss(id: string): void {
        const toast = this.toasts_.get(id);
        if (!toast) return;

        toast.classList.remove('es-toast-show');
        toast.classList.add('es-toast-hide');

        setTimeout(() => {
            toast.remove();
            this.toasts_.delete(id);
        }, 200);
    }

    dismissAll(): void {
        for (const id of this.toasts_.keys()) {
            this.dismiss(id);
        }
    }

    private getIcon(type: ToastType): string {
        switch (type) {
            case 'success':
                return icons.check(18);
            case 'error':
                return icons.x(18);
            case 'progress':
                return `<div class="es-toast-spinner"></div>`;
            default:
                return icons.cog(18);
        }
    }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const toast = new ToastManager();

// =============================================================================
// Convenience Functions
// =============================================================================

export function showToast(options: ToastOptions): string {
    return toast.show(options);
}

export function showSuccessToast(title: string, message?: string, duration = 3000): string {
    return toast.show({ type: 'success', title, message, duration });
}

export function showErrorToast(title: string, message?: string, duration = 5000): string {
    return toast.show({ type: 'error', title, message, duration });
}

export function showProgressToast(title: string, message?: string): string {
    return toast.show({ type: 'progress', title, message, progress: 0, duration: 0 });
}

export function updateToast(id: string, updates: Partial<ToastOptions>): void {
    toast.update(id, updates);
}

export function dismissToast(id: string): void {
    toast.dismiss(id);
}

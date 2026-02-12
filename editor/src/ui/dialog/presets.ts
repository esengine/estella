/**
 * @file    presets.ts
 * @brief   Preset dialog functions
 */

import { Dialog } from './Dialog';
import type {
    DialogOptions,
    DialogResult,
    InputDialogOptions,
    ConfirmDialogOptions,
    AlertDialogOptions,
} from './types';

export function showDialog(options: DialogOptions): Promise<DialogResult> {
    const dialog = new Dialog(options);
    return dialog.open();
}

export function showInputDialog(options: InputDialogOptions): Promise<string | null> {
    return new Promise((resolve) => {
        let resolved = false;

        const content = document.createElement('div');

        const field = document.createElement('div');
        field.className = 'es-dialog-field';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'es-dialog-input';
        input.placeholder = options.placeholder ?? '';
        input.value = options.defaultValue ?? '';

        field.appendChild(input);
        content.appendChild(field);

        const errorEl = document.createElement('div');
        errorEl.className = 'es-dialog-error';
        errorEl.style.display = 'none';
        content.appendChild(errorEl);

        let dialog: Dialog;
        let inputValue: string | null = null;

        const validate = async (): Promise<boolean> => {
            if (options.validator) {
                const error = await options.validator(input.value.trim());
                if (error) {
                    errorEl.textContent = error;
                    errorEl.style.display = 'block';
                    return false;
                }
            }
            errorEl.style.display = 'none';
            return true;
        };

        const submit = async (): Promise<boolean> => {
            if (!await validate()) return false;
            inputValue = input.value.trim() || null;
            dialog.close({ action: 'confirm', data: inputValue });
            return true;
        };

        dialog = new Dialog({
            title: options.title,
            content,
            buttons: [
                { label: options.cancelText ?? 'Cancel', role: 'cancel' },
                { label: options.confirmText ?? 'Confirm', role: 'confirm', primary: true, onClick: () => submit() },
            ],
            closeOnOverlay: true,
            closeOnEscape: true,
        });

        dialog.getElement().addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submit();
            }
        });

        dialog.open().then((result) => {
            if (resolved) return;
            resolved = true;
            if (result.action === 'confirm') {
                resolve(inputValue);
            } else {
                resolve(null);
            }
        });

        requestAnimationFrame(() => {
            input.focus();
            input.select();
        });
    });
}

export function showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
    return new Promise((resolve) => {
        const dialog = new Dialog({
            title: options.title,
            content: options.message,
            className: options.danger ? 'es-dialog-danger' : undefined,
            buttons: [
                { label: options.cancelText ?? 'Cancel', role: 'cancel' },
                { label: options.confirmText ?? 'Confirm', role: 'confirm', primary: true },
            ],
        });

        dialog.open().then((result) => {
            resolve(result.action === 'confirm');
        });
    });
}

export function showAlertDialog(options: AlertDialogOptions): Promise<void> {
    return new Promise((resolve) => {
        const typeClass = options.type ? `es-dialog-${options.type}` : undefined;

        const dialog = new Dialog({
            title: options.title,
            content: options.message,
            className: typeClass,
            buttons: [
                { label: options.buttonText ?? 'OK', role: 'confirm', primary: true },
            ],
        });

        dialog.open().then(() => {
            resolve();
        });
    });
}

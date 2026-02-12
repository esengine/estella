/**
 * @file    types.ts
 * @brief   Dialog system type definitions
 */

export type DialogRole = 'confirm' | 'cancel' | 'custom';

export interface DialogButton {
    label: string;
    role?: DialogRole;
    primary?: boolean;
    disabled?: boolean;
    onClick?: () => void | boolean | Promise<void | boolean>;
}

export interface DialogOptions {
    title: string;
    content?: string | HTMLElement;
    width?: number | string;
    buttons?: DialogButton[];
    closeOnOverlay?: boolean;
    closeOnEscape?: boolean;
    showCloseButton?: boolean;
    className?: string;
}

export interface DialogResult<T = any> {
    action: DialogRole | string;
    data?: T;
}

export interface InputDialogOptions {
    title: string;
    placeholder?: string;
    defaultValue?: string;
    confirmText?: string;
    cancelText?: string;
    validator?: (value: string) => string | null | Promise<string | null>;
}

export interface ConfirmDialogOptions {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
}

export interface AlertDialogOptions {
    title: string;
    message: string;
    buttonText?: string;
    type?: 'info' | 'warning' | 'error' | 'success';
}

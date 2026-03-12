import { getComponentAssetFieldDescriptors } from 'esengine';

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

export function isAssetField(propertyPath: string): boolean {
    const dotIndex = propertyPath.indexOf('.');
    if (dotIndex === -1) return false;
    const componentName = propertyPath.substring(0, dotIndex);
    const fieldName = propertyPath.substring(dotIndex + 1).split('.')[0];
    const descriptors = getComponentAssetFieldDescriptors(componentName);
    return descriptors.some(d => d.field === fieldName && d.type === 'texture');
}

export function getAssetDisplayPath(value: unknown): string {
    if (typeof value !== 'string') return '';
    if (value.startsWith('asset:')) return value.slice(6);
    return value;
}

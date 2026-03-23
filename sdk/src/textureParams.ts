import { Renderer } from './renderer';

export const TextureFilter = {
    Nearest: 0,
    Linear: 1,
} as const;

export type TextureFilter = (typeof TextureFilter)[keyof typeof TextureFilter];

export const TextureWrap = {
    Repeat: 0,
    ClampToEdge: 1,
    MirroredRepeat: 2,
} as const;

export type TextureWrap = (typeof TextureWrap)[keyof typeof TextureWrap];

export function setTextureFilter(textureId: number, filter: TextureFilter): void {
    Renderer.setTextureParams(textureId, filter, filter, TextureWrap.ClampToEdge, TextureWrap.ClampToEdge);
}

export function setTextureWrap(textureId: number, wrap: TextureWrap): void {
    Renderer.setTextureParams(textureId, TextureFilter.Linear, TextureFilter.Linear, wrap, wrap);
}

export function setTextureParams(
    textureId: number,
    minFilter: TextureFilter,
    magFilter: TextureFilter,
    wrapS: TextureWrap,
    wrapT: TextureWrap,
): void {
    Renderer.setTextureParams(textureId, minFilter, magFilter, wrapS, wrapT);
}

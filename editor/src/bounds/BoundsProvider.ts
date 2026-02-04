/**
 * @file    BoundsProvider.ts
 * @brief   Interface for component bounds providers
 */

export interface Bounds {
    width: number;
    height: number;
}

export interface BoundsProvider {
    getBounds(data: any): Bounds | null;
}

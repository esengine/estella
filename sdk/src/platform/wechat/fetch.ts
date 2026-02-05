/**
 * @file    fetch.ts
 * @brief   Fetch polyfill for WeChat MiniGame using wx.request
 */

/// <reference types="minigame-api-typings" />

import type { PlatformRequestOptions, PlatformResponse } from '../types';

// =============================================================================
// WeChat Fetch Implementation
// =============================================================================

export function wxFetch(url: string, options?: PlatformRequestOptions): Promise<PlatformResponse> {
    return new Promise((resolve, reject) => {
        const responseType = options?.responseType ?? 'text';

        wx.request({
            url,
            method: (options?.method ?? 'GET') as WechatMinigame.RequestOption['method'],
            data: options?.body,
            header: options?.headers,
            responseType: responseType === 'arraybuffer' ? 'arraybuffer' : 'text',
            timeout: options?.timeout,
            success: (res) => {
                const ok = res.statusCode >= 200 && res.statusCode < 300;
                const headers: Record<string, string> = {};

                if (res.header) {
                    for (const key of Object.keys(res.header)) {
                        headers[key.toLowerCase()] = res.header[key];
                    }
                }

                resolve({
                    ok,
                    status: res.statusCode,
                    statusText: ok ? 'OK' : 'Error',
                    headers,
                    json: <T>() => {
                        if (typeof res.data === 'string') {
                            return Promise.resolve(JSON.parse(res.data) as T);
                        }
                        return Promise.resolve(res.data as T);
                    },
                    text: () => {
                        if (typeof res.data === 'string') {
                            return Promise.resolve(res.data);
                        }
                        return Promise.resolve(JSON.stringify(res.data));
                    },
                    arrayBuffer: () => {
                        if (res.data instanceof ArrayBuffer) {
                            return Promise.resolve(res.data);
                        }
                        // Convert string to ArrayBuffer
                        const encoder = new TextEncoder();
                        const data = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
                        return Promise.resolve(encoder.encode(data).buffer);
                    },
                });
            },
            fail: (err) => {
                reject(new Error(`wx.request failed: ${err.errMsg}`));
            },
        });
    });
}

// =============================================================================
// Global Fetch Polyfill
// =============================================================================

export function polyfillFetch(): void {
    if (typeof globalThis.fetch === 'undefined') {
        (globalThis as any).fetch = async (
            input: string | URL,
            init?: RequestInit
        ): Promise<Response> => {
            const url = typeof input === 'string' ? input : input.toString();
            const options: PlatformRequestOptions = {
                method: (init?.method as PlatformRequestOptions['method']) ?? 'GET',
                headers: init?.headers as Record<string, string>,
                body: init?.body as string | ArrayBuffer,
            };

            const response = await wxFetch(url, options);

            // Return a Response-like object
            return {
                ok: response.ok,
                status: response.status,
                statusText: response.statusText,
                headers: new Headers(response.headers),
                json: () => response.json(),
                text: () => response.text(),
                arrayBuffer: () => response.arrayBuffer(),
                blob: () => Promise.reject(new Error('Blob not supported in WeChat')),
                formData: () => Promise.reject(new Error('FormData not supported in WeChat')),
                clone: () => { throw new Error('clone not supported'); },
                body: null,
                bodyUsed: false,
                redirected: false,
                type: 'basic',
                url,
            } as unknown as Response;
        };
    }
}

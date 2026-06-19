/// <reference types="vite/client" />

import type { EstellaBridge } from '../electron/preload';

declare global {
  interface Window {
    estella: EstellaBridge;
  }
}

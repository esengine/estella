// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { readFileSync } from 'node:fs';

/** Read the contract and system symbols from the linked bytes using the heap the package selects. */
export function compiledSystemModule(file: string, shared: boolean) {
  const module = new WebAssembly.Module(Uint8Array.from(readFileSync(file)));
  const memory = new WebAssembly.Memory({ initial: 256, maximum: 32768, shared });
  const bytes = new Uint8Array(memory.buffer);
  bytes.fill(41);
  const { exports } = new WebAssembly.Instance(module, { env: { memory } });
  (exports._initialize as () => void)();
  const word = (key: string) => ((exports[key] as () => number)() >>> 0).toString(16).padStart(8, '0');
  return {
    imports: WebAssembly.Module.imports(module),
    contract: word('es_module_contract_hi') + word('es_module_contract_lo'),
    symbols: Object.keys(exports).filter(key => key.startsWith('es_sys_')).sort(),
    memoryUnchanged: bytes.every(byte => byte === 41),
  };
}

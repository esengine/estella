# PhysX in Estella

Source: NVIDIA-Omniverse/PhysX, tag `110.3-omni-and-physx-5.9.1`
(physx/version.txt: 5.9.1.25cbd936). License: physx/LICENSE.md (Apache-2.0).

Vendored: `include/` and `source/` of the `physx/` directory, without the GPU,
CUDA-manager and physxgpu sources (the headers under `include/cudamanager` and
`include/gpu` stay, because public headers include them). Built as one static
library by `third_party/CMakeLists.txt` (`ES_ENABLE_PHYSX`), with PVD off.

## Local patches

Upstream compiles for emscripten in name only: a wasm build still takes the
Linux x86 paths. Android (bionic) takes the Linux paths too, and lacks a few of
the pthread calls they make. Each change is marked `ESTELLA` in the source.

| File | Change |
|---|---|
| `include/foundation/PxMath.h` | no glibc `.symver` asm under emscripten |
| `include/foundation/PxThread.h` | `PxSpinLockPause()` is empty under emscripten (no `nop`) |
| `include/foundation/PxHash.h` | the `size_t` hash overload also under emscripten (`size_t` is its own type on wasm32) |
| `source/foundation/unix/FdUnixAtomic.cpp` | `PAUSE()` empty under emscripten |
| `source/foundation/unix/FdUnixThread.cpp` | spin pause and `yieldProcessor` empty under emscripten; on Android no `<bits/local_lim.h>` and no `pthread_cancel` (PhysX runs with no worker threads) |
| `source/foundation/unix/FdUnixMutex.cpp` | no mutex priority protocol under emscripten or on Android (bionic has no `PTHREAD_PRIO_PROTECT` or `pthread_mutexattr_setprioceiling`) |
| `source/foundation/FdTempAllocator.cpp` | the size cast before `PxHighestSetBit` (ambiguous on wasm32) |

To update: replace `include/` and `source/` from the new tag, drop the same GPU
directories, reapply the table, and run `node tools/check-physics3d-physx.mjs`. The native
hosts build the same tree (cmake/PhysX.cmake): rebuild one with `cli native`.

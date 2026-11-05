// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    physx_plugin.cpp
 * @brief   libestella_physx.so's one entry point: register the es_physx3d_* surface.
 * @details On Android PhysX is a library of its own, packed only into a package
 *          whose project picked it (pipeline/src/export/exportGame.ts). The host
 *          dlopens it by name at boot and, when it is there, calls this with the JS
 *          global object (native/host/Runtime.cpp, loadPhysXLibrary). The wrappers
 *          it registers are generated from the same declarations as Jolt's, and
 *          reach the engine surface and the heap through the host library this one
 *          links against.
 */
#include "esn_shim.hpp"

void esn_register_functions_physx3d(esjs::Val global);

extern "C" __attribute__((visibility("default"))) void estella_physx_register(esjs::Val* global) {
    esn_register_functions_physx3d(*global);
}

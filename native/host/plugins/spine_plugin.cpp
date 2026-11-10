// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine_plugin.cpp
 * @brief   libestella_spine<tag>.so's one entry point: register one Spine release.
 * @details On Android each vendored Spine release is a library of its own, and a
 *          package carries only the releases its skeletons were exported from
 *          (pipeline/src/export/exportGame.ts). The host dlopens every one the
 *          package has and calls this with the JS global object
 *          (native/host/Runtime.cpp, loadSpineLibraries). The wrappers it registers
 *          (es_spine<tag>_*) are generated from the same declarations as the web's
 *          spine_* exports, and reach the heap through the host library this one
 *          links against. Built once per release, with ES_SPINE_TAG naming it.
 */
#include "esn_shim.hpp"

#define ES_SPINE_CAT_(a, b) a##b
#define ES_SPINE_CAT(a, b) ES_SPINE_CAT_(a, b)
#define ES_SPINE_REGISTER ES_SPINE_CAT(esn_register_functions_spine, ES_SPINE_TAG)

void ES_SPINE_REGISTER(esjs::Val global);

extern "C" __attribute__((visibility("default"))) void estella_spine_register(esjs::Val* global) {
    ES_SPINE_REGISTER(*global);
}

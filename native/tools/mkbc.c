// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    mkbc.c
 * @brief   Compiles a script to QuickJS bytecode, in the cache format the host reads.
 *
 * @details QuickJS is an interpreter, so the host pays to parse the SDK bundle
 *          the first time it ever runs — measured at ~14 s on a device, which is
 *          the whole of the black screen a user sees after installing. The host
 *          already caches the compile (see Runtime.cpp), but the cache does not
 *          exist until that first launch has paid for it. Producing it at build
 *          time instead means the first launch is as fast as every later one.
 *
 *          This is a host tool: it runs on the machine doing the build, not on
 *          the device. The bytecode is portable between them because both use the
 *          same QuickJS — the build links the very sources the host does — and
 *          the format depends on that, not on the CPU. Verified by building the
 *          bytecode on one machine and loading it on a device of another
 *          architecture.
 *
 *          Output is exactly what the host's cache file holds:
 *          [8-byte FNV-1a of the source][bytecode]. The hash is what lets the
 *          host reject bytecode that does not match the bundle it was built
 *          with, so this must hash the same bytes the host embeds — the caller
 *          is responsible for handing over that exact form.
 */
#include "quickjs.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

/** Must match hashBytes() in native/host/Runtime.cpp. */
static uint64_t fnv1a(const char* p, size_t n) {
    uint64_t h = 1469598103934665603ull;
    for (size_t i = 0; i < n; i++) {
        h ^= (unsigned char)p[i];
        h *= 1099511628211ull;
    }
    return h;
}

int main(int argc, char** argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: mkbc <input.js> <output.bc>\n");
        return 2;
    }

    FILE* in = fopen(argv[1], "rb");
    if (!in) { fprintf(stderr, "mkbc: cannot open %s\n", argv[1]); return 1; }
    fseek(in, 0, SEEK_END);
    long size = ftell(in);
    fseek(in, 0, SEEK_SET);
    if (size <= 0) { fprintf(stderr, "mkbc: %s is empty\n", argv[1]); fclose(in); return 1; }
    char* source = (char*)malloc((size_t)size + 1);
    if (!source || fread(source, 1, (size_t)size, in) != (size_t)size) {
        fprintf(stderr, "mkbc: cannot read %s\n", argv[1]);
        fclose(in);
        return 1;
    }
    source[size] = '\0';
    fclose(in);

    JSRuntime* runtime = JS_NewRuntime();
    JSContext* ctx = JS_NewContext(runtime);
    // The filename is part of what the bytecode carries, so it has to match what
    // the host would have compiled under or stack traces name a different file.
    JSValue fn = JS_Eval(ctx, source, (size_t)size, "esengine.native.js",
                         JS_EVAL_TYPE_GLOBAL | JS_EVAL_FLAG_COMPILE_ONLY);
    if (JS_IsException(fn)) {
        JSValue err = JS_GetException(ctx);
        const char* msg = JS_ToCString(ctx, err);
        fprintf(stderr, "mkbc: compile failed: %s\n", msg ? msg : "(no message)");
        return 1;
    }

    size_t bcLen = 0;
    uint8_t* bc = JS_WriteObject(ctx, &bcLen, fn, JS_WRITE_OBJ_BYTECODE);
    if (!bc || bcLen == 0) { fprintf(stderr, "mkbc: JS_WriteObject failed\n"); return 1; }

    FILE* out = fopen(argv[2], "wb");
    if (!out) { fprintf(stderr, "mkbc: cannot write %s\n", argv[2]); return 1; }
    const uint64_t hash = fnv1a(source, (size_t)size);
    fwrite(&hash, sizeof(hash), 1, out);
    fwrite(bc, 1, bcLen, out);
    fclose(out);

    printf("mkbc: %ld source bytes -> %zu bytecode bytes\n", size, bcLen);
    return 0;
}

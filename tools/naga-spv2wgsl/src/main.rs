// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//! SPIR-V → WGSL for the shader-twin cook tooling (tools/gen-shader-twins.mjs).
//!
//! A deliberately tiny wrapper over naga's spv-in / wgsl-out so the whole
//! program is stdin → stdout: no filesystem, no arguments — the shape that
//! makes the wasm32-wasip1 build trivially runnable under node:wasi on any
//! machine, with no cargo/naga-cli install.
//!
//! Build (artifact is committed, see build-tools/shader-twins/README.md):
//!   rustup target add wasm32-wasip1
//!   cargo build --release --target wasm32-wasip1

use std::io::{Read, Write};

fn fail(what: &str, detail: String) -> ! {
    eprintln!("{what}: {detail}");
    std::process::exit(1);
}

fn main() {
    let mut spv = Vec::new();
    if let Err(e) = std::io::stdin().read_to_end(&mut spv) {
        fail("read stdin", e.to_string());
    }

    // The input is SPIR-V that glslang produced from GLSL ES 300 WITHOUT --invert-y,
    // so gl_Position still carries the GL clip space — which is WebGPU's. naga-cli's
    // default assumes Vulkan-authored SPIR-V and emits `pos.y = -pos.y`; applied here
    // that flip is spurious and every twin came out upside down on a WGSL backend.
    let options = naga::front::spv::Options {
        adjust_coordinate_space: false,
        strict_capabilities: false,
        ..Default::default()
    };
    let module = match naga::front::spv::parse_u8_slice(&spv, &options) {
        Ok(m) => m,
        Err(e) => fail("spv parse", e.to_string()),
    };

    let mut validator = naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::all(),
    );
    let info = match validator.validate(&module) {
        Ok(i) => i,
        Err(e) => fail("validate", format!("{e:?}")),
    };

    let wgsl = match naga::back::wgsl::write_string(
        &module,
        &info,
        naga::back::wgsl::WriterFlags::empty(),
    ) {
        Ok(s) => s,
        Err(e) => fail("wgsl write", e.to_string()),
    };

    if let Err(e) = std::io::stdout().write_all(wgsl.as_bytes()) {
        fail("write stdout", e.to_string());
    }
}

//! WASM compilation commands.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

use crate::engine_sync::{hash_dir_meta, resolve_engine_src, sync_engine_src_if_needed};
use crate::toolchain::{
    emit_progress, find_bundled_cmake, find_emsdk_python, generate_emscripten_config,
    load_config, validate_emsdk, which_sync, CompileOptions, CompileResult, SpineModuleResult,
};

// =============================================================================
// Tauri commands
// =============================================================================

#[tauri::command]
pub async fn compile_wasm(
    app: AppHandle,
    options: CompileOptions,
) -> Result<CompileResult, String> {
    let config = load_config(&app);
    let emsdk_path = config
        .emsdk_path
        .ok_or("emsdk not configured. Set the path or install it first.")?;
    let emsdk_dir = PathBuf::from(&emsdk_path);

    if !validate_emsdk(&emsdk_dir) {
        return Err(format!("Invalid emsdk at: {}", emsdk_path));
    }

    if !emsdk_dir.join(".emscripten").exists() {
        generate_emscripten_config(&emsdk_dir)?;
    }

    let engine_src = resolve_engine_src(&app)?;

    if sync_engine_src_if_needed(&engine_src).unwrap_or(false) {
        emit_progress(&app, "configure", "Synced engine sources from project root", 0.02);
    }

    let cache_key = compute_cache_key(&options, &engine_src);

    let build_base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("build-cache");
    let build_dir = build_base.join(&cache_key);

    if options.clean_build && build_dir.exists() {
        emit_progress(&app, "configure", "Cleaning build cache...", 0.05);
        std::fs::remove_dir_all(&build_dir).map_err(|e| e.to_string())?;
    }

    std::fs::create_dir_all(&build_dir).map_err(|e| e.to_string())?;

    let source_hash = compute_source_hash(&engine_src);
    if !options.clean_build {
        let wasm_output = if options.target == "playable" {
            build_dir.join("sdk/esengine.single.js")
        } else {
            build_dir.join("sdk/esengine-core.wasm")
        };

        if wasm_output.exists() {
            let hash_file = build_dir.join(".source_hash");
            let cached_hash = std::fs::read_to_string(&hash_file).unwrap_or_default();

            if source_hash == cached_hash {
                emit_progress(&app, "complete", "Using cached build", 1.0);
                return Ok(make_result(true, &build_dir, &cache_key, &options));
            }
            emit_progress(&app, "configure", "Source changed, rebuilding...", 0.05);
        }
    }

    let env_vars = build_env_vars(&emsdk_dir, &app);

    let cmake_bin = find_bundled_cmake(&app)
        .or_else(|| which_sync(if cfg!(windows) { "cmake.exe" } else { "cmake" }))
        .ok_or("cmake not found. Run toolchain packaging first.")?;
    let cmake_str = cmake_bin.to_string_lossy().to_string();

    emit_progress(&app, "configure", "Configuring CMake...", 0.1);

    let emcmake_name = if cfg!(windows) { "emcmake.bat" } else { "emcmake" };
    let emcmake = emsdk_dir.join("upstream/emscripten").join(emcmake_name);

    if !emcmake.exists() {
        return Err(format!(
            "emcmake not found at: {}. Is emsdk installed correctly?",
            emcmake.display()
        ));
    }

    let mut cmake_args = vec![cmake_str.clone()];
    cmake_args.extend(["-G".to_string(), "Ninja".to_string()]);
    cmake_args.extend(build_cmake_flags(&options));
    cmake_args.push(engine_src.to_string_lossy().to_string());

    run_command_streamed(
        &app,
        emcmake.to_string_lossy().as_ref(),
        &cmake_args,
        &build_dir,
        &env_vars,
    )
    .await?;

    emit_progress(&app, "compile", "Compiling C++ to WASM...", 0.3);

    let build_target = match options.target.as_str() {
        "wechat" => "esengine_wxgame",
        "playable" => "esengine_single",
        _ => "esengine_sdk",
    };

    run_command_streamed(
        &app,
        &cmake_str,
        &[
            "--build".to_string(),
            ".".to_string(),
            "-j".to_string(),
            num_cpus().to_string(),
            "--target".to_string(),
            build_target.to_string(),
        ],
        &build_dir,
        &env_vars,
    )
    .await?;

    if options.features.spine && !options.spine_versions.is_empty() {
        emit_progress(&app, "compile", "Compiling Spine modules...", 0.5);
        for version in &options.spine_versions {
            let cmake_target = match version.as_str() {
                "3.8" => "spine_module_38",
                "4.1" => "spine_module_41",
                "4.2" => "spine_module",
                _ => continue,
            };
            run_command_streamed(
                &app,
                &cmake_str,
                &[
                    "--build".to_string(),
                    ".".to_string(),
                    "-j".to_string(),
                    num_cpus().to_string(),
                    "--target".to_string(),
                    cmake_target.to_string(),
                ],
                &build_dir,
                &env_vars,
            )
            .await?;
        }
    }

    if options.enable_physics {
        let box2d_dir = engine_src.join("third_party/box2d");
        if box2d_dir.exists() {
            emit_progress(&app, "compile", "Compiling Physics module...", 0.65);
            run_command_streamed(
                &app,
                &cmake_str,
                &[
                    "--build".to_string(),
                    ".".to_string(),
                    "-j".to_string(),
                    num_cpus().to_string(),
                    "--target".to_string(),
                    "physics_module".to_string(),
                ],
                &build_dir,
                &env_vars,
            )
            .await?;
        } else {
            emit_progress(&app, "compile", "Physics module skipped (box2d not bundled)", 0.65);
        }
    }

    if !options.debug {
        emit_progress(&app, "optimize", "Optimizing WASM...", 0.8);

        let wasm_opt = if cfg!(windows) {
            emsdk_dir.join("upstream/bin/wasm-opt.exe")
        } else {
            emsdk_dir.join("upstream/bin/wasm-opt")
        };
        let wasm_file = build_dir.join("sdk/esengine-core.wasm");

        if wasm_opt.exists() && wasm_file.exists() {
            let wasm_path = wasm_file.to_string_lossy().to_string();
            if let Err(e) = run_command_streamed(
                &app,
                wasm_opt.to_string_lossy().as_ref(),
                &[
                    options.optimization.clone(),
                    "--enable-bulk-memory".to_string(),
                    "--enable-nontrapping-float-to-int".to_string(),
                    "-o".to_string(),
                    wasm_path.clone(),
                    wasm_path,
                ],
                &build_dir,
                &env_vars,
            )
            .await
            {
                emit_progress(&app, "warning", &format!("wasm-opt failed (non-fatal): {}", e), 0.85);
            }
        }
    }

    let hash_file = build_dir.join(".source_hash");
    if let Err(e) = std::fs::write(&hash_file, &source_hash) {
        eprintln!("[compiler] Failed to write source hash: {}", e);
    }

    emit_progress(&app, "complete", "Build complete!", 1.0);

    Ok(make_result(true, &build_dir, &cache_key, &options))
}

#[tauri::command]
pub fn clear_build_cache(app: AppHandle) -> Result<(), String> {
    let cache_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("build-cache");
    if cache_dir.exists() {
        std::fs::remove_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// =============================================================================
// Helpers
// =============================================================================

fn make_result(success: bool, build_dir: &Path, cache_key: &str, options: &CompileOptions) -> CompileResult {
    let (js_name, wasm_name) = if options.target == "playable" {
        ("sdk/esengine.single.js", None)
    } else {
        ("sdk/esengine-core.js", Some("sdk/esengine-core.wasm"))
    };

    let js_path = build_dir.join(js_name);
    let wasm_path = wasm_name.map(|n| build_dir.join(n));

    let size_path = wasm_path.as_ref().unwrap_or(&js_path);
    let wasm_size = std::fs::metadata(size_path).map(|m| m.len()).ok();

    let mut spine_modules = Vec::new();
    if options.features.spine {
        for version in &options.spine_versions {
            let tag = version.replace('.', "");
            let sjs = build_dir.join(format!("sdk/spine{tag}.js"));
            let swasm = build_dir.join(format!("sdk/spine{tag}.wasm"));
            if sjs.exists() && swasm.exists() {
                spine_modules.push(SpineModuleResult {
                    version: version.clone(),
                    js_path: sjs.to_string_lossy().to_string(),
                    wasm_path: swasm.to_string_lossy().to_string(),
                });
            }
        }
    }

    let (physics_js_path, physics_wasm_path) = if options.enable_physics {
        let pjs = build_dir.join("sdk/physics.js");
        let pwasm = build_dir.join("sdk/physics.wasm");
        (
            pjs.exists().then(|| pjs.to_string_lossy().to_string()),
            pwasm.exists().then(|| pwasm.to_string_lossy().to_string()),
        )
    } else {
        (None, None)
    };

    CompileResult {
        success,
        js_path: js_path.exists().then(|| js_path.to_string_lossy().to_string()),
        wasm_path: wasm_path.and_then(|p| {
            p.exists().then(|| p.to_string_lossy().to_string())
        }),
        wasm_size,
        error: None,
        cache_key: cache_key.to_string(),
        spine_modules,
        physics_js_path,
        physics_wasm_path,
    }
}

fn compute_cache_key(options: &CompileOptions, engine_src: &Path) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    engine_src.to_string_lossy().hash(&mut hasher);
    let f = &options.features;
    f.tilemap.hash(&mut hasher);
    f.particles.hash(&mut hasher);
    f.timeline.hash(&mut hasher);
    f.postprocess.hash(&mut hasher);
    f.bitmap_text.hash(&mut hasher);
    f.spine.hash(&mut hasher);
    options.target.hash(&mut hasher);
    options.debug.hash(&mut hasher);
    options.optimization.hash(&mut hasher);
    options.enable_physics.hash(&mut hasher);
    options.spine_versions.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn compute_source_hash(engine_src: &Path) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::Hasher;
    let mut hasher = DefaultHasher::new();
    hash_dir_meta(&mut hasher, engine_src);
    format!("{:016x}", hasher.finish())
}

fn build_cmake_flags(options: &CompileOptions) -> Vec<String> {
    let mut flags = vec![
        format!(
            "-DCMAKE_BUILD_TYPE={}",
            if options.debug { "Debug" } else { "Release" }
        ),
        "-DES_BUILD_WEB=ON".to_string(),
        "-DES_BUILD_TESTS=OFF".to_string(),
    ];

    let feature_map = [
        ("ES_ENABLE_TILEMAP", options.features.tilemap),
        ("ES_ENABLE_PARTICLES", options.features.particles),
        ("ES_ENABLE_TIMELINE", options.features.timeline),
        ("ES_ENABLE_POSTPROCESS", options.features.postprocess),
        ("ES_ENABLE_BITMAP_TEXT", options.features.bitmap_text),
        ("ES_ENABLE_SPINE", options.features.spine),
    ];

    for (flag, enabled) in feature_map {
        flags.push(format!("-D{}={}", flag, if enabled { "ON" } else { "OFF" }));
    }

    if !options.debug {
        flags.push(format!("-DCMAKE_C_FLAGS={}", options.optimization));
        flags.push(format!("-DCMAKE_CXX_FLAGS={}", options.optimization));
        flags.push("-DCMAKE_INTERPROCEDURAL_OPTIMIZATION=ON".to_string());
    }

    match options.target.as_str() {
        "wechat" => {
            flags.retain(|f| f != "-DES_BUILD_WEB=ON");
            flags.push("-DES_BUILD_WXGAME=ON".to_string());
        }
        "playable" => {
            flags.push("-DES_BUILD_SINGLE_FILE=ON".to_string());
        }
        _ => {}
    }

    flags
}

fn build_env_vars(emsdk_dir: &Path, app: &AppHandle) -> HashMap<String, String> {
    let mut env = HashMap::new();

    let upstream_dir = emsdk_dir.join("upstream");
    let emscripten_dir = upstream_dir.join("emscripten");

    env.insert("EMSDK".to_string(), emsdk_dir.to_string_lossy().to_string());
    env.insert(
        "EM_CONFIG".to_string(),
        emsdk_dir.join(".emscripten").to_string_lossy().to_string(),
    );

    if let Some((python_path, _)) = find_emsdk_python(emsdk_dir) {
        env.insert("EMSDK_PYTHON".to_string(), python_path.to_string_lossy().to_string());
    }

    let path_sep = if cfg!(windows) { ";" } else { ":" };
    let system_path = std::env::var("PATH").unwrap_or_default();

    let mut path_entries = vec![
        emscripten_dir.to_string_lossy().to_string(),
        upstream_dir.join("bin").to_string_lossy().to_string(),
    ];

    if let Some(bundled_cmake) = find_bundled_cmake(app) {
        if let Some(cmake_bin_dir) = bundled_cmake.parent() {
            path_entries.push(cmake_bin_dir.to_string_lossy().to_string());
        }
    }

    path_entries.push(system_path);
    env.insert("PATH".to_string(), path_entries.join(path_sep));
    env
}

async fn run_command_streamed(
    app: &AppHandle,
    cmd: &str,
    args: &[String],
    cwd: &Path,
    env: &HashMap<String, String>,
) -> Result<(), String> {
    let (program, full_args) = build_command_for_platform(cmd, args);
    let mut command = Command::new(&program);
    command.args(&full_args);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
        .current_dir(cwd)
        .envs(env)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = command.spawn().map_err(|e| {
        format!("Failed to spawn {}: {} (cwd: {})", cmd, e, cwd.display())
    })?;

    let stdout = child.stdout.take().ok_or(format!("Failed to capture stdout for: {}", cmd))?;
    let stderr = child.stderr.take().ok_or(format!("Failed to capture stderr for: {}", cmd))?;

    let app_out = app.clone();
    let stdout_handle = tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut collected = Vec::new();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_out.emit(
                "compile-output",
                super::CommandOutput {
                    stream: "stdout".to_string(),
                    data: line.clone(),
                },
            );
            collected.push(line);
        }
        collected
    });

    let app_err = app.clone();
    let stderr_handle = tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        let mut collected = Vec::new();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_err.emit(
                "compile-output",
                super::CommandOutput {
                    stream: "stderr".to_string(),
                    data: line.clone(),
                },
            );
            collected.push(line);
        }
        collected
    });

    let (stdout_result, stderr_result) = tokio::join!(stdout_handle, stderr_handle);

    let status = child.wait().await.map_err(|e| e.to_string())?;
    if !status.success() {
        let stderr_lines = stderr_result.unwrap_or_default();
        let stdout_lines = stdout_result.unwrap_or_default();

        let mut combined: Vec<&str> = Vec::new();
        combined.extend(stdout_lines.iter().map(|s| s.as_str()));
        combined.extend(stderr_lines.iter().map(|s| s.as_str()));
        let tail: Vec<&str> = combined.iter().rev().take(30).rev().copied().collect();

        let detail = if tail.is_empty() {
            String::new()
        } else {
            format!("\n\nOutput:\n{}", tail.join("\n"))
        };
        return Err(format!(
            "Command failed: {} (exit code: {}){}",
            cmd,
            status.code().unwrap_or(-1),
            detail
        ));
    }

    Ok(())
}

fn num_cpus() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
}

fn build_command_for_platform(cmd: &str, args: &[String]) -> (String, Vec<String>) {
    if cfg!(windows) && cmd.ends_with(".bat") {
        let quoted_cmd = if cmd.contains(' ') {
            format!("\"{}\"", cmd)
        } else {
            cmd.to_string()
        };
        let mut cmd_args = vec!["/C".to_string(), quoted_cmd];
        cmd_args.extend_from_slice(args);
        ("cmd.exe".to_string(), cmd_args)
    } else {
        (cmd.to_string(), args.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bat_file_wraps_with_cmd_exe_on_windows() {
        let args = vec!["cmake".to_string(), "-G".to_string(), "Ninja".to_string()];
        let (program, full_args) = build_command_for_platform("C:\\emsdk\\emcmake.bat", &args);

        if cfg!(windows) {
            assert_eq!(program, "cmd.exe");
            assert_eq!(full_args[0], "/C");
            assert_eq!(full_args[1], "C:\\emsdk\\emcmake.bat");
            assert_eq!(full_args[2], "cmake");
            assert_eq!(full_args[3], "-G");
            assert_eq!(full_args[4], "Ninja");
        } else {
            assert_eq!(program, "C:\\emsdk\\emcmake.bat");
            assert_eq!(full_args, args);
        }
    }

    #[test]
    fn bat_file_with_spaces_gets_quoted_on_windows() {
        let args = vec!["cmake".to_string()];
        let (program, full_args) = build_command_for_platform(
            "C:\\Program Files\\emsdk\\emcmake.bat",
            &args,
        );

        if cfg!(windows) {
            assert_eq!(program, "cmd.exe");
            assert_eq!(full_args[0], "/C");
            assert_eq!(full_args[1], "\"C:\\Program Files\\emsdk\\emcmake.bat\"");
            assert_eq!(full_args[2], "cmake");
        } else {
            assert_eq!(program, "C:\\Program Files\\emsdk\\emcmake.bat");
            assert_eq!(full_args, args);
        }
    }

    #[test]
    fn non_bat_file_passes_through_directly() {
        let args = vec!["-G".to_string(), "Ninja".to_string()];
        let (program, full_args) = build_command_for_platform("/usr/bin/emcmake", &args);

        assert_eq!(program, "/usr/bin/emcmake");
        assert_eq!(full_args, args);
    }

    #[test]
    fn empty_args_handled_correctly() {
        let args: Vec<String> = vec![];
        let (program, full_args) = build_command_for_platform("emcmake.bat", &args);

        if cfg!(windows) {
            assert_eq!(program, "cmd.exe");
            assert_eq!(full_args, vec!["/C", "emcmake.bat"]);
        } else {
            assert_eq!(program, "emcmake.bat");
            assert!(full_args.is_empty());
        }
    }
}

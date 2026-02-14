//! HTTP server for game preview with SSE live reload

use crate::embedded_assets;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use tiny_http::{Header, Response, Server};

const MAX_PORT_ATTEMPTS: u16 = 10;

// =============================================================================
// Preview Server
// =============================================================================

pub struct PreviewServer {
    server: Option<Arc<Server>>,
    reload_signal: Arc<ReloadSignal>,
    project_dir: PathBuf,
    port: u16,
}

struct ReloadSignal {
    counter: AtomicU64,
    shutdown: AtomicBool,
    condvar: Condvar,
    mutex: Mutex<()>,
}

impl ReloadSignal {
    fn new() -> Self {
        Self {
            counter: AtomicU64::new(0),
            shutdown: AtomicBool::new(false),
            condvar: Condvar::new(),
            mutex: Mutex::new(()),
        }
    }

    fn notify(&self) {
        self.counter.fetch_add(1, Ordering::SeqCst);
        self.condvar.notify_all();
    }

    fn shutdown(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
        self.condvar.notify_all();
    }

    fn wait(&self, last_seen: u64) -> Option<u64> {
        let mut guard = self.mutex.lock().unwrap();
        loop {
            if self.shutdown.load(Ordering::SeqCst) {
                return None;
            }
            let current = self.counter.load(Ordering::SeqCst);
            if current != last_seen {
                return Some(current);
            }
            guard = self.condvar.wait(guard).unwrap();
        }
    }

    fn current(&self) -> u64 {
        self.counter.load(Ordering::SeqCst)
    }
}

impl PreviewServer {
    pub fn new(project_dir: PathBuf, port: u16) -> Self {
        Self {
            server: None,
            reload_signal: Arc::new(ReloadSignal::new()),
            project_dir,
            port,
        }
    }

    pub fn start(&mut self) -> Result<u16, String> {
        if self.server.is_some() {
            return Ok(self.port);
        }

        let (server, actual_port) = try_bind(self.port)?;
        self.port = actual_port;

        let server = Arc::new(server);
        self.server = Some(Arc::clone(&server));

        let project_dir = self.project_dir.clone();
        let reload_signal = Arc::clone(&self.reload_signal);

        thread::spawn(move || {
            for request in server.incoming_requests() {
                let url = request.url().to_string();
                let path = url.trim_start_matches('/');

                if path == "sse-reload" {
                    let signal = Arc::clone(&reload_signal);
                    thread::spawn(move || {
                        handle_sse(request, signal);
                    });
                    continue;
                }

                let response = match path {
                    "" | "index.html" => serve_html(),
                    "wasm/esengine.js" => serve_embedded(embedded_assets::ENGINE_JS, "application/javascript"),
                    "wasm/esengine.wasm" => serve_embedded(embedded_assets::ENGINE_WASM, "application/wasm"),
                    "sdk/index.js" => serve_embedded(embedded_assets::SDK_ESM_JS, "application/javascript"),
                    "sdk/index.js.map" => serve_embedded(embedded_assets::SDK_ESM_JS_MAP, "application/json"),
                    "sdk/wasm.js" => serve_embedded(embedded_assets::SDK_WASM_JS, "application/javascript"),
                    "sdk/wasm.js.map" => serve_embedded(embedded_assets::SDK_WASM_JS_MAP, "application/json"),
                    "sdk/spine/index.js" => serve_embedded(embedded_assets::SDK_SPINE_JS, "application/javascript"),
                    "sdk/spine/index.js.map" => serve_embedded(embedded_assets::SDK_SPINE_JS_MAP, "application/json"),
                    "wasm/spine38.js" => serve_embedded(embedded_assets::SPINE38_JS, "application/javascript"),
                    "wasm/spine38.wasm" => serve_embedded(embedded_assets::SPINE38_WASM, "application/wasm"),
                    "wasm/spine41.js" => serve_embedded(embedded_assets::SPINE41_JS, "application/javascript"),
                    "wasm/spine41.wasm" => serve_embedded(embedded_assets::SPINE41_WASM, "application/wasm"),
                    "wasm/spine42.js" => serve_embedded(embedded_assets::SPINE42_JS, "application/javascript"),
                    "wasm/spine42.wasm" => serve_embedded(embedded_assets::SPINE42_WASM, "application/wasm"),
                    "wasm/physics.js" => serve_embedded(embedded_assets::PHYSICS_JS, "application/javascript"),
                    "wasm/physics.wasm" => serve_embedded(embedded_assets::PHYSICS_WASM, "application/wasm"),
                    _ => serve_project_file(&project_dir, path),
                };

                let _ = request.respond(response);
            }
        });

        Ok(self.port)
    }

    pub fn stop(&mut self) {
        self.reload_signal.shutdown();
        if let Some(ref server) = self.server {
            server.unblock();
        }
        self.server = None;
    }

    pub fn notify_reload(&self) {
        self.reload_signal.notify();
    }

    pub fn is_running(&self) -> bool {
        self.server.is_some()
    }

    pub fn port(&self) -> u16 {
        self.port
    }
}

// =============================================================================
// Port Binding
// =============================================================================

fn try_bind(starting_port: u16) -> Result<(Server, u16), String> {
    for offset in 0..MAX_PORT_ATTEMPTS {
        let port = starting_port + offset;
        let addr = format!("127.0.0.1:{}", port);
        match Server::http(&addr) {
            Ok(server) => return Ok((server, port)),
            Err(_) if offset + 1 < MAX_PORT_ATTEMPTS => continue,
            Err(e) => return Err(format!("Failed to bind ports {}-{}: {}", starting_port, port, e)),
        }
    }
    unreachable!()
}

// =============================================================================
// SSE Live Reload
// =============================================================================

fn handle_sse(request: tiny_http::Request, signal: Arc<ReloadSignal>) {
    let headers = vec![
        Header::from_bytes("Content-Type", "text/event-stream").unwrap(),
        Header::from_bytes("Cache-Control", "no-cache").unwrap(),
        Header::from_bytes("Connection", "keep-alive").unwrap(),
        Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap(),
    ];

    let (reader, mut writer) = std::io::pipe().unwrap();
    let response = Response::new(
        tiny_http::StatusCode(200),
        headers,
        Box::new(reader) as Box<dyn std::io::Read + Send>,
        None,
        None,
    );

    let respond_handle = thread::spawn(move || {
        let _ = request.respond(response);
    });

    let mut last_seen = signal.current();
    loop {
        match signal.wait(last_seen) {
            None => break,
            Some(new_val) => last_seen = new_val,
        }
        if writer.write_all(b"data: reload\n\n").is_err() {
            break;
        }
        if writer.flush().is_err() {
            break;
        }
    }

    drop(writer);
    let _ = respond_handle.join();
}

// =============================================================================
// Response Builders
// =============================================================================

fn serve_html() -> Response<std::io::Cursor<Vec<u8>>> {
    let data = embedded_assets::PREVIEW_HTML.as_bytes().to_vec();
    Response::from_data(data)
        .with_header(content_type("text/html"))
        .with_header(no_cache())
        .with_header(cors())
}

fn serve_embedded(data: &[u8], content_type_str: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_data(data.to_vec())
        .with_header(content_type(content_type_str))
        .with_header(no_cache())
        .with_header(cors())
}

fn serve_project_file(project_dir: &PathBuf, path: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    let decoded_path = urlencoding::decode(path).unwrap_or_else(|_| path.into());
    let file_path = project_dir.join(decoded_path.as_ref());

    if !file_path.starts_with(project_dir) {
        return not_found();
    }

    match std::fs::read(&file_path) {
        Ok(data) => {
            Response::from_data(data)
                .with_header(content_type(get_mime_type(path)))
                .with_header(no_cache())
                .with_header(cors())
        }
        Err(_) => not_found(),
    }
}

fn not_found() -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string("Not Found")
        .with_status_code(404)
        .with_header(content_type("text/plain"))
}

fn content_type(ct: &str) -> Header {
    Header::from_bytes("Content-Type", ct).unwrap()
}

fn cors() -> Header {
    Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap()
}

fn no_cache() -> Header {
    Header::from_bytes("Cache-Control", "no-cache").unwrap()
}

fn get_mime_type(path: &str) -> &'static str {
    match path.rsplit('.').next() {
        Some("html") => "text/html",
        Some("js") => "application/javascript",
        Some("wasm") => "application/wasm",
        Some("json") => "application/json",
        Some("css") => "text/css",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        _ => "application/octet-stream",
    }
}

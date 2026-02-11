//! HTTP server for game preview

use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use tiny_http::{Header, Response, Server};

// =============================================================================
// Embedded Assets
// =============================================================================

const PREVIEW_HTML: &str = include_str!("preview_template.html");
const ENGINE_JS: &[u8] = include_bytes!("../../public/wasm/esengine.js");
const ENGINE_WASM: &[u8] = include_bytes!("../../public/wasm/esengine.wasm");
const SDK_JS: &[u8] = include_bytes!("../../public/sdk/esm/esengine.js");
const SDK_JS_MAP: &[u8] = include_bytes!("../../public/sdk/esm/index.js.map");
const SDK_WASM_JS: &[u8] = include_bytes!("../../public/sdk/esm/wasm.js");
const SDK_WASM_JS_MAP: &[u8] = include_bytes!("../../public/sdk/esm/wasm.js.map");
const SDK_SPINE_JS: &[u8] = include_bytes!("../../public/sdk/esm/spine/index.js");
const SDK_SPINE_JS_MAP: &[u8] = include_bytes!("../../public/sdk/esm/spine/index.js.map");
const SPINE38_JS: &[u8] = include_bytes!("../../public/wasm/spine38.js");
const SPINE38_WASM: &[u8] = include_bytes!("../../public/wasm/spine38.wasm");
const SPINE42_JS: &[u8] = include_bytes!("../../public/wasm/spine42.js");
const SPINE42_WASM: &[u8] = include_bytes!("../../public/wasm/spine42.wasm");
const PHYSICS_JS: &[u8] = include_bytes!("../../public/wasm/physics.js");
const PHYSICS_WASM: &[u8] = include_bytes!("../../public/wasm/physics.wasm");

// =============================================================================
// Preview Server
// =============================================================================

pub struct PreviewServer {
    server: Option<Arc<Server>>,
    project_dir: PathBuf,
    port: u16,
}

impl PreviewServer {
    pub fn new(project_dir: PathBuf, port: u16) -> Self {
        Self {
            server: None,
            project_dir,
            port,
        }
    }

    pub fn start(&mut self) -> Result<u16, String> {
        if self.server.is_some() {
            return Ok(self.port);
        }

        let addr = format!("127.0.0.1:{}", self.port);
        let server = Server::http(&addr).map_err(|e| e.to_string())?;
        let server = Arc::new(server);
        self.server = Some(Arc::clone(&server));

        let project_dir = self.project_dir.clone();

        thread::spawn(move || {
            for request in server.incoming_requests() {
                let url = request.url().to_string();
                let path = url.trim_start_matches('/');

                let response = match path {
                    "" | "index.html" => serve_html(),
                    "wasm/esengine.js" => serve_embedded(ENGINE_JS, "application/javascript"),
                    "wasm/esengine.wasm" => serve_embedded(ENGINE_WASM, "application/wasm"),
                    "sdk/index.js" => serve_embedded(SDK_JS, "application/javascript"),
                    "sdk/index.js.map" => serve_embedded(SDK_JS_MAP, "application/json"),
                    "sdk/wasm.js" => serve_embedded(SDK_WASM_JS, "application/javascript"),
                    "sdk/wasm.js.map" => serve_embedded(SDK_WASM_JS_MAP, "application/json"),
                    "sdk/spine/index.js" => serve_embedded(SDK_SPINE_JS, "application/javascript"),
                    "sdk/spine/index.js.map" => serve_embedded(SDK_SPINE_JS_MAP, "application/json"),
                    "wasm/spine38.js" => serve_embedded(SPINE38_JS, "application/javascript"),
                    "wasm/spine38.wasm" => serve_embedded(SPINE38_WASM, "application/wasm"),
                    "wasm/spine42.js" => serve_embedded(SPINE42_JS, "application/javascript"),
                    "wasm/spine42.wasm" => serve_embedded(SPINE42_WASM, "application/wasm"),
                    "wasm/physics.js" => serve_embedded(PHYSICS_JS, "application/javascript"),
                    "wasm/physics.wasm" => serve_embedded(PHYSICS_WASM, "application/wasm"),
                    _ => serve_project_file(&project_dir, path),
                };

                let _ = request.respond(response);
            }
        });

        Ok(self.port)
    }

    pub fn stop(&mut self) {
        self.server = None;
    }

    pub fn is_running(&self) -> bool {
        self.server.is_some()
    }

    pub fn port(&self) -> u16 {
        self.port
    }
}

// =============================================================================
// Response Builders
// =============================================================================

fn serve_html() -> Response<std::io::Cursor<Vec<u8>>> {
    let data = PREVIEW_HTML.as_bytes().to_vec();
    Response::from_data(data)
        .with_header(content_type("text/html"))
        .with_header(cors())
}

fn serve_embedded(data: &[u8], content_type_str: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_data(data.to_vec())
        .with_header(content_type(content_type_str))
        .with_header(cors())
}

fn serve_project_file(project_dir: &PathBuf, path: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    // Decode URL-encoded path (e.g., Chinese characters)
    let decoded_path = urlencoding::decode(path).unwrap_or_else(|_| path.into());
    let file_path = project_dir.join(decoded_path.as_ref());

    if !file_path.starts_with(project_dir) {
        return not_found();
    }

    match std::fs::read(&file_path) {
        Ok(data) => {
            Response::from_data(data)
                .with_header(content_type(get_mime_type(path)))
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

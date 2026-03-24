use tauri::{AppHandle, Emitter};

#[derive(Clone, serde::Serialize)]
struct AiChatChunk {
    data: String,
}

const SYSTEM_PROMPT: &str = "You are an Estella game engine editor assistant. \
Use tools to execute actions directly. Do not just describe what you would do. \
Always prefer calling tools over explaining.";

#[tauri::command]
pub async fn ai_generate_image(
    api_key: String,
    prompt: String,
    provider: String,
    width: Option<u32>,
    height: Option<u32>,
    base_url: Option<String>,
    image_model: Option<String>,
) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::new();

    match provider.as_str() {
        "stability" => generate_stability(&client, &api_key, &prompt, width, height).await,
        "openai" => generate_openai(&client, &api_key, &prompt, width, height, base_url.as_deref(), image_model.as_deref()).await,
        _ => Err(format!("Unknown image provider: {}", provider)),
    }
}

const SPRITE_PROMPT_SUFFIX: &str = ", isolated game sprite, solid white background, \
no shadow, no ground, centered, clean edges, full body visible";

async fn generate_stability(
    client: &reqwest::Client,
    api_key: &str,
    prompt: &str,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<Vec<u8>, String> {
    let w = width.unwrap_or(1024).to_string();
    let h = height.unwrap_or(1024).to_string();

    let enhanced_prompt = format!("{}{}", prompt, SPRITE_PROMPT_SUFFIX);
    eprintln!("[ai_proxy] generate image: prompt=\"{}\"", enhanced_prompt);

    let form = reqwest::multipart::Form::new()
        .text("prompt", enhanced_prompt)
        .text("width", w)
        .text("height", h)
        .text("output_format", "png".to_string());

    let resp = client
        .post("https://api.stability.ai/v2beta/stable-image/generate/core")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Accept", "image/*")
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Stability API error {}: {}", status, body));
    }

    let image_bytes = resp.bytes().await.map(|b| b.to_vec()).map_err(|e| e.to_string())?;

    // Remove background using Stability AI's remove-background API
    eprintln!("[ai_proxy] removing background...");
    match remove_background_stability(client, api_key, &image_bytes).await {
        Ok(transparent) => {
            eprintln!("[ai_proxy] background removed successfully");
            Ok(transparent)
        }
        Err(e) => {
            eprintln!("[ai_proxy] background removal failed: {}, using original", e);
            Ok(image_bytes)
        }
    }
}

async fn remove_background_stability(
    client: &reqwest::Client,
    api_key: &str,
    image_bytes: &[u8],
) -> Result<Vec<u8>, String> {
    let image_part = reqwest::multipart::Part::bytes(image_bytes.to_vec())
        .file_name("image.png")
        .mime_str("image/png")
        .map_err(|e| e.to_string())?;

    let form = reqwest::multipart::Form::new()
        .part("image", image_part)
        .text("output_format", "png".to_string());

    let resp = client
        .post("https://api.stability.ai/v2beta/stable-image/edit/remove-background")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Accept", "image/*")
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Remove-background API error {}: {}", status, body));
    }

    resp.bytes().await.map(|b| b.to_vec()).map_err(|e| e.to_string())
}

async fn generate_openai(
    client: &reqwest::Client,
    api_key: &str,
    prompt: &str,
    width: Option<u32>,
    height: Option<u32>,
    base_url: Option<&str>,
    image_model: Option<&str>,
) -> Result<Vec<u8>, String> {
    let size = match (width.unwrap_or(1024), height.unwrap_or(1024)) {
        (w, h) if w <= 256 && h <= 256 => "256x256",
        (w, h) if w <= 512 && h <= 512 => "512x512",
        _ => "1024x1024",
    };

    let enhanced_prompt = format!("{}{}", prompt, SPRITE_PROMPT_SUFFIX);

    let api_base = base_url
        .filter(|s| !s.is_empty())
        .unwrap_or("https://api.openai.com");
    let url = format!("{}/v1/images/generations", api_base.trim_end_matches('/'));

    let body = serde_json::json!({
        "model": image_model.unwrap_or("gpt-5.4-nano"),
        "prompt": enhanced_prompt,
        "n": 1,
        "size": size,
        "response_format": "b64_json",
    });

    eprintln!("[ai_proxy] image POST {} | model=gpt-image-1 | size={}", url, size);

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Image API error {}: {}", status, body));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let b64 = json["data"][0]["b64_json"]
        .as_str()
        .ok_or("Missing b64_json in response")?;

    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ai_chat_stream(
    app: AppHandle,
    request_id: String,
    api_key: String,
    base_url: Option<String>,
    model: String,
    messages: serde_json::Value,
    tools: Option<serde_json::Value>,
    system_prompt: Option<String>,
    max_tokens: Option<u32>,
) -> Result<(), String> {
    let client = reqwest::Client::new();

    let is_openai_compat = base_url.as_ref().map(|s| !s.is_empty()).unwrap_or(false);

    if is_openai_compat {
        chat_stream_openai(&client, &app, &request_id, &api_key, base_url.as_deref().unwrap(), &model, &messages, &tools, system_prompt.as_deref(), max_tokens).await
    } else {
        chat_stream_claude(&client, &app, &request_id, &api_key, &model, &messages, &tools, max_tokens).await
    }
}

async fn chat_stream_claude(
    client: &reqwest::Client,
    app: &AppHandle,
    request_id: &str,
    api_key: &str,
    model: &str,
    messages: &serde_json::Value,
    tools: &Option<serde_json::Value>,
    max_tokens: Option<u32>,
) -> Result<(), String> {
    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens.unwrap_or(4096),
        "system": SYSTEM_PROMPT,
        "messages": messages,
        "stream": true,
    });

    if let Some(t) = tools {
        body["tools"] = t.clone();
    }

    eprintln!("[ai_proxy] Claude native | model={} | tools={}",
        model, body.get("tools").and_then(|t| t.as_array()).map(|a| a.len()).unwrap_or(0));

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let _ = app.emit(&format!("ai-chat-done-{}", request_id),
            serde_json::json!({ "error": format!("API error {}: {}", status, text) }));
        return Err(format!("Claude API error {}: {}", status, text));
    }

    stream_sse_events(app, request_id, resp).await
}

async fn chat_stream_openai(
    client: &reqwest::Client,
    app: &AppHandle,
    request_id: &str,
    api_key: &str,
    base_url: &str,
    model: &str,
    messages: &serde_json::Value,
    tools: &Option<serde_json::Value>,
    system_prompt: Option<&str>,
    max_tokens: Option<u32>,
) -> Result<(), String> {
    let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));

    let sys = system_prompt.unwrap_or(SYSTEM_PROMPT);
    let mut oai_messages = vec![
        serde_json::json!({ "role": "system", "content": sys }),
    ];
    if let Some(arr) = messages.as_array() {
        for msg in arr {
            oai_messages.push(msg.clone());
        }
    }

    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens.unwrap_or(4096),
        "messages": oai_messages,
        "stream": true,
    });

    if let Some(t) = tools {
        body["tools"] = t.clone();
        body["tool_choice"] = serde_json::json!("auto");
    }

    eprintln!("[ai_proxy] OpenAI compat POST {} | model={} | tools={} | system_prompt_len={}",
        url, model,
        body.get("tools").and_then(|t| t.as_array()).map(|a| a.len()).unwrap_or(0),
        sys.len());

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let _ = app.emit(&format!("ai-chat-done-{}", request_id),
            serde_json::json!({ "error": format!("API error {}: {}", status, text) }));
        return Err(format!("API error {}: {}", status, text));
    }

    stream_sse_events(app, request_id, resp).await
}

fn convert_message_to_openai(msg: &serde_json::Value) -> serde_json::Value {
    let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("user");

    // Simple text content
    if let Some(text) = msg.get("content").and_then(|c| c.as_str()) {
        return serde_json::json!({ "role": role, "content": text });
    }

    // Array content (tool_use / tool_result blocks)
    if let Some(blocks) = msg.get("content").and_then(|c| c.as_array()) {
        // Check if this contains tool_result blocks (from user role)
        let has_tool_results = blocks.iter().any(|b|
            b.get("type").and_then(|t| t.as_str()) == Some("tool_result")
        );

        if has_tool_results {
            // Convert tool_results to OpenAI tool messages
            let mut msgs = vec![];
            for block in blocks {
                if block.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                    let tool_call_id = block.get("tool_use_id").and_then(|i| i.as_str()).unwrap_or("call_0");
                    let content = block.get("content").and_then(|c| c.as_str()).unwrap_or("");
                    msgs.push(serde_json::json!({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": content,
                    }));
                }
            }
            // Return first one; the rest will be lost but most cases have one tool result
            // TODO: handle multiple tool results properly
            return msgs.into_iter().next().unwrap_or(serde_json::json!({ "role": role, "content": "" }));
        }

        // Assistant message with tool_use blocks
        let has_tool_use = blocks.iter().any(|b|
            b.get("type").and_then(|t| t.as_str()) == Some("tool_use")
        );

        if has_tool_use {
            let mut text_parts = String::new();
            let mut tool_calls = vec![];

            for block in blocks {
                match block.get("type").and_then(|t| t.as_str()) {
                    Some("text") => {
                        if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                            text_parts.push_str(t);
                        }
                    }
                    Some("tool_use") => {
                        let id = block.get("id").and_then(|i| i.as_str()).unwrap_or("call_0");
                        let name = block.get("name").and_then(|n| n.as_str()).unwrap_or("");
                        let input = block.get("input").cloned().unwrap_or(serde_json::json!({}));
                        tool_calls.push(serde_json::json!({
                            "id": id,
                            "type": "function",
                            "function": {
                                "name": name,
                                "arguments": serde_json::to_string(&input).unwrap_or_default(),
                            }
                        }));
                    }
                    _ => {}
                }
            }

            let mut msg = serde_json::json!({
                "role": "assistant",
            });
            if !text_parts.is_empty() {
                msg["content"] = serde_json::json!(text_parts);
            } else {
                msg["content"] = serde_json::Value::Null;
            }
            if !tool_calls.is_empty() {
                msg["tool_calls"] = serde_json::json!(tool_calls);
            }
            return msg;
        }
    }

    // Fallback
    serde_json::json!({ "role": role, "content": msg.get("content").cloned().unwrap_or(serde_json::json!("")) })
}

async fn stream_sse_events(
    app: &AppHandle,
    request_id: &str,
    resp: reqwest::Response,
) -> Result<(), String> {
    let chunk_event = format!("ai-chat-chunk-{}", request_id);
    let done_event = format!("ai-chat-done-{}", request_id);

    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].to_string();
            buffer = buffer[newline_pos + 1..].to_string();

            let line = line.trim();
            if line.is_empty() || !line.starts_with("data: ") {
                continue;
            }

            let data = &line[6..];
            if data == "[DONE]" {
                continue;
            }

            let _ = app.emit(&chunk_event, AiChatChunk { data: data.to_string() });
        }
    }

    let _ = app.emit(&done_event, serde_json::json!({ "ok": true }));
    Ok(())
}

use screenshots::Screen;
use base64::{Engine as _, engine::general_purpose};
use std::io::Cursor;
use image::ImageFormat;
use std::time::Instant;

fn encode_png_data_url(image: image::DynamicImage) -> Result<String, String> {
    let mut buffer = Cursor::new(Vec::new());
    image
        .write_to(&mut buffer, ImageFormat::Png)
        .map_err(|_| "Failed to encode PNG".to_string())?;
    let bytes = buffer.into_inner();
    let b64 = general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:image/png;base64,{}", b64))
}

fn encode_jpeg_data_url(image: image::DynamicImage) -> Result<String, String> {
    let mut buffer = Cursor::new(Vec::new());
    image
        .write_to(&mut buffer, ImageFormat::Jpeg)
        .map_err(|_| "Failed to encode JPEG".to_string())?;
    let bytes = buffer.into_inner();
    let b64 = general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:image/jpeg;base64,{}", b64))
}

fn capture_full_screen_blocking() -> Result<String, String> {
    let start = Instant::now();
    eprintln!("[CapturePro] capture_full_screen start");
    let screen = Screen::all()
        .map_err(|e| format!("Failed to list screens: {}", e))?
        .into_iter()
        .next()
        .ok_or_else(|| "No monitors detected".to_string())?;
    let image = screen
        .capture()
        .map_err(|e| format!("Screen capture error: {}", e))?;
    let out = encode_png_data_url(image::DynamicImage::ImageRgba8(image));
    eprintln!("[CapturePro] capture_full_screen done in {:?}", start.elapsed());
    out
}

fn capture_full_screen_preview_blocking() -> Result<String, String> {
    let start = Instant::now();
    eprintln!("[CapturePro] capture_full_screen_preview start");
    let screen = Screen::all()
        .map_err(|e| format!("Failed to list screens: {}", e))?
        .into_iter()
        .next()
        .ok_or_else(|| "No monitors detected".to_string())?;
    let image = screen
        .capture()
        .map_err(|e| format!("Screen capture error: {}", e))?;
    let out = encode_jpeg_data_url(image::DynamicImage::ImageRgba8(image));
    eprintln!(
        "[CapturePro] capture_full_screen_preview done in {:?}",
        start.elapsed()
    );
    out
}

fn capture_region_blocking(x: i32, y: i32, width: u32, height: u32) -> Result<String, String> {
    let start = Instant::now();
    eprintln!("[CapturePro] capture_region start");
    let screens = Screen::all().map_err(|e| e.to_string())?;
    if let Some(screen) = screens.get(0) {
        let image = screen
            .capture_area(x, y, width, height)
            .map_err(|e| e.to_string())?;
        let out = encode_png_data_url(image::DynamicImage::ImageRgba8(image));
        eprintln!("[CapturePro] capture_region done in {:?}", start.elapsed());
        out
    } else {
        eprintln!("[CapturePro] capture_region failed in {:?}: no screens found", start.elapsed());
        Err("No screens found".to_string())
    }
}

#[tauri::command]
pub async fn capture_full_screen() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(capture_full_screen_blocking)
        .await
        .map_err(|e| format!("Capture task failed: {}", e))?
}

#[tauri::command]
pub async fn capture_full_screen_preview() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(capture_full_screen_preview_blocking)
        .await
        .map_err(|e| format!("Capture task failed: {}", e))?
}

#[tauri::command]
pub async fn capture_region(x: i32, y: i32, width: u32, height: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || capture_region_blocking(x, y, width, height))
        .await
        .map_err(|e| format!("Capture task failed: {}", e))?
}

use screenshots::Screen;
use base64::{Engine as _, engine::general_purpose};
use std::io::Cursor;
use image::ImageFormat;
use std::time::Instant;
#[cfg(not(target_os = "windows"))]
use std::time::Duration;
use tauri::Manager;

#[cfg(target_os = "windows")]
fn overlay_cursor_on_capture(image: &mut image::RgbaImage, origin_x: i32, origin_y: i32) {
    use std::mem::size_of;
    use std::ptr::null_mut;

    use windows::Win32::Foundation::{HANDLE, POINT};
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAP,
        BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, GetObjectW, HBRUSH, HDC,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CopyIcon, DestroyIcon, DrawIconEx, GetCursorInfo, GetIconInfo, GetPhysicalCursorPos,
        CURSORINFO, CURSOR_SHOWING, DI_NORMAL, ICONINFO,
    };

    unsafe {
        let mut cursor_pos = POINT::default();
        if GetPhysicalCursorPos(&mut cursor_pos).is_err() {
            return;
        }

        let mut cursor_info = CURSORINFO {
            cbSize: size_of::<CURSORINFO>() as u32,
            ..Default::default()
        };
        if GetCursorInfo(&mut cursor_info).is_err() {
            return;
        }
        if cursor_info.flags != CURSOR_SHOWING {
            return;
        }

        let icon = match CopyIcon(cursor_info.hCursor) {
            Ok(h) => h,
            Err(_) => return,
        };

        let mut icon_info = ICONINFO::default();
        if GetIconInfo(icon, &mut icon_info).is_err() {
            let _ = DestroyIcon(icon);
            return;
        }

        let source_bmp = if !icon_info.hbmColor.is_invalid() {
            icon_info.hbmColor
        } else {
            icon_info.hbmMask
        };

        let mut bmp = BITMAP::default();
        if GetObjectW(
            source_bmp,
            size_of::<BITMAP>() as i32,
            Some((&mut bmp as *mut BITMAP).cast()),
        ) == 0
        {
            let _ = DeleteObject(icon_info.hbmColor);
            let _ = DeleteObject(icon_info.hbmMask);
            let _ = DestroyIcon(icon);
            return;
        }

        let width = bmp.bmWidth;
        let mut height = bmp.bmHeight;
        if icon_info.hbmColor.is_invalid() {
            height /= 2; // monochrome cursor masks are stacked (AND + XOR)
        }
        if width <= 0 || height <= 0 {
            let _ = DeleteObject(icon_info.hbmColor);
            let _ = DeleteObject(icon_info.hbmMask);
            let _ = DestroyIcon(icon);
            return;
        }

        let mem_dc = CreateCompatibleDC(HDC(0));
        if mem_dc.is_invalid() {
            let _ = DeleteObject(icon_info.hbmColor);
            let _ = DeleteObject(icon_info.hbmMask);
            let _ = DestroyIcon(icon);
            return;
        }

        let mut bits: *mut core::ffi::c_void = null_mut();
        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [Default::default()],
        };

        let dib = match CreateDIBSection(mem_dc, &bmi, DIB_RGB_COLORS, &mut bits, HANDLE(0), 0) {
            Ok(h) => h,
            Err(_) => {
                let _ = DeleteDC(mem_dc);
                let _ = DeleteObject(icon_info.hbmColor);
                let _ = DeleteObject(icon_info.hbmMask);
                let _ = DestroyIcon(icon);
                return;
            }
        };

        let old_obj = SelectObject(mem_dc, dib);
        if old_obj.is_invalid() || bits.is_null() {
            let _ = SelectObject(mem_dc, old_obj);
            let _ = DeleteObject(dib);
            let _ = DeleteDC(mem_dc);
            let _ = DeleteObject(icon_info.hbmColor);
            let _ = DeleteObject(icon_info.hbmMask);
            let _ = DestroyIcon(icon);
            return;
        }

        let dib_size = (width as usize)
            .saturating_mul(height as usize)
            .saturating_mul(4);
        let dib_bytes = std::slice::from_raw_parts_mut(bits.cast::<u8>(), dib_size);
        dib_bytes.fill(0);

        let _ = DrawIconEx(
            mem_dc,
            0,
            0,
            icon,
            width,
            height,
            0,
            HBRUSH(0),
            DI_NORMAL,
        );

        let base_x = cursor_pos.x - origin_x - (icon_info.xHotspot as i32);
        let base_y = cursor_pos.y - origin_y - (icon_info.yHotspot as i32);

        let img_w = image.width() as i32;
        let img_h = image.height() as i32;

        for cy in 0..height {
            let dy = base_y + cy;
            if dy < 0 || dy >= img_h {
                continue;
            }
            for cx in 0..width {
                let dx = base_x + cx;
                if dx < 0 || dx >= img_w {
                    continue;
                }
                let i = ((cy as usize) * (width as usize) + (cx as usize)) * 4;
                let b = dib_bytes[i] as u8;
                let g = dib_bytes[i + 1] as u8;
                let r = dib_bytes[i + 2] as u8;
                let a = dib_bytes[i + 3] as u8;
                if a == 0 {
                    continue;
                }

                let alpha = (a as f32) / 255.0;
                let premultiplied = r <= a && g <= a && b <= a;
                let sr = if premultiplied { r as f32 } else { (r as f32) * alpha };
                let sg = if premultiplied { g as f32 } else { (g as f32) * alpha };
                let sb = if premultiplied { b as f32 } else { (b as f32) * alpha };
                let inv = 1.0 - alpha;

                let px = image.get_pixel_mut(dx as u32, dy as u32);
                let dr = px[0] as f32;
                let dg = px[1] as f32;
                let db = px[2] as f32;

                px[0] = (sr + dr * inv).clamp(0.0, 255.0) as u8;
                px[1] = (sg + dg * inv).clamp(0.0, 255.0) as u8;
                px[2] = (sb + db * inv).clamp(0.0, 255.0) as u8;
                px[3] = 255;
            }
        }

        let _ = SelectObject(mem_dc, old_obj);
        let _ = DeleteObject(dib);
        let _ = DeleteDC(mem_dc);
        let _ = DeleteObject(icon_info.hbmColor);
        let _ = DeleteObject(icon_info.hbmMask);
        let _ = DestroyIcon(icon);
    }
}

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
    let mut image = screen
        .capture()
        .map_err(|e| format!("Screen capture error: {}", e))?;
    #[cfg(target_os = "windows")]
    overlay_cursor_on_capture(&mut image, screen.display_info.x, screen.display_info.y);
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
    let mut image = screen
        .capture()
        .map_err(|e| format!("Screen capture error: {}", e))?;
    #[cfg(target_os = "windows")]
    overlay_cursor_on_capture(&mut image, screen.display_info.x, screen.display_info.y);
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
        let mut image = screen
            .capture_area(x, y, width, height)
            .map_err(|e| e.to_string())?;
        #[cfg(target_os = "windows")]
        overlay_cursor_on_capture(
            &mut image,
            screen.display_info.x + x,
            screen.display_info.y + y,
        );
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

#[tauri::command]
pub async fn capture_region_clean(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    fn flush_compositor() {
        unsafe {
            use windows::Win32::Graphics::Dwm::DwmFlush;
            let _ = DwmFlush();
            let _ = DwmFlush();
        }
    }

    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
        #[cfg(target_os = "windows")]
        {
            for _ in 0..40 {
                match overlay.is_visible() {
                    Ok(true) => {
                        flush_compositor();
                        std::thread::sleep(std::time::Duration::from_millis(5));
                    }
                    Ok(false) => break,
                    Err(_) => break,
                }
            }
        }
    }

    let result = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        flush_compositor();
        #[cfg(not(target_os = "windows"))]
        std::thread::sleep(Duration::from_millis(140));
        capture_region_blocking(x, y, width, height)
    })
    .await
    .map_err(|e| format!("Capture task failed: {}", e))?;

    // If capture failed, re-show overlay so the user can retry.
    if result.is_err() {
        if let Some(overlay) = app.get_webview_window("overlay") {
            let _ = overlay.show();
            let _ = overlay.set_focus();
        }
    }

    result
}

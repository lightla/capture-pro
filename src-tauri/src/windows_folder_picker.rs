#[cfg(target_os = "windows")]
use windows::{
    core::{HSTRING, PCWSTR},
    Win32::{
        Foundation::HWND,
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
        },
        UI::Shell::{
            FileOpenDialog, IFileOpenDialog, IShellItem, SHCreateItemFromParsingName,
            SIGDN_FILESYSPATH, FOS_FORCEFILESYSTEM, FOS_PATHMUSTEXIST, FOS_PICKFOLDERS,
        },
    },
};

#[cfg(target_os = "windows")]
fn is_cancelled_hresult(code: i32) -> bool {
    // HRESULT_FROM_WIN32(ERROR_CANCELLED=1223) == 0x800704C7
    code == -2147023673i32
}

#[tauri::command]
pub fn pick_windows_folder(default_path: Option<String>) -> Result<Option<String>, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = default_path;
        return Err("Windows folder picker is only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::thread::spawn(move || unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE)
                .map_err(|e| format!("CoInitializeEx failed: {e}"))?;

            let result = (|| {
                let dialog: IFileOpenDialog =
                    CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)
                        .map_err(|e| format!("CoCreateInstance(FileOpenDialog) failed: {e}"))?;

                let opts = dialog
                    .GetOptions()
                    .map_err(|e| format!("GetOptions failed: {e}"))?;
                dialog
                    .SetOptions(opts | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST)
                    .map_err(|e| format!("SetOptions failed: {e}"))?;

                if let Some(p) = default_path.as_ref() {
                    if !p.trim().is_empty() {
                        let hs = HSTRING::from(p.as_str());
                        let item: IShellItem = SHCreateItemFromParsingName(
                            PCWSTR(hs.as_ptr()),
                            None,
                        )
                        .map_err(|e| format!("Invalid default folder: {e}"))?;
                        let _ = dialog.SetFolder(&item);
                    }
                }

                match dialog.Show(HWND(0)) {
                    Ok(_) => {}
                    Err(e) => {
                        if is_cancelled_hresult(e.code().0) {
                            return Ok(None);
                        }
                        return Err(format!("Dialog show failed: {e}"));
                    }
                }

                let item = dialog
                    .GetResult()
                    .map_err(|e| format!("GetResult failed: {e}"))?;
                let display = item
                    .GetDisplayName(SIGDN_FILESYSPATH)
                    .map_err(|e| format!("GetDisplayName failed: {e}"))?;
                let path = display
                    .to_string()
                    .map_err(|e| format!("Failed to decode path: {e}"))?;
                CoTaskMemFree(Some(display.0 as _));
                Ok(Some(path))
            })();

            CoUninitialize();
            result
        })
        .join()
        .unwrap_or_else(|_| Err("Folder picker thread panicked".to_string()))
    }
}


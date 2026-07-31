// Hide the Windows console window in release builds (debug keeps it for logs).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // On the proprietary NVIDIA driver, WebKitGTK's DMABUF renderer fails to
    // allocate its GBM buffers and the window paints nothing but white. The
    // software path renders fine, so opt out of DMABUF there and leave the
    // accelerated path alone everywhere else. An explicit value always wins.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
        && std::path::Path::new("/sys/module/nvidia").exists()
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    melora_desktop_lib::run()
}

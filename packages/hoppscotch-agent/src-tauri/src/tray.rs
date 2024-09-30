use std::sync::Arc;

use tauri::{
    menu::{MenuBuilder, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager
};

use crate::state::AppState;

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let clear_registrations = MenuItem::with_id(
      app,
      "clear_registrations",
      "Clear Registrations",
      true,
      None::<&str>
    )?;

    let pkg_info = app.package_info();
    let app_name = pkg_info.name.clone();
    let app_version = pkg_info.version.clone();

    let app_name_item = MenuItem::with_id(app, "app_name", app_name, false, None::<&str>)?;
    let app_version_item = MenuItem::with_id(app, "app_version", format!("Version: {}", app_version), false, None::<&str>)?;

    let menu = MenuBuilder::new(app)
      .item(&app_name_item)
      .item(&app_version_item)
      .separator()
      .item(&clear_registrations)
      .item(&quit_i)
      .build()?;

    let _ = TrayIconBuilder::with_id("hopp-tray")
        .tooltip("Hoppscotch Agent")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "quit" => {
                app.exit(-1);
            },
            "clear_registrations" => {
              let app_state = app.state::<Arc<AppState>>();

              app_state.update_registrations(app.clone(), |regs| {
                regs.clear();
              });
            },
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app);

    Ok(())
}

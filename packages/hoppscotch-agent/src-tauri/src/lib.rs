pub mod app_handle_ext;
pub mod controller;
pub mod error;
pub mod interceptor;
pub mod model;
pub mod route;
pub mod server;
pub mod state;
pub mod tray;
pub mod util;

use state::AppState;
use std::sync::Arc;
use tauri::{Listener, Manager, WebviewWindowBuilder};
use tokio_util::sync::CancellationToken;

#[tauri::command]
async fn get_otp(state: tauri::State<'_, Arc<AppState>>) -> Result<Option<String>, ()> {
  Ok(
    state
      .active_registration_code
      .read()
      .await
      .clone()
  )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    let app_state = Arc::new(AppState::new());
    let server_state = app_state.clone();
    let cancellation_token = CancellationToken::new();
    let server_cancellation_token = cancellation_token.clone();

    tauri::Builder::default()
        .setup(move |app| {
            let app_handle = app.app_handle();

            let server_state = server_state.clone();
            let server_cancellation_token = server_cancellation_token.clone();

            let server_app_handle = app_handle.clone();

            tauri::async_runtime::spawn(async move {
                server::run_server(server_state, server_cancellation_token, server_app_handle)
                    .await;
            });

            #[cfg(all(desktop))]
            {
                let handle = app.handle();
                tray::create_tray(handle)?;
            }

            // Blocks the app from populating the macOS dock
            #[cfg(target_os = "macos")]
            {
              app_handle.set_activation_policy(tauri::ActivationPolicy::Accessory)
                  .unwrap();
            };

            let app_handle_ref = app_handle.clone();

            app_handle.listen("registration_received", move |_| {
                WebviewWindowBuilder::from_config(
                    &app_handle_ref,
                    &app_handle_ref.config().app.windows[0]
                )
                  .unwrap()
                  .build()
                  .unwrap()
                  .show()
                  .unwrap();
            });

            Ok(())
        })
        .manage(app_state)
        .manage(cancellation_token)
        .on_window_event(|window, event| {
          match &event {
            tauri::WindowEvent::CloseRequested { .. } => {
              let app_state = window.state::<Arc<AppState>>();

              let mut current_code =
                app_state.active_registration_code.blocking_write();

              if current_code.is_some() {
                *current_code = None;
              }
            },
            _ => {}
          };
        })
        .invoke_handler(tauri::generate_handler![
          get_otp
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            tauri::RunEvent::ExitRequested { api, code, .. } => {
                dbg!(code);
                if code.is_none() || matches!(code, Some(0)) {
                    api.prevent_exit()
                } else if code.is_some() {
                    let state = app_handle.state::<CancellationToken>();
                    state.cancel();
                }
            }
            _ => {}
        });
}

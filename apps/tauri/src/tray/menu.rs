//! Tray menu construction.

use tauri::{
    App, Runtime,
    menu::{Menu, MenuItemBuilder, PredefinedMenuItem},
};

pub fn create_tray_menu<R: Runtime>(app: &App<R>) -> Result<Menu<R>, tauri::Error> {
    let show = MenuItemBuilder::with_id("show", "打开仪表盘").build(app)?;
    let chat = MenuItemBuilder::with_id("chat", "智能体对话").build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let status = MenuItemBuilder::with_id("status", "状态：检查中...")
        .enabled(false)
        .build(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出 QuantClaw").build(app)?;

    Menu::with_items(app, &[&show, &chat, &sep1, &status, &sep2, &quit])
}

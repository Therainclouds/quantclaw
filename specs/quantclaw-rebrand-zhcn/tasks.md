# QuantClaw 品牌化与中文化改造任务清单

## 任务分组

本任务按已确认优先级执行：

1. 品牌可见层统一与外链关闭
2. 用户可见界面全中文
3. 正式品牌资源替换
4. `QQ` / `微信` / `企业微信 WeCom` 专用向导式配置

---

## 阶段一：品牌可见层统一与外链关闭

### 1.1 Web 品牌名与图片入口统一

- 修改 `web/index.html`
  - 统一页面标题
  - 调整 favicon 引用到新的品牌资源路径或过渡资源
- 修改 `web/src/App.tsx`
  - 替换首页品牌图引用
  - 统一首页品牌名称
- 修改 `web/src/components/layout/Sidebar.tsx`
  - 替换侧边栏品牌图引用
  - 统一侧边栏品牌标题与副标题

### 1.2 Tauri 品牌名与标题统一

- 修改 `apps/tauri/tauri.conf.json`
  - 确认 `productName`
  - 确认窗口标题
  - 确认图标入口文件
- 修改 `apps/tauri/src/tray/icon.rs`
  - 替换托盘状态文案
- 修改 `apps/tauri/src/tray/menu.rs`
  - 替换托盘菜单文案
- 修改 `apps/tauri/onboarding/index.html`
  - 替换欢迎页中的品牌文案
- 修改 `apps/tauri/windows/app.manifest`
  - 替换 Windows 显示名称与描述

### 1.3 用户可见外链关闭

- 审计 Web 用户可见页面中的外部官方链接
- 审计 Tauri 欢迎页、托盘菜单或帮助入口中的外部官方链接
- 对所有用户可见官方链接执行以下策略之一：
  - 删除入口
  - 隐藏按钮
  - 替换为本地说明文案

### 1.4 阶段一验证

- 检查 Web 主要入口页是否全部显示统一品牌
- 检查桌面窗口、托盘、欢迎页是否全部显示统一品牌
- 检查用户界面中是否仍存在 GitHub / 官方 docs / 官方网站跳转

---

## 阶段二：用户可见界面全中文

### 2.1 Web 国际化收敛

- 审计 `web/src/lib/i18n.ts` 中已有中文词条
- 扫描用户可见页面中的硬编码英文
- 将硬编码英文迁移到统一翻译入口
- 统一中文术语：
  - Agent
  - Channel
  - Tool
  - Integration
  - Pairing
  - Onboarding
  - Memory
  - Provider

### 2.2 配置页与引导页中文化

- 修改 `web/src/pages/Config.tsx`
- 修改 `web/src/pages/onboard/Onboard.tsx`
- 修改 `web/src/components/onboard/SectionPicker.tsx`
- 修改 `web/src/components/onboard/FieldForm.tsx`
- 修改其他残留英文明显的用户可见页面

### 2.3 Tauri 欢迎引导中文化

- 修改 `apps/tauri/onboarding/index.html`
  - 标题、步骤说明、按钮文本、权限说明全部中文化

### 2.4 CLI 用户可见提示中文化

- 修改 `src/main.rs`
  - 移除明显英文 fallback
- 修改 `crates/zeroclaw-runtime/locales/zh-CN/cli.ftl`
  - 补全中文文案
- 如有必要，调整 `crates/zeroclaw-runtime/src/i18n.rs`
  - 让默认语言策略更符合中文交付目标

### 2.5 阶段二验证

- 抽查 Dashboard、Config、Onboard、Integrations、AgentChat、Cron 页面
- 抽查 Tauri 欢迎页
- 抽查 CLI 典型提示
- 确认内部开发文档未被中文化改动

---

## 阶段三：正式品牌资源替换

### 3.1 Web 资源替换

- 使用以下已确认资源：
  - `web/public/logo.png`
  - `web/public/quantclaw-trans.png`
- 统一 Web 页面品牌图引用到正式资源
- 评估是否单独生成 favicon 资源

### 3.2 Tauri 资源替换

- 等待用户提供桌面应用图标素材
- 替换以下资源：
  - `apps/tauri/icons/icon.png`
  - `apps/tauri/icons/icon.ico`
  - `apps/tauri/icons/icon.icns`
  - `apps/tauri/icons/tray-*.png`

### 3.3 阶段三验证

- 检查 Web 图标与品牌图是否显示正确
- 检查桌面端窗口图标与托盘图标是否显示正确
- 检查不同尺寸下图标是否清晰

---

## 阶段四：QQ / 微信 / 企业微信专用向导式配置

### 4.1 需求梳理

- 梳理 `QQ` 配置路径与最少必填项
- 梳理 `微信` 配置路径、二维码流程、绑定流程
- 梳理 `企业微信 WeCom` 配置路径与最少必填项
- 明确哪些能力已由后端提供，哪些需要补 gateway 接口

### 4.2 向导元数据与入口设计

- 调整 `crates/zeroclaw-config/src/sections.rs`
  - 优化频道分组与展示顺序
- 调整 `crates/zeroclaw-gateway/src/api_onboard.rs`
  - 输出专用向导所需元数据

### 4.3 Web 专用配置入口

- 修改 `web/src/pages/Config.tsx`
  - 增加渠道配置专用入口
- 修改 `web/src/pages/onboard/Onboard.tsx`
  - 增加 `QQ` / `微信` / `企业微信` 专用流转
- 修改 `web/src/components/onboard/SectionPicker.tsx`
  - 增加渠道说明卡片
- 修改 `web/src/components/onboard/FieldForm.tsx`
  - 增加渠道专用帮助块与错误说明

### 4.4 微信二维码扫描创建

- 基于 `crates/zeroclaw-channels/src/wechat.rs` 梳理现有二维码与绑定能力
- 为前端补充二维码状态展示接口或复用现有接口
- 设计二维码创建、扫描、超时、重试、绑定完成的状态流
- 在 Web 向导中落地二维码扫描创建体验

### 4.5 阶段四验证

- 用户可通过图形界面完成 `QQ` 配置
- 用户可通过图形界面完成 `企业微信` 配置
- 用户可通过二维码扫描流程进入 `微信` 创建与绑定
- 用户无需直接编辑 TOML 完成常见接入

---

## 建议提交拆分

### 提交批次一

- 品牌可见层统一
- 用户可见外链关闭

### 提交批次二

- 用户可见界面全中文

### 提交批次三

- 正式品牌资源替换

### 提交批次四

- `QQ` / `微信` / `企业微信` 专用向导

---

## 执行备注

- 每一阶段开始前先复查影响文件，避免误改内部文档
- 每一阶段完成后都要执行最小验证与页面抽查
- 后续若微信二维码创建需要新增状态结构，必须先确认其事实来源，禁止引入重复状态

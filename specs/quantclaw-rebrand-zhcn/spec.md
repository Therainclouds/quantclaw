# QuantClaw 品牌化与中文化改造规格

## 1. 背景

当前仓库已经存在部分 `QuantClaw` 用户可见品牌替换，但整体仍混有 `ZeroClaw` / `zeroclaw` / `QuantClaw` 三套用户可见名称、旧品牌图片引用、残留官方外链，以及大量英文用户界面文案。与此同时，`QQ`、`微信`、`企业微信 WeCom` 的底层通道与配置模型已经存在，但面向终端用户的图形化配置体验仍以通用表单为主，不适合直接交付。

本规格用于规划一次分阶段、可回滚的产品化改造，目标是在不改动内部开发文档与内部工程标识的前提下，完成：

- 用户可见层品牌统一
- 用户可见层全中文化
- Web 品牌图片资源替换
- `QQ` / `微信` / `企业微信` 专用向导式配置体验

## 2. 目标

- 统一所有用户可见品牌名称、图片、标题、托盘文案与欢迎页文案
- 关闭所有用户可见界面中跳转到 GitHub、官方文档、官方站点的入口
- 让 Web、Tauri、CLI 的用户可见界面默认中文，并尽量保持术语一致
- 保留现有 `Config` / `gateway sections` / `channels schema` 作为唯一配置事实来源
- 后续为 `QQ`、`微信`、`企业微信 WeCom` 提供中文化的专用向导式配置体验
- 为微信通道预留二维码扫描创建与绑定体验的实现入口

## 3. 非目标

- 不修改 crate 名、Rust 模块名、协议名、内部存储 key、内部事件名等工程内部标识
- 不整体迁移或中文化内部开发文档、Wiki、RFC、维护手册
- 不在第一阶段改动桌面端安装包内部 `identifier`
- 不在第一阶段修改所有对外文档站点内容
- 不在第一阶段直接实现完整的微信二维码创建流程

## 4. 约束

- 严格遵守仓库“单一事实来源”规则，不新增重复配置状态
- 用户可见品牌替换仅影响 UI、文案、图片与资源引用，不创建第二套品牌配置缓存
- 语言设置以后端已有 `Config.locale` 作为长期目标事实来源；Web 侧不得长期保留一套独立真相
- `QQ` / `微信` / `企业微信` 的专用体验必须复用现有 schema 与 gateway 元数据，不新增“前端专用配置字段”
- 所有新增的用户可见文案必须可持续维护，避免散落硬编码

## 5. 已确认决策

- 品牌替换范围：只做用户可见层
- 用户可见外链策略：关闭所有 GitHub / 官方文档 / 官方站点跳转入口
- 中文化范围：所有用户可见界面全中文，内部开发文档不动
- 渠道范围：包含 `QQ`、`微信`、`企业微信 WeCom`
- 渠道体验目标：后续采用专用向导式配置，不满足于通用表单
- 实施顺序：先做品牌与中文化，再替换正式品牌资源，最后做 `QQ` / `微信` / `企业微信` 专用向导
- 阶段三当前收口策略：先完成 Web 品牌资源替换，Tauri 图标资源替换后置

## 6. 已确认品牌资源

当前已确认纳入第一轮 Web 品牌替换的图片资源如下：

- `web/public/logo.png`
- `web/public/quantclaw-trans.png`

这些资源在第一阶段将主要用于：

- Web 首页品牌图
- Web 侧边栏品牌图
- Web 标签页图标或其过渡方案

后续仍需补充桌面端图标素材，包括但不限于：

- `apps/tauri/icons/icon.png`
- `apps/tauri/icons/icon.ico`
- `apps/tauri/icons/icon.icns`
- `apps/tauri/icons/tray-*.png`

当前阶段三不处理上述 Tauri 图标文件，先沿用现有桌面端资源。

## 7. 分阶段范围

### 阶段一：品牌可见层统一与外链关闭

范围：

- Web 首页、侧边栏、浏览器标题、favicon 引用
- Tauri 应用显示名、窗口标题、托盘提示、托盘菜单、欢迎页文案
- 用户可见页内残留的旧品牌名称
- 用户可见 UI 中的 GitHub / 官方文档 / 官方站点跳转入口

预期结果：

- 用户进入系统后只看到统一品牌
- 所有用户可见官方外链都被移除、隐藏或禁用

### 阶段二：用户可见界面全中文

范围：

- Web 页面文案
- Web 配置向导、配置表单、空态、错误态
- Tauri 欢迎引导
- CLI 用户可见提示与 fallback 文案
- 需要用户直接理解的配置帮助文案

预期结果：

- Web / Tauri / CLI 用户可见界面默认中文
- 主要业务页无明显英文残留

### 阶段三：品牌资源正式替换

范围：

- Web 品牌图片与 favicon
- Tauri 主图标（后置）
- Tauri 托盘图标（后置）
- 必要的欢迎页或空态品牌视觉资源

预期结果：

- 当前阶段先完成 Web 正式视觉替换
- Tauri 图标替换等待后续桌面端素材到位后单独执行

### 阶段四：QQ / 微信 / 企业微信专用向导式配置

范围：

- `QQ`、`微信`、`企业微信` 的入口与说明卡片
- 渠道专用帮助文案、字段说明、连接提示
- 微信二维码扫描创建与绑定体验的实现规划与落地
- 频道专用状态与流程引导

预期结果：

- 用户无需直接编辑 TOML 即可完成常见配置
- 微信通道支持二维码扫描创建路径

## 8. 主要影响面

### Web

- `web/index.html`
- `web/src/App.tsx`
- `web/src/components/layout/Sidebar.tsx`
- `web/src/lib/i18n.ts`
- `web/src/contexts/ThemeContext.tsx`
- `web/src/pages/Config.tsx`
- `web/src/pages/onboard/Onboard.tsx`
- `web/src/components/onboard/SectionPicker.tsx`
- `web/src/components/onboard/FieldForm.tsx`
- `web/src/pages/Integrations.tsx`
- 其他残留英文或旧品牌文案的用户可见页面

### Tauri

- `apps/tauri/tauri.conf.json`
- `apps/tauri/onboarding/index.html`
- `apps/tauri/src/tray/icon.rs`
- `apps/tauri/src/tray/menu.rs`
- `apps/tauri/windows/app.manifest`
- `apps/tauri/icons/*`

### Rust CLI / i18n

- `src/main.rs`
- `crates/zeroclaw-runtime/src/i18n.rs`
- `crates/zeroclaw-runtime/locales/zh-CN/cli.ftl`
- `crates/zeroclaw-runtime/locales/en/cli.ftl`

### 渠道配置体验

- `crates/zeroclaw-config/src/sections.rs`
- `crates/zeroclaw-gateway/src/api_onboard.rs`
- `crates/zeroclaw-channels/src/qq.rs`
- `crates/zeroclaw-channels/src/wechat.rs`
- `crates/zeroclaw-channels/src/wecom.rs`

## 9. 风险

### 低风险

- 用户可见品牌文案替换
- Web 品牌图片替换
- 用户界面外链关闭

### 中风险

- Web 中文化覆盖面较大，易出现漏翻或同页术语不一致
- Web 语言状态与后端 locale 对齐时，可能需要兼顾首次启动与旧本地缓存
- Tauri 欢迎页是独立 HTML，文案维护方式与 React 页面不同

### 高风险

- `QQ` / `微信` / `企业微信` 专用向导涉及 `config + gateway + web + channels` 多层联动
- 微信二维码扫描创建流程涉及状态流转、错误态、安全控制与绑定逻辑

## 10. 验收原则

- 每一阶段都必须可单独验收、单独回滚
- 先完成用户可见层的统一，再做视觉资源替换
- 后续实现 `QQ` / `微信` / `企业微信` 专用向导时，必须继续复用现有配置事实源
- 任何阶段都不得通过增加重复状态字段来“临时实现”

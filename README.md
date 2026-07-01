# OpenClaw Manager

基于 **Electron + Vue 3 + Pinia + TypeScript** 的桌面应用,用于在本地统一管理多个 [OpenClaw](https://www.npmjs.com/package/openclaw)(一个发布到 npm 的 CLI)实例。

应用支持 OpenClaw 多版本并行管理、实例生命周期控制(启动 / 停止 / 重启 / 实时日志)、Web UI 一键打开,以及 `openclaw.json` 配置块的查看、编辑、跨实例同步、命名模板与备份。

## 截图

> 截图由 `e2e/screenshots.spec.ts` 通过 Playwright + Electron 启动已构建的应用自动生成,可通过 `npm run test:e2e e2e/screenshots.spec.ts` 重新生成。

| 仪表盘 | 版本管理 |
| :---: | :---: |
| ![仪表盘](docs/screenshots/01-dashboard.png) | ![版本管理](docs/screenshots/02-versions.png) |

| 配置管理 | 新建实例 |
| :---: | :---: |
| ![配置管理](docs/screenshots/03-config.png) | ![新建实例](docs/screenshots/04-create-modal.png) |

## 功能特性

- **多版本管理**:从 npm registry(`https://registry.npmjs.org/openclaw`)拉取可用版本,可一键安装 / 卸载,已安装列表与可用版本合并展示。
- **实例生命周期**:创建实例并绑定已安装的 OpenClaw 版本,启动 / 停止 / 重启 / 删除全部走 IPC,主进程负责子进程监管。
- **实时日志**:每个实例的子进程 stdout / stderr 流式缓冲(最多 200 行),通过 `EventEmitter` 转发到渲染层,详情页以 `LogViewer` 实时滚动展示。
- **健康检查**:启动后通过 WebSocket(`GatewayClient`)与 OpenClaw gateway 通信,暴露 `version` / `uptime` 等健康信息。
- **Web UI 打开**:`openWebUI(port)` 在系统默认浏览器中打开 `http://127.0.0.1:<port>`。
- **配置块管理**(`配置管理`):在每个实例的 `openclaw.json` 中查看 / 编辑 / 新建顶层配置块,支持跨实例同步、命名模板、备份与还原。
- **系统托盘**:Windows / Linux 下关闭窗口隐藏到托盘,托盘菜单可显示当前实例并快速定位。

## 技术栈

| 层 | 技术 |
|---|---|
| 渲染层 | Vue 3(Composition API + `<script setup>`)+ Pinia + Vite |
| 主进程 | Electron 43 + Node.js |
| 桥接 | `contextBridge` + `ipcRenderer` / `ipcMain`(类型化 `window.api`) |
| 持久化 | `electron/store.ts` 写入 `app.getPath("userData")/manager-config.json` |
| 测试 | Playwright(`@playwright/test`,E2E 驱动已构建的 Electron) |
| 打包 | `electron-builder`(NSIS,Windows) |

## 目录结构

```
.
├── electron/                 # 主进程
│   ├── main.ts               # 入口:创建窗口、托盘、注册 IPC
│   ├── preload.ts            # contextBridge 暴露 window.api
│   ├── ipc-handlers.ts       # IPC 唯一注册入口 + 事件转发
│   ├── instance-manager.ts   # 子进程生命周期、EventEmitter、GatewayClient
│   ├── version-manager.ts    # npm registry 拉取、npm install
│   ├── gateway-client.ts     # 与 OpenClaw gateway 的 WebSocket 客户端
│   ├── store.ts              # JSON 文件持久化
│   ├── tray.ts               # 系统托盘
│   └── app-state.ts          # 跨模块状态(是否退出等)
├── src/                      # 渲染层
│   ├── main.ts               # createApp + Pinia
│   ├── App.vue               # 顶层 tab 容器
│   ├── views/                # Dashboard / InstanceDetail / VersionManager / ConfigManager
│   ├── components/           # InstanceCard / LogViewer / ConfigBlockList 等
│   ├── stores/               # Pinia stores(instances / versions / config)
│   └── env.d.ts              # window.api 的类型声明
├── e2e/                      # Playwright E2E 测试
│   ├── app.spec.ts           # 冒烟用例,自包含
│   ├── instance.spec.ts      # 端到端生命周期用例(需要真实 OpenClaw)
│   └── screenshots.spec.ts   # 截图生成(供 README 使用)
├── resources/node/           # 打包时随附的 Node.js(生产用)
├── scripts/                  # 一次性脚本(ensure-version 等)
├── docs/screenshots/         # README 截图
├── electron-builder.yml      # NSIS 打包配置
├── vite.config.ts            # Vite + vite-plugin-electron 配置
├── tsconfig.json             # 覆盖 src/** 和 electron/**
├── playwright.config.ts      # workers: 1, retries: 0, timeout: 60s
└── package.json
```

## 快速开始

### 环境要求

- Node.js(开发机可放在 `PATH`;生产构建可使用随项目附带的 `resources/node/`)
- Windows / macOS / Linux(本仓库 `electron-builder.yml` 仅声明 Windows 目标)
- npm

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

`vite-plugin-electron` 会同时编译主进程与 preload 并启动 Electron,渲染层通过 Vite HMR 实时刷新;preload 在每次启动时调用 `args.reload()`。

### 类型检查

```bash
npm run typecheck
```

执行 `vue-tsc --noEmit`,覆盖 `src/**` 与 `electron/**`。

### 构建

```bash
npm run build
```

产出 `dist/`(渲染层)与 `dist-electron/main.js` / `dist-electron/preload.js`。`package.json#main` 指向 `dist-electron/main.js`。

## E2E 测试

> **先构建再跑 E2E**。Playwright 通过 `_electron.launch({ args: ['dist-electron/main.js'] })` 启动的是**已构建**的 Electron,没有 `dist-electron/main.js` 会直接失败。

### 冒烟用例(自包含)

```bash
npm run build
npm run test:e2e e2e/app.spec.ts
```

无需网络或文件系统前置状态。

### 端到端生命周期用例

需要真实可启动的 OpenClaw 进程,完整流程:

```bash
npm run build
node scripts/ensure-version.cjs   # 按需安装 openclaw@2026.6.11
npm run test:e2e e2e/instance.spec.ts
```

`scripts/ensure-version.cjs` 会检查 `~/.openclaw-manager/versions/v2026.6.11/node_modules/openclaw/openclaw.mjs` 是否存在,缺失则执行 `npm install openclaw@2026.6.11 --no-save --prefix <dir>`。该用例会创建名为 `e2e-test-611` 的实例并轮询最多 40 秒等待 `running` / `error` / `crashed`。

### 重新生成 README 截图

```bash
npm run build
npm run test:e2e e2e/screenshots.spec.ts
```

输出到 `docs/screenshots/01-dashboard.png` ... `04-create-modal.png`。

### 带窗口调试

```bash
npm run test:e2e:headed
```

## 运行时数据布局

| 用途 | 路径 |
|---|---|
| 配置(实例列表、版本列表、`nextPort`) | `app.getPath("userData")/manager-config.json` |
| 实例状态目录(`openclaw.json` 等) | `~/.openclaw-manager/instances/<name>/` |
| 已安装的 OpenClaw 版本 | `~/.openclaw-manager/versions/<version>/` |
| 打包时附带的 Node.js + npm(随包带 `node.exe`/`node`、`npm.cmd`/`npm`、`npx.cmd`/`npx` 等) | `resources/node/`(通过 `electron-builder.yml#extraResources` 包含) |

Node 二进制解析顺序(`version-manager.resolveNodeBinary`,返回第一个能 `node --version` 输出 `v...` 的候选):

1. `PATH` 上的 `node` / `node.exe`
2. 常见安装路径(`C:\Program Files\nodejs\node.exe`、`%LOCALAPPDATA%\Programs\nodejs\node.exe`、`mise` shims、`/usr/local/bin/node`、`/usr/bin/node` 等)
3. 打包目录:`process.resourcesPath/resources/node/node.exe`(生产)或 `resources/node/node.exe`(开发模式)
4. 全部失败 → `throw new Error("No working node binary found ...")`

npm 二进制解析(`version-manager.resolveNpmBinary`):从 `resolveNodeBinary()` 返回的 `node` 所在目录派生 `npm.cmd`(Windows) / `npm`(Unix/macOS)。bundled npm 通过 PATH 前置自动使用 bundled node。`installVersion()` 用 `execFile` 调用 resolved 路径,Windows 上设 `shell: true` 以支持 `.cmd` 文件 spawn。这样打包环境(包括用户没装 Node.js 的生产机)也能 `versions:install` 成功。

## 架构要点

- **渲染层与主进程通信只能通过 `window.api`**(preload 桥)。新增 IPC:在 `electron/ipc-handlers.ts` 加 `ipcMain.handle`,在 `electron/preload.ts` 加类型化包装,在 `src/env.d.ts` 加类型。
- **事件流**:`instance-manager` 通过 `EventEmitter`(`onStatus` / `onLog`)暴露状态变化,主进程在 `setupEventForwarders` 中订阅一次,再通过 `webContents.send` 推给渲染层。渲染层用 `const off = window.api.instances.onStatusChanged(...)` 订阅,`onUnmounted` 中调用 `off()`。
- **渲染层安全**:`nodeIntegration: false`、`contextIsolation: true`,但 `sandbox: false` —— preload 需要 `require`。
- **路径别名**:`@/*` → `src/*`,在 Vite(`vite.config.ts#resolve.alias`)和 TS(`tsconfig.json#paths`)中都生效。渲染层导入请使用 `@/...`。
- **版本号格式**:store 中带前导 `v`(如 `v2026.6.11`),`version-manager` 在调用 `npm install` 前会去掉 `v`。
- **UI 文案**:全部为 zh-CN 硬编码,`index.html` / `App.vue` 设置 `lang="zh-CN"`,没有 i18n 层。
- **无 lint / 无格式化 / 无单元测试**:沿用文件已有风格 —— 4 空格缩进,TS 用单引号,`vite.config.ts` 用双引号,`noEmit` 友好的 type-only import。

## 打包

```bash
npm run build
npx electron-builder --win
```

产物为 NSIS 安装包,输出到 `release/`(`OpenClaw Manager-Setup-0.1.0.exe`)。`extraResources` 会把 `resources/node/` 完整打包进安装目录,生产模式下由 `version-manager.resolveNodeBinary` 解析使用。

## 常用命令速查

| 命令 | 作用 |
|---|---|
| `npm run dev` | Vite + Electron 开发模式(主进程 HMR) |
| `npm run build` | 构建渲染层与主进程(`dist/` + `dist-electron/`) |
| `npm run typecheck` | `vue-tsc --noEmit` 覆盖 `src/**` 与 `electron/**` |
| `npm run test:e2e` | Playwright E2E(headless) |
| `npm run test:e2e:headed` | Playwright E2E(可见窗口) |
| `node scripts/ensure-version.cjs` | 按需安装 `openclaw@2026.6.11` 至 `~/.openclaw-manager/versions/` |

## 许可证

本仓库未声明开源许可证,使用前请与作者确认。

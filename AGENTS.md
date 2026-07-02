# OpenClaw Manager

基于 Electron + Vue 3 + Pinia + TypeScript 的桌面应用,用于管理多个 OpenClaw
(一个发布到 `npm` 的 CLI,包名 `openclaw`)实例。

## 架构

三层结构,均为 TypeScript:

- `src/` — Vue 3 渲染层(Composition API,`<script setup>`)。入口:`src/main.ts`。
  - `src/views/` 顶层页面,由 `src/App.vue` 装配(tab 切换:`dashboard` / `detail` / `versions`)。
  - `src/stores/` Pinia 状态(`instances`、`versions`);所有渲染层状态都通过 `window.api.*` 获取。
  - `src/env.d.ts` `window.api` 桥的类型声明。
- `electron/main.ts` — Electron 主进程,创建 `BrowserWindow` 并注册 IPC。
- `electron/preload.ts` — 通过 `contextBridge` 暴露 `window.api`(versions、instances、debug)。由 `webPreferences.preload` 加载。
- `electron/ipc-handlers.ts` — IPC 唯一注册入口。`setupEventForwarders` 将 `instance-manager` 的 `EventEmitter` 事件通过 `webContents.send` 转发给渲染层。
- `electron/instance-manager.ts` — 子进程生命周期、重启循环、日志缓冲、WebSocket `GatewayClient`。
- `electron/version-manager.ts` — 从 `https://registry.npmjs.org/openclaw` 拉取版本列表(内存缓存 5 分钟),并执行 `npm install openclaw@<ver> --no-save --prefix <versionDir>`。
- `electron/store.ts` — JSON 文件持久化,路径为 `app.getPath("userData")/manager-config.json`。

构建产物:`dist/`(渲染层)与 `dist-electron/`(`main.js`、`preload.js`)。`package.json#main` 指向 `dist-electron/main.js`。

## 命令

**没有 lint 或单元测试脚本**,只有:

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动 Vite 开发服务器。`vite-plugin-electron` 同时编译并以 HMR 方式启动 Electron 主进程。渲染层通过 Vite 热重载;preload 在启动时调用 `args.reload()`(见 `vite.config.ts`)。 |
| `npm run build` | `vite build`,产出 `dist/` 和 `dist-electron/`。**`npm run test:e2e` 之前必须先执行。** |
| `npm run typecheck` | `vue-tsc --noEmit`,覆盖 `src/**` 和 `electron/**`(见 `tsconfig.json#include`)。 |
| `npm run test:e2e` | `playwright test`,通过 `_electron.launch({ args: ['dist-electron/main.js'] })` 启动**已构建的** Electron 应用。 |
| `npm run test:e2e:headed` | 同上,但带可见窗口,便于调试。 |
| `npm run setup:node` | 下载并解压 Node.js 便携版到 `./resources/node/`(默认拉取 `scripts/fetch-node.cjs#DEFAULT_VERSION` 硬编码的最新 LTS)。开发者首次克隆或上游 Node LTS 更新后运行。`resources/node/` 与 `resources/node/.tmp/` 已在 `.gitignore` 中。 |
| `npm run build:installer` | 顺序:`setup:node` → `build` → `electron-builder`,产出 `release/` 下的 NSIS 安装包。 |

`tsconfig.node.json` 是 project reference,只对 `vite.config.ts` 做类型检查。

## 测试相关注意事项

- `e2e/app.spec.ts` 自包含,不需要网络或文件系统状态,作为默认安全用例。
- `e2e/instance.spec.ts` 是端到端生命周期测试,流程:
  1. 若尚未安装任何版本,调用 `window.api.versions.install("v2026.6.11")`。
  2. 创建一个名为 `e2e-test-611` 的实例并启动。
  3. 每 2 秒轮询一次,最多 **40 秒**(20 轮),等待 `running` / `error` / `crashed`。
  4. 依赖 `PATH` 上可用的 `node`(或打包的 `resources/node/`),OpenClaw 才能启动。
  5. 不会清理 `~/.openclaw-manager/instances/e2e-test-611` 目录 —— `test.beforeAll` 只在该目录已存在时移除。
- `e2e/gateway-reconnect.spec.ts` 验证 WebSocket 断线后的自动重连与手动按钮,使用 `instances:debug-disconnect-gateway` IPC 模拟 WS 掉线(进程仍存活)。
- Playwright 配置:`workers: 1`、`retries: 0`、`headless: true`,每个用例 60 秒。不起本地 HTTP 服务,直接由 Playwright 驱动 Electron。
- `electron/ipc-handlers.ts` 暴露了 `debug:spawn` 处理器(PowerShell 优先 / `execFile` 双模式),供 `instance.spec.ts` 探测环境。若要移除,需同步重写该 spec。

## 一次干净的 E2E 运行顺序

1. `npm run build`(否则 `dist-electron/main.js` 不存在,`_electron.launch` 会失败)。
2. 仅对生命周期用例:运行一次 `npm run setup:node` 确保 `resources/node/` 已填充(开发者已 clone 后仅需执行一次)。
3. 仅对生命周期用例:确保 `~/.openclaw-manager/versions/v2026.6.11/node_modules/openclaw/openclaw.mjs` 存在。`node scripts/ensure-version.cjs` 会按需安装(执行 `npm install openclaw@2026.6.11 --no-save --prefix <dir>`)。
4. `npm run test:e2e`(或 `:headed`)。

## 运行时数据布局

- 配置:`app.getPath("userData")/manager-config.json`(实例列表、版本列表、`nextPort`,从 `18789` 开始)。
- 实例状态目录:`~/.openclaw-manager/instances/<name>/`,内含 `openclaw.json`(由 `instance-manager.initStateDir` 写入的 gateway/auth 配置)。
- 已安装的 OpenClaw 版本:`~/.openclaw-manager/versions/<version>/`(每个目录都是独立的 `npm install` 树)。
- 打包的 Node.js(仅生产):`resources/node/`,由 `npm run setup:node` 填充;`.gitignore` 已排除,勿手动提交。通过 `electron-builder.yml#extraResources` 包含;运行期由 `version-manager.resolveNodeBinary` 解析(优先 `PATH` → 常见安装路径 → 打包目录,全部失败则 `throw`)。npm 同理,从 resolved `node` 所在目录派生 `npm.cmd` / `npm`(`resolveNpmBinary`),`installVersion` 用 `execFile` 调用 resolved 路径(Windows 加 `shell: true`),并把 bundled 目录 prepend 到 env.PATH 以让 OpenClaw 的 postinstall shebang 找到 bundled node。

## 需要知道的约定

- 路径别名 `@/*` → `src/*`,在 Vite(`vite.config.ts#resolve.alias`)和 TS(`tsconfig.json#paths`)中都生效。渲染层导入请使用它。
- 渲染层所有 UI 文案是 **zh-CN** 硬编码字面量,没有 i18n 层。`index.html` 和 `App.vue` 设置 `lang="zh-CN"`。
- 渲染层是沙箱化的:`nodeIntegration: false`、`contextIsolation: true`,但 `sandbox: false`(preload 需要 `require`)。
- 渲染层与主进程的通信**只能**通过 `window.api`(preload 桥)。新增 IPC:在 `ipc-handlers.ts` 加 `ipcMain.handle`,在 `preload.ts` 加类型化包装,在 `src/env.d.ts` 加类型。
- `instance-manager.ts` 使用 `EventEmitter`(`onStatus`、`onLog`);主进程在 `setupEventForwarders` 中订阅一次,再推送给渲染层。渲染层用法:`const off = window.api.instances.onStatusChanged(...)`,在 `onUnmounted` 中调用 `off()`。
- 版本在 store 中带前导 `v`(如 `v2026.6.11`);`version-manager` 在调用 `npm install` 前会去掉 `v`。
- 没有配置格式化或 lint 工具 —— 沿用文件已有风格(4 空格缩进,TS 用单引号,`vite.config.ts` 用双引号,使用 `noEmit` 友好的 type-only import)。

## OpenClaw Gateway 协议要点(`https://docs.openclaw.ai/gateway/protocol`)

- **握手必须**先收 `connect.challenge` event,再发 `connect` 请求;pre-connect 帧上限 64 KiB。
- `connect.params.client.id` 取值受白名单约束(**不允许** `"openclaw-manager"` 等自定义值),允许集至少包括 `cli` / `gateway-client` / `ios-node` 等。`gateway-client` 是 backend RPC 保留 ID。
- `connect.params.client.mode` 取值:
  - `ui` / `operator` / `node` 等:会触发**设备配对流程**(`device.pair.requested` 等),非 loopback 需人工审批;loopback 自动批准。
  - `backend` + `client.id: "gateway-client"` + 直连 loopback 是**保留内部 helper 路径**,可省略 `device` 块、不被配对,scope 也能保留。
  - 我们 manager 用 `client.id: "gateway-client"` + `client.mode: "backend"` + `scopes: ["operator.admin"]`,走 backend helper 路径,保留设备签名为后续升级铺路(`electron/device-identity.ts`)。
- `connect.params` 常用字段:`minProtocol`/`maxProtocol`(当前必须 v4)、`role`、`scopes`、`caps`、`auth: { token }`、可选 `device`、`locale`、`userAgent`。
- **服务端在 `hello-ok` 里通告**:`policy.tickIntervalMs`、`policy.maxPayload`、`policy.maxBufferedBytes`、`auth.role`/`auth.scopes`(可能含 `deviceToken`)。客户端必须采用 `tickIntervalMs` 覆盖默认心跳周期;超时阈值 = `tickIntervalMs × 2`,close code = `4000`。
- `4000` 是 tick 超时(瞬时),**不应**判 fatal;其他 `4xxx` 才是协议级拒绝(不重连)。
- 设备签名 payload 格式 v2:`"v2|<deviceId>|<clientId>|<clientMode>|<role>|<scopes>|<signedAtMs>|<token>|<nonce>"`,`nonce` 必须等于 `connect.challenge.payload.nonce`。详细见 `electron/device-identity.ts#buildDeviceAuthPayload`。
- 同步触发的事件类型:`connect.challenge`、`tick`、`heartbeat`、`payload.large`(超限警告)、`shutdown`、`presence` 等;`tick` 与 `pong` 都视作 liveness 信号,任一收到即重置 `lastLivenessAt`。
- 错误细节:握手失败可在 `error.details.code` / `error.details.recommendedNextStep` 拿到恢复建议(如 `retry_with_device_token` / `wait_then_retry`)。

## 改动某功能时优先阅读的文件

- 渲染层功能:`src/views/<View>.vue` → `src/stores/<store>.ts` → `src/env.d.ts` → `electron/preload.ts` → `electron/ipc-handlers.ts` → 对应的主进程模块。
- 打包相关:`electron-builder.yml`(NSIS,本仓库仅 Windows 目标,产物输出到 `release/`)。

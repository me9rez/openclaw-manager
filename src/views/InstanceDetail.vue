<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import VsToast from "@vuesimple/vs-toast";
import { useInstancesStore } from "../stores/instances";
import LogViewer from "../components/LogViewer.vue";
import {
  ArrowLeft,
  Terminal,
  ExternalLink,
  Play,
  Square,
  RotateCw,
  Unlink,
  Link,
  Trash2,
  Loader2,
  FolderOpen,
  Code2,
  Pencil,
  Check,
  X as XIcon,
} from "@lucide/vue";

const props = defineProps<{
  name: string;
}>();

const emit = defineEmits<{
  back: [];
}>();

const store = useInstancesStore();

const instance = computed(() => store.instances.find((i) => i.name === props.name));

const loadingMap = ref<Record<string, boolean>>({});

async function withLoading(key: string, fn: () => Promise<void>) {
  if (loadingMap.value[key]) return;
  loadingMap.value[key] = true;
  try {
    await fn();
  } finally {
    loadingMap.value[key] = false;
  }
}

let cleanupStatus: (() => void) | null = null;

onMounted(async () => {
  await store.fetchList();
  cleanupStatus = window.api.instances.onStatusChanged(() => {
    store.fetchList();
  });
});

onUnmounted(() => {
  cleanupStatus?.();
  if (portCheckTimer) clearTimeout(portCheckTimer);
});

function openWebUI(port: number, token: string) {
  window.api.instances.openWebUI(port, token);
}

async function openTerminal() {
  if (!instance.value) return;
  try {
    await window.api.instances.openTerminal(instance.value.name);
  } catch (err) {
    console.error("[open-terminal] failed:", err);
  }
}

async function openFolder() {
  if (!instance.value) return;
  try {
    await window.api.instances.openFolder(instance.value.name);
  } catch (err) {
    console.error("[open-folder] failed:", err);
  }
}

async function openInVSCode() {
  if (!instance.value) return;
  try {
    const res = await window.api.instances.openInVSCode(instance.value.name);
    if (!res.ok) showToast(res.error ?? "打开失败", "err");
  } catch (err) {
    showToast((err as Error)?.message ?? "打开失败", "err");
  }
}

function showToast(msg: string, kind: "ok" | "err" | "info" = "err") {
  const variant = kind === "ok" ? "success" : kind === "err" ? "error" : "info";
  VsToast.show({ message: msg, variant });
}

function statusColor(status: string): string {
  switch (status) {
    case "running": return "var(--ok)";
    case "stopped": return "var(--muted)";
    case "error": return "var(--danger)";
    case "crashed": return "var(--danger)";
    case "starting":
    case "stopping":
    case "reconnecting": return "var(--warn)";
    default: return "var(--muted)";
  }
}

const statusLabel: Record<string, string> = {
  installed: "已安装",
  starting: "启动中...",
  running: "运行中",
  stopping: "停止中...",
  stopped: "已停止",
  reconnecting: "重新连接中",
  error: "错误",
  crashed: "崩溃",
};

// ----- Port edit -----
// Only stopped-ish states are editable; running/starting/reconnecting would
// leave the in-memory gateway client pointing at the old port.
const PORT_EDITABLE_STATES = new Set(["installed", "stopped", "error", "crashed"]);
const isPortEditable = computed(
  () => !!instance.value && PORT_EDITABLE_STATES.has(instance.value.status),
);

const portEditing = ref(false);
const portDraft = ref<string>("");
const portCheck = ref<"idle" | "checking" | "available" | "in-use" | "invalid">("idle");
const portCheckDetail = ref<string>("");
const portSaving = ref(false);
let portCheckSeq = 0;
let portCheckTimer: ReturnType<typeof setTimeout> | null = null;

// ----- Config consistency check -----
const consistency = ref<ConfigConsistencyResult | null>(null);
const consistencyLoading = ref(false);
let consistencySeq = 0;

async function runConsistencyCheck() {
  if (!instance.value) return;
  const seq = ++consistencySeq;
  consistencyLoading.value = true;
  try {
    const result = await store.checkConfigConsistency(instance.value.name);
    if (seq !== consistencySeq) return; // outdated
    consistency.value = result;
  } catch (err) {
    if (seq !== consistencySeq) return;
    showToast((err as Error).message || "检查失败", "err");
  } finally {
    if (seq === consistencySeq) consistencyLoading.value = false;
  }
}

function startPortEdit() {
  if (!isPortEditable.value || !instance.value) return;
  portDraft.value = String(instance.value.port);
  portEditing.value = true;
  portCheck.value = "idle";
  portCheckDetail.value = "";
  runPortCheck();
}

function cancelPortEdit() {
  portEditing.value = false;
  portDraft.value = "";
  portCheck.value = "idle";
  portCheckDetail.value = "";
  if (portCheckTimer) {
    clearTimeout(portCheckTimer);
    portCheckTimer = null;
  }
}

function runPortCheck() {
  if (portCheckTimer) clearTimeout(portCheckTimer);
  const port = Number.parseInt(portDraft.value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    portCheck.value = "invalid";
    portCheckDetail.value = "端口必须是 1-65535 之间的整数";
    return;
  }
  portCheck.value = "checking";
  portCheckDetail.value = "检测中...";
  const seq = ++portCheckSeq;
  portCheckTimer = setTimeout(async () => {
    try {
      const res = await window.api.instances.checkPort(port);
      if (seq !== portCheckSeq) return; // outdated by a newer check
      portCheck.value = res.available ? "available" : "in-use";
      portCheckDetail.value = res.available
        ? `端口 ${res.port} 可用`
        : `端口 ${res.port} 当前被其他进程占用`;
    } catch (err) {
      if (seq !== portCheckSeq) return;
      portCheck.value = "invalid";
      portCheckDetail.value = `检测失败: ${(err as Error).message}`;
    }
  }, 300);
}

// Re-check whenever the draft text changes.
watch(portDraft, () => {
  if (portEditing.value) runPortCheck();
});

async function savePort() {
  if (!instance.value) return;
  const port = Number.parseInt(portDraft.value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    showToast("端口必须是 1-65535 之间的整数", "err");
    return;
  }
  if (portCheck.value === "in-use") {
    showToast(`端口 ${port} 已被占用,请换一个`, "err");
    return;
  }
  portSaving.value = true;
  try {
    await store.updatePort(instance.value.name, port);
    showToast(`端口已更新为 ${port}`, "ok");
    portEditing.value = false;
    // 端口变了之后,旧的检测结果已经过期,自动重跑一次
    consistency.value = null;
    runConsistencyCheck();
  } catch (err) {
    showToast((err as Error).message || "修改端口失败", "err");
  } finally {
    portSaving.value = false;
  }
}
</script>

<template>
  <div v-if="instance" class="detail">
    <div class="detail-header">
      <button class="btn-back" @click="emit('back')">
        <ArrowLeft :size="16" />
        返回
      </button>
      <div class="detail-title">
        <h1>{{ instance.name }}</h1>
        <span :class="['badge']" :style="{ background: statusColor(instance.status) }">
          {{ statusLabel[instance.status] || instance.status }}
        </span>
      </div>
    </div>

    <div class="detail-grid">
      <div class="info-panel">
        <h3>实例信息</h3>
        <div class="info-section">
          <div class="info-row">
            <span class="label">版本</span>
            <span class="value">{{ instance.version }}</span>
          </div>
          <div class="info-row info-row-port">
            <span class="label">端口</span>
            <div v-if="!portEditing" class="port-display">
              <span class="value">{{ instance.port }}</span>
              <button
                v-if="isPortEditable"
                class="icon-btn"
                title="修改端口"
                @click="startPortEdit"
              >
                <Pencil :size="12" />
              </button>
              <span v-else class="locked-hint" title="运行中无法修改端口,请先停止实例">运行中不可改</span>
            </div>
            <div v-else class="port-edit">
              <input
                v-model="portDraft"
                type="number"
                min="1"
                max="65535"
                class="input port-input"
                :disabled="portSaving"
                @keyup.enter="savePort"
                @keyup.escape="cancelPortEdit"
              />
              <span
                class="port-status-dot"
                :class="`port-status-${portCheck}`"
                :title="portCheckDetail"
              ></span>
              <button
                class="icon-btn icon-btn-primary"
                :disabled="portSaving || portCheck === 'invalid' || portCheck === 'in-use' || portCheck === 'checking'"
                title="保存"
                @click="savePort"
              >
                <Loader2 v-if="portSaving" :size="12" class="spin" />
                <Check v-else :size="12" />
              </button>
              <button
                class="icon-btn"
                :disabled="portSaving"
                title="取消"
                @click="cancelPortEdit"
              >
                <XIcon :size="12" />
              </button>
            </div>
          </div>
          <p v-if="portEditing" class="port-detail">{{ portCheckDetail }}</p>
          <div class="info-row">
            <span class="label">Token</span>
            <span class="value mono">{{ instance.token.substring(0, 12) }}...</span>
          </div>
          <div class="info-row">
            <span class="label">配置一致性</span>
            <button
              class="check-btn"
              :disabled="consistencyLoading"
              @click="runConsistencyCheck"
            >
              <Loader2 v-if="consistencyLoading" :size="12" class="spin" />
              <span v-else>检查</span>
            </button>
          </div>
          <div v-if="consistency" class="consistency-card" :class="consistency.consistent ? 'is-ok' : 'is-bad'">
            <div class="consistency-head">
              <span>{{ consistency.consistent ? '✅ 一致' : '⚠️ 不一致' }}</span>
              <button class="consistency-close" @click="consistency = null">×</button>
            </div>
            <div class="consistency-body">
              <div><span class="k">store:</span> <code>{{ consistency.storePort ?? '—' }}</code></div>
              <div><span class="k">config:</span> <code>{{ consistency.configPort ?? '—' }}</code></div>
              <div class="consistency-path">{{ consistency.configPath }}</div>
              <ul v-if="consistency.issues.length" class="consistency-issues">
                <li v-for="(it, i) in consistency.issues" :key="i">{{ it.message }}</li>
              </ul>
            </div>
          </div>
          <div v-if="instance.health?.version" class="info-row">
            <span class="label">Gateway 版本</span>
            <span class="value">{{ instance.health.version }}</span>
          </div>
          <div v-if="instance.startedAt" class="info-row">
            <span class="label">启动时间</span>
            <span class="value">{{ new Date(instance.startedAt).toLocaleString("zh-CN") }}</span>
          </div>
          <div v-if="instance.statusMessage" class="status-msg-box">
            <span class="label">消息</span>
            <span class="error-text">{{ instance.statusMessage }}</span>
          </div>
        </div>

        <div class="actions-section">
          <div class="action-row is-wrap">
            <button
              class="btn btn-secondary"
              :disabled="loadingMap['terminal']"
              @click="withLoading('terminal', openTerminal)"
            >
              <Loader2 v-if="loadingMap['terminal']" class="spin" />
              <Terminal v-else :size="14" />
              打开终端
            </button>
            <button
              class="btn btn-secondary"
              :disabled="loadingMap['folder']"
              @click="withLoading('folder', openFolder)"
            >
              <Loader2 v-if="loadingMap['folder']" class="spin" />
              <FolderOpen v-else :size="14" />
              打开文件夹
            </button>
            <button
              class="btn btn-secondary"
              :disabled="loadingMap['vscode']"
              @click="withLoading('vscode', openInVSCode)"
            >
              <Loader2 v-if="loadingMap['vscode']" class="spin" />
              <Code2 v-else :size="14" />
              用 VS Code 打开
            </button>
          </div>

          <div class="action-row">
            <button
              v-if="instance.status === 'running' || instance.status === 'reconnecting'"
              class="btn btn-primary"
              :disabled="loadingMap['webui']"
              @click="openWebUI(instance.port, instance.token)"
            >
              <Loader2 v-if="loadingMap['webui']" class="spin" />
              <ExternalLink v-else :size="14" />
              打开 WebUI
            </button>
          </div>

          <div class="action-row">
            <button
              v-if="instance.status === 'stopped' || instance.status === 'crashed' || instance.status === 'error'"
              class="btn btn-primary"
              :disabled="loadingMap['start']"
              @click="withLoading('start', () => store.start(instance!.name))"
            >
              <Loader2 v-if="loadingMap['start']" class="spin" />
              <Play v-else :size="14" />
              启动
            </button>
            <button
              v-if="instance.status === 'running' || instance.status === 'reconnecting'"
              class="btn btn-secondary"
              :disabled="loadingMap['stop']"
              @click="withLoading('stop', () => store.stop(instance!.name))"
            >
              <Loader2 v-if="loadingMap['stop']" class="spin" />
              <Square v-else :size="14" />
              停止
            </button>
            <button
              v-if="instance.status === 'running' || instance.status === 'reconnecting'"
              class="btn btn-secondary"
              :disabled="loadingMap['restart']"
              @click="withLoading('restart', () => store.restart(instance!.name))"
            >
              <Loader2 v-if="loadingMap['restart']" class="spin" />
              <RotateCw v-else :size="14" />
              重启
            </button>
          </div>

          <div class="action-row">
            <button
              v-if="instance.status === 'reconnecting'"
              class="btn btn-secondary"
              :disabled="loadingMap['stopReconnect']"
              @click="withLoading('stopReconnect', () => store.stopReconnect(instance!.name))"
            >
              <Loader2 v-if="loadingMap['stopReconnect']" class="spin" />
              <Unlink v-else :size="14" />
              停止重连
            </button>
            <button
              v-if="instance.status === 'crashed' || instance.status === 'error'"
              class="btn btn-success"
              :disabled="loadingMap['reconnect']"
              @click="withLoading('reconnect', () => store.forceReconnect(instance!.name))"
            >
              <Loader2 v-if="loadingMap['reconnect']" class="spin" />
              <Link v-else :size="14" />
              重新连接
            </button>
          </div>

          <div class="action-row action-row-danger">
            <button
              class="btn btn-danger"
              :disabled="loadingMap['remove']"
              @click="withLoading('remove', async () => {
                const isRunning = instance!.status === 'running' || instance!.status === 'starting' || instance!.status === 'reconnecting';
                const ok = await store.confirmRemove(instance!.name, isRunning);
                if (!ok) return;
                await store.remove(instance!.name);
                emit('back');
              })"
            >
              <Loader2 v-if="loadingMap['remove']" class="spin" />
              <Trash2 v-else :size="14" />
              删除实例
            </button>
          </div>
        </div>
      </div>

      <div class="log-panel">
        <LogViewer :instanceName="instance.name" />
      </div>
    </div>
  </div>
  <div v-else class="not-found">
    <p>未找到实例 "{{ props.name }}"</p>
    <button class="btn-back" @click="emit('back')">
      <ArrowLeft :size="16" />
      返回仪表盘
    </button>
  </div>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-width: 1200px;
  margin: 0 auto;
  animation: fade-in 0.25s ease-out;
}
@keyframes fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.detail-header {
  margin-bottom: 24px;
}
.btn-back {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 14px;
  padding: 0;
  margin-bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.btn-back:hover {
  text-decoration: underline;
}
.detail-title {
  display: flex;
  align-items: center;
  gap: 12px;
}
.detail-title h1 {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-strong);
}
.badge {
  padding: 3px 10px;
  border-radius: var(--radius-full);
  font-size: 11px;
  font-weight: 600;
  color: #fff;
}
.detail-grid {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 20px;
  flex: 1;
  min-height: 0;
}
.info-panel {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px;
}
.info-panel h3 {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  margin-bottom: 16px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.info-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
}
.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}
.label {
  color: var(--muted);
}
.value {
  color: var(--text-strong);
  font-weight: 500;
}
.mono {
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
}
.error-text {
  color: var(--accent);
}

/* Inline port editor */
.info-row-port .value {
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
}
.port-display {
  display: flex;
  align-items: center;
  gap: 8px;
}
.port-edit {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  justify-content: flex-end;
}
.port-input {
  width: 100px;
  padding: 4px 8px;
  font-size: 13px;
  text-align: right;
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
}
/* Hide native spinners */
.port-input::-webkit-outer-spin-button,
.port-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.port-input[type="number"] {
  -moz-appearance: textfield;
}
.port-detail {
  font-size: 11px;
  color: var(--muted);
  text-align: right;
  margin-top: -4px;
  margin-bottom: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.port-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--muted);
  transition: background 0.15s;
}
.port-status-checking { background: var(--muted); animation: port-pulse 1s ease-in-out infinite; }
.port-status-available { background: var(--ok); }
.port-status-in-use    { background: var(--danger); }
.port-status-invalid   { background: var(--warn); }
.port-status-idle      { background: var(--muted); }
@keyframes port-pulse {
  0%, 100% { opacity: 0.4; }
  50%      { opacity: 1; }
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: all 0.15s;
}
.icon-btn:hover:not(:disabled) {
  border-color: var(--border-hover);
  color: var(--text);
}
.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.icon-btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--primary-foreground);
}
.icon-btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}
.locked-hint {
  font-size: 10px;
  color: var(--muted);
  padding: 1px 6px;
  border: 1px dashed var(--border);
  border-radius: 4px;
}

/* Consistency check button + result card */
.check-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 12px;
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--muted);
  cursor: pointer;
  transition: all 0.15s;
}
.check-btn:hover:not(:disabled) {
  border-color: var(--border-hover);
  color: var(--text);
}
.check-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.consistency-card {
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 8px 10px;
  background: var(--bg-elevated);
  margin-top: 4px;
}
.consistency-card.is-ok  { border-color: var(--ok); }
.consistency-card.is-bad { border-color: var(--warn, #f59e0b); }
.consistency-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  margin-bottom: 6px;
}
.consistency-close {
  background: transparent;
  border: none;
  color: var(--muted);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}
.consistency-close:hover { color: var(--text); }
.consistency-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--text);
  word-break: break-all;
}
.consistency-body .k {
  color: var(--muted);
  font-size: 11px;
  margin-right: 2px;
}
.consistency-body code {
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
  background: var(--card);
  padding: 1px 4px;
  border-radius: 3px;
}
.consistency-path {
  font-size: 10px;
  color: var(--muted);
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
  margin-top: 2px;
  word-break: break-all;
}
.consistency-issues {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.consistency-issues li {
  font-size: 11px;
  color: var(--danger);
  padding-left: 8px;
  border-left: 2px solid var(--warn, #f59e0b);
}
.status-msg-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  word-break: break-all;
}
.actions-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.action-row {
  display: flex;
  gap: 8px;
}
.action-row.is-wrap {
  flex-wrap: wrap;
}
.action-row-danger {
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.btn {
  padding: 8px 14px;
  border: none;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn-primary {
  background: var(--accent);
  color: var(--primary-foreground);
}
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.btn-secondary {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
}
.btn-secondary:hover:not(:disabled) { border-color: var(--border-hover); color: var(--text); }
.btn-success {
  background: var(--ok);
  color: #fff;
}
.btn-success:hover:not(:disabled) { background: #166534; }
.btn-danger {
  background: transparent;
  border: 1px solid var(--danger);
  color: var(--danger);
}
.btn-danger:hover:not(:disabled) {
  background: var(--danger);
  color: #fff;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.spin {
  animation: spin 1s linear infinite;
}
.log-panel {
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.not-found {
  text-align: center;
  padding: 80px 24px;
  color: var(--muted);
}
.not-found p {
  margin-bottom: 16px;
  font-size: 18px;
}
.not-found .btn-back {
  margin-bottom: 0;
}
</style>

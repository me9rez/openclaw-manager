<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useInstancesStore } from "../stores/instances";
import LogViewer from "../components/LogViewer.vue";

const props = defineProps<{
  name: string;
}>();

const emit = defineEmits<{
  back: [];
}>();

const store = useInstancesStore();

const instance = computed(() => store.instances.find((i) => i.name === props.name));

let cleanupStatus: (() => void) | null = null;

onMounted(async () => {
  await store.fetchList();
  cleanupStatus = window.api.instances.onStatusChanged(() => {
    store.fetchList();
  });
});

onUnmounted(() => {
  cleanupStatus?.();
});

function openWebUI(port: number, token: string) {
  window.api.instances.openWebUI(port, token);
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
</script>

<template>
  <div v-if="instance" class="detail">
    <div class="detail-header">
      <button class="btn-back" @click="emit('back')">← 返回</button>
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
          <div class="info-row">
            <span class="label">端口</span>
            <span class="value">{{ instance.port }}</span>
          </div>
          <div class="info-row">
            <span class="label">Token</span>
            <span class="value mono">{{ instance.token.substring(0, 12) }}...</span>
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
          <button
            v-if="instance.status === 'running' || instance.status === 'reconnecting'"
            class="btn btn-accent"
            @click="openWebUI(instance.port, instance.token)"
          >
            打开 WebUI
          </button>
          <button
            v-if="instance.status === 'running' || instance.status === 'reconnecting'"
            class="btn btn-warning"
            @click="store.stop(instance.name)"
          >
            停止
          </button>
          <button
            v-if="instance.status === 'running' || instance.status === 'reconnecting'"
            class="btn btn-ghost"
            @click="store.restart(instance.name)"
          >
            重启
          </button>
          <button
            v-if="instance.status === 'reconnecting'"
            class="btn btn-warning"
            @click="store.stopReconnect(instance.name)"
          >
            停止重连
          </button>
          <button
            v-if="instance.status === 'crashed' || instance.status === 'error'"
            class="btn btn-primary"
            @click="store.forceReconnect(instance.name)"
          >
            重新连接
          </button>
          <button
            v-if="instance.status === 'stopped' || instance.status === 'crashed' || instance.status === 'error'"
            class="btn btn-primary"
            @click="store.start(instance.name)"
          >
            启动
          </button>
          <button
            class="btn btn-danger"
            @click="store.remove(instance.name); emit('back')"
          >
            删除实例
          </button>
        </div>
      </div>

      <div class="log-panel">
        <LogViewer :instanceName="instance.name" />
      </div>
    </div>
  </div>
  <div v-else class="not-found">
    <p>未找到实例 "{{ props.name }}"</p>
    <button class="btn-back" @click="emit('back')">← 返回仪表盘</button>
  </div>
</template>

<style scoped>
.detail {
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
  height: calc(100vh - 150px);
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
  gap: 8px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.btn {
  padding: 8px 16px;
  border: none;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;
}
.btn-primary {
  background: var(--accent);
  color: var(--primary-foreground);
}
.btn-primary:hover { background: var(--accent-hover); }
.btn-accent {
  background: var(--accent);
  color: var(--primary-foreground);
}
.btn-accent:hover { background: var(--accent-hover); }
.btn-warning {
  background: var(--warn);
  color: #fff;
}
.btn-ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
}
.btn-ghost:hover { border-color: var(--border-hover); color: var(--text); }
.btn-danger {
  background: transparent;
  border: 1px solid var(--danger);
  color: var(--danger);
}
.btn-danger:hover {
  background: var(--danger);
  color: #fff;
}
.log-panel {
  height: 100%;
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
</style>

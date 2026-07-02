<script setup lang="ts">
import type { InstanceInfo } from "../stores/instances";

const props = defineProps<{
  instance: InstanceInfo;
}>();

const emit = defineEmits<{
  start: [name: string];
  stop: [name: string];
  restart: [name: string];
  remove: [name: string];
  select: [name: string];
}>();

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

function formatUptime(startedAt?: number): string {
  if (!startedAt) return "";
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分${seconds % 60}秒`;
  const hours = Math.floor(minutes / 60);
  return `${hours}时${minutes % 60}分`;
}
</script>

<template>
  <div class="card" @click="emit('select', instance.name)">
    <div class="card-header">
      <span class="instance-name">{{ instance.name }}</span>
      <span :class="['badge']" :style="{ background: statusColor(instance.status) }">
        {{ statusLabel[instance.status] || instance.status }}
      </span>
    </div>
    <div class="card-body">
      <div class="info-row">
        <span class="label">版本</span>
        <span class="value">{{ instance.version }}</span>
      </div>
      <div class="info-row">
        <span class="label">端口</span>
        <span class="value">{{ instance.port }}</span>
      </div>
      <div v-if="instance.status === 'running'" class="info-row">
        <span class="label">运行时长</span>
        <span class="value">{{ formatUptime(instance.startedAt) }}</span>
      </div>
      <div v-if="instance.health?.version" class="info-row">
        <span class="label">Gateway 版本</span>
        <span class="value">{{ instance.health.version }}</span>
      </div>
      <div v-if="instance.statusMessage" class="status-msg">
        {{ instance.statusMessage }}
      </div>
    </div>
    <div class="card-actions" @click.stop>
      <template v-if="instance.status === 'running'">
        <button class="btn btn-warning" @click="emit('stop', instance.name)">停止</button>
        <button class="btn btn-ghost" @click="emit('restart', instance.name)">重启</button>
      </template>
      <template v-else-if="instance.status === 'stopped' || instance.status === 'installed' || instance.status === 'crashed'">
        <button class="btn btn-primary" @click="emit('start', instance.name)">启动</button>
        <button class="btn btn-danger" @click="emit('remove', instance.name)">删除</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 16px;
  cursor: pointer;
  transition: all 0.15s;
}
.card:hover {
  border-color: var(--border-strong);
  background: var(--bg-accent);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.instance-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-strong);
}
.badge {
  padding: 3px 10px;
  border-radius: var(--radius-full);
  font-size: 11px;
  font-weight: 600;
  color: #fff;
}
.card-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.info-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}
.label {
  color: var(--muted);
}
.value {
  color: var(--text);
  font-weight: 500;
}
.status-msg {
  font-size: 12px;
  color: var(--accent);
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-actions {
  display: flex;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.btn {
  padding: 6px 14px;
  border: none;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-primary {
  background: var(--accent);
  color: var(--primary-foreground);
}
.btn-primary:hover { background: var(--accent-hover); }
.btn-warning {
  background: var(--warn);
  color: #fff;
}
.btn-warning:hover { filter: brightness(1.1); }
.btn-danger {
  background: transparent;
  border: 1px solid var(--danger);
  color: var(--danger);
}
.btn-danger:hover { background: var(--danger); color: #fff; }
.btn-ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
}
.btn-ghost:hover { border-color: var(--border-hover); color: var(--text); }
</style>

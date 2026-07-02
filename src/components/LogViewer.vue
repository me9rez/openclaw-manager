<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from "vue";

const props = defineProps<{
  instanceName: string;
}>();

const logs = ref<string[]>([]);
const logContainer = ref<HTMLDivElement | null>(null);
const autoScroll = ref(true);
const copyState = ref<{ ok: boolean; count: number } | null>(null);

let cleanupLog: (() => void) | null = null;
let copyTimer: ReturnType<typeof setTimeout> | null = null;

const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const CARRIAGE_RE = /\r(?!\n)/g;

function cleanForCopy(s: string): string {
  return s.replace(OSC_RE, "").replace(ANSI_RE, "").replace(CARRIAGE_RE, "");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const FG_COLORS: Record<number, string> = {
  30: "ansi-black",
  31: "ansi-red",
  32: "ansi-green",
  33: "ansi-yellow",
  34: "ansi-blue",
  35: "ansi-magenta",
  36: "ansi-cyan",
  37: "ansi-white",
  90: "ansi-bright-black",
  91: "ansi-bright-red",
  92: "ansi-bright-green",
  93: "ansi-bright-yellow",
  94: "ansi-bright-blue",
  95: "ansi-bright-magenta",
  96: "ansi-bright-cyan",
  97: "ansi-bright-white",
};

function ansiToHtml(line: string): string {
  let result = "";
  let currentClass = "";
  let lastIndex = 0;

  const cleaned = line.replace(OSC_RE, "").replace(CARRIAGE_RE, "");

  const regex = /\x1b\[([0-9;]*)m/g;
  let match;
  while ((match = regex.exec(cleaned)) !== null) {
    result += escapeHtml(cleaned.slice(lastIndex, match.index));
    lastIndex = regex.lastIndex;

    const codes = match[1].split(";").map(Number);
    for (const code of codes) {
      if (code === 0) {
        if (currentClass) {
          result += "</span>";
          currentClass = "";
        }
      } else if (FG_COLORS[code]) {
        if (currentClass) {
          result += "</span>";
        }
        currentClass = FG_COLORS[code];
        result += `<span class="${currentClass}">`;
      }
    }
  }

  result += escapeHtml(cleaned.slice(lastIndex));
  if (currentClass) {
    result += "</span>";
  }
  return result;
}

async function loadHistory() {
  try {
    logs.value = await window.api.instances.getLogs(props.instanceName);
  } catch {}
}

function handleLog(data: { name: string; line: string }) {
  if (data.name === props.instanceName) {
    logs.value.push(data.line);
    if (logs.value.length > 200) {
      logs.value.shift();
    }
    if (autoScroll.value) {
      nextTick(() => {
        if (logContainer.value) {
          logContainer.value.scrollTop = logContainer.value.scrollHeight;
        }
      });
    }
  }
}

function toggleAutoScroll() {
  autoScroll.value = !autoScroll.value;
}

function fallbackCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

async function copyLogs() {
  if (logs.value.length === 0) {
    copyState.value = { ok: false, count: 0 };
  } else {
    const text = logs.value.map(cleanForCopy).join("\n");
    let ok = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        ok = fallbackCopy(text);
      }
    } else {
      ok = fallbackCopy(text);
    }
    copyState.value = { ok, count: logs.value.length };
  }
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => (copyState.value = null), 2000);
}

onMounted(async () => {
  await loadHistory();
  cleanupLog = window.api.instances.onLog(handleLog);
});

onUnmounted(() => {
  cleanupLog?.();
  if (copyTimer) clearTimeout(copyTimer);
});
</script>

<template>
  <div class="log-viewer">
    <div class="log-toolbar">
      <span class="log-title">实例日志</span>
      <button class="log-btn" @click="toggleAutoScroll">
        {{ autoScroll ? "自动滚动：开" : "自动滚动：关" }}
      </button>
      <button class="log-btn" @click="loadHistory">刷新</button>
      <button class="log-btn" @click="copyLogs" :disabled="logs.length === 0">
        复制
      </button>
      <span v-if="copyState" :class="['copy-feedback', copyState.ok ? 'ok' : 'err']">
        {{ copyState.ok ? `已复制 ${copyState.count} 行` : "复制失败" }}
      </span>
    </div>
    <div ref="logContainer" class="log-content" @scroll="autoScroll = false">
      <div v-if="logs.length === 0" class="log-empty">暂无日志...</div>
      <div
        v-for="(line, i) in logs"
        :key="i"
        class="log-line"
        v-html="ansiToHtml(line)"
      ></div>
    </div>
  </div>
</template>

<style scoped>
.log-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.log-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-accent);
}
.log-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  margin-right: auto;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.log-btn {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  color: var(--muted);
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}
.log-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--text);
}
.log-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.copy-feedback {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  animation: feedback-in 0.15s ease-out;
}
.copy-feedback.ok {
  background: rgba(21, 128, 61, 0.1);
  color: var(--ok);
}
.copy-feedback.err {
  background: var(--accent-subtle);
  color: var(--accent);
}
@keyframes feedback-in {
  from { opacity: 0; transform: translateY(-2px); }
  to { opacity: 1; transform: translateY(0); }
}
.log-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  font-family: "JetBrains Mono", "Cascadia Code", "Consolas", monospace;
  font-size: 12px;
  line-height: 1.6;
  background: #1e1e2e;
}
.log-empty {
  color: #6c7086;
  text-align: center;
  padding: 24px;
}
.log-line {
  white-space: pre-wrap;
  word-break: break-all;
  color: #cdd6f4;
}
:deep(.ansi-black) { color: #45475a; }
:deep(.ansi-red) { color: #f38ba8; }
:deep(.ansi-green) { color: #a6e3a1; }
:deep(.ansi-yellow) { color: #f9e2af; }
:deep(.ansi-blue) { color: #89b4fa; }
:deep(.ansi-magenta) { color: #f5c2e7; }
:deep(.ansi-cyan) { color: #94e2d5; }
:deep(.ansi-white) { color: #bac2de; }
:deep(.ansi-bright-black) { color: #585b70; }
:deep(.ansi-bright-red) { color: #f38ba8; }
:deep(.ansi-bright-green) { color: #a6e3a1; }
:deep(.ansi-bright-yellow) { color: #f9e2af; }
:deep(.ansi-bright-blue) { color: #89b4fa; }
:deep(.ansi-bright-magenta) { color: #f5c2e7; }
:deep(.ansi-bright-cyan) { color: #94e2d5; }
:deep(.ansi-bright-white) { color: #a6adc8; }
</style>

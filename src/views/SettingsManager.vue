<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useSettingsStore } from "../stores/settings";
import { useInstancesStore } from "../stores/instances";

const settingsStore = useSettingsStore();
const instancesStore = useInstancesStore();

// ---- 通知配置本地状态 ----
const notifyConfig = ref<NotificationConfig | null>(null);
const subscribableEvents = ref<SubscribableEvent[]>([]);
const notifyLoading = ref(false);
const notifyError = ref<string | null>(null);
const testResult = ref<string | null>(null);

onMounted(async () => {
  await settingsStore.fetch();
  await instancesStore.fetchList();
  await loadNotificationConfig();
});

async function loadNotificationConfig() {
  notifyLoading.value = true;
  notifyError.value = null;
  try {
    const res = await window.api.notifications.get();
    notifyConfig.value = res.config;
    subscribableEvents.value = res.events;
  } catch (err) {
    notifyError.value = err instanceof Error ? err.message : String(err);
  } finally {
    notifyLoading.value = false;
  }
}

async function toggleNotifyEnabled(value: boolean) {
  if (!notifyConfig.value) return;
  await patchNotify({ enabled: value });
}

async function toggleEvent(name: string, checked: boolean) {
  if (!notifyConfig.value) return;
  const next = checked
    ? [...new Set([...notifyConfig.value.events, name])]
    : notifyConfig.value.events.filter((e) => e !== name);
  await patchNotify({ events: next });
}

async function toggleQuietHours(value: boolean) {
  if (!notifyConfig.value) return;
  await patchNotify({ quietHours: { ...notifyConfig.value.quietHours, enabled: value } });
}

async function updateQuietStart(value: string) {
  if (!notifyConfig.value) return;
  await patchNotify({ quietHours: { ...notifyConfig.value.quietHours, start: value } });
}

async function updateQuietEnd(value: string) {
  if (!notifyConfig.value) return;
  await patchNotify({ quietHours: { ...notifyConfig.value.quietHours, end: value } });
}

async function updateAggregateWindow(value: number) {
  await patchNotify({ aggregateWindowSec: value });
}

async function patchNotify(patch: { enabled?: boolean; events?: string[]; quietHours?: { enabled?: boolean; start?: string; end?: string }; aggregateWindowSec?: number }) {
  notifyError.value = null;
  try {
    notifyConfig.value = await window.api.notifications.set(patch);
  } catch (err) {
    notifyError.value = err instanceof Error ? err.message : String(err);
  }
}

async function sendTestNotification() {
  testResult.value = null;
  const target = instancesStore.instances[0]?.name ?? "test";
  try {
    const res = await window.api.app.notifyTest(target);
    if (res.ok) {
      testResult.value = "测试通知已发送";
    } else if (!res.supported) {
      testResult.value = "当前系统不支持系统通知";
    } else {
      testResult.value = `发送失败: ${res.error ?? "未知错误"}`;
    }
  } catch (err) {
    testResult.value = err instanceof Error ? err.message : String(err);
  }
}

function isEventChecked(name: string): boolean {
  return notifyConfig.value?.events.includes(name) ?? false;
}

const aggregateOptions = [
  { value: 0, label: "不聚合" },
  { value: 15, label: "15 秒" },
  { value: 30, label: "30 秒(推荐)" },
  { value: 60, label: "1 分钟" },
  { value: 300, label: "5 分钟" },
];

const isValidHHMM = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

const quietStartValid = computed(() => notifyConfig.value ? isValidHHMM(notifyConfig.value.quietHours.start) : true);
const quietEndValid = computed(() => notifyConfig.value ? isValidHHMM(notifyConfig.value.quietHours.end) : true);

async function toggleAutoStart(value: boolean) {
  await settingsStore.update({ autoStart: value });
}

async function toggleAutoStartInstances(value: boolean) {
  await settingsStore.update({ autoStartInstances: value });
}

function isInstanceChecked(name: string): boolean {
  return settingsStore.data.autoStartInstanceList.includes(name);
}

async function toggleInstance(name: string, checked: boolean) {
  const current = settingsStore.data.autoStartInstanceList;
  const next = checked
    ? [...new Set([...current, name])]
    : current.filter((n) => n !== name);
  await settingsStore.update({ autoStartInstanceList: next });
}
</script>

<template>
  <div class="settings">
    <h1 class="page-title">设置</h1>

    <section class="settings-card">
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">开机自启动</div>
          <div class="settings-row-desc">开启后,应用会随系统登录自动启动</div>
        </div>
        <label class="switch">
          <input
            type="checkbox"
            :checked="settingsStore.data.autoStart"
            @change="(e) => toggleAutoStart((e.target as HTMLInputElement).checked)"
          />
          <span class="slider"></span>
        </label>
      </div>
    </section>

    <section class="settings-card">
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">启动应用时启动实例</div>
          <div class="settings-row-desc">开启后,应用启动时会自动启动选中的实例</div>
        </div>
        <label class="switch">
          <input
            type="checkbox"
            :checked="settingsStore.data.autoStartInstances"
            @change="(e) => toggleAutoStartInstances((e.target as HTMLInputElement).checked)"
          />
          <span class="slider"></span>
        </label>
      </div>

      <div v-if="settingsStore.data.autoStartInstances" class="settings-instance-list">
        <div class="settings-row-label sub">选择随应用启动的实例</div>
        <div v-if="instancesStore.instances.length === 0" class="empty-hint">
          暂无实例,请先在仪表盘创建实例
        </div>
        <label
          v-for="inst in instancesStore.instances"
          :key="inst.name"
          class="instance-item"
        >
          <input
            type="checkbox"
            :checked="isInstanceChecked(inst.name)"
            @change="(e) => toggleInstance(inst.name, (e.target as HTMLInputElement).checked)"
          />
          <span class="instance-name">{{ inst.name }}</span>
          <span class="instance-version">{{ inst.version }}</span>
        </label>
      </div>
    </section>

    <!-- 通知设置面板 -->
    <section class="settings-card">
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">系统通知</div>
          <div class="settings-row-desc">OpenClaw agent 跑完任务或报错时,通过系统通知中心推送,免去盯 webUI</div>
        </div>
        <label class="switch">
          <input
            type="checkbox"
            :checked="notifyConfig?.enabled ?? false"
            :disabled="notifyLoading || !notifyConfig"
            @change="(e) => toggleNotifyEnabled((e.target as HTMLInputElement).checked)"
          />
          <span class="slider"></span>
        </label>
      </div>

      <div v-if="notifyConfig" class="settings-instance-list">
        <div class="settings-row-label sub">监听事件</div>
        <div class="empty-hint">勾选希望触发通知的 OpenClaw agent 事件;带"重要"标记的不受静默时段影响</div>
        <label
          v-for="evt in subscribableEvents"
          :key="evt.name"
          class="event-item"
        >
          <input
            type="checkbox"
            :checked="isEventChecked(evt.name)"
            :disabled="!notifyConfig.enabled"
            @change="(e) => toggleEvent(evt.name, (e.target as HTMLInputElement).checked)"
          />
          <span class="event-label">{{ evt.label }}</span>
          <span v-if="evt.important" class="event-tag">重要</span>
        </label>

        <div class="settings-row-label sub" style="margin-top: 20px">静默时段</div>
        <div class="quiet-hours-row">
          <label class="switch small">
            <input
              type="checkbox"
              :checked="notifyConfig.quietHours.enabled"
              :disabled="!notifyConfig.enabled"
              @change="(e) => toggleQuietHours((e.target as HTMLInputElement).checked)"
            />
            <span class="slider"></span>
          </label>
          <span class="quiet-text">从</span>
          <input
            type="time"
            class="time-input"
            :value="notifyConfig.quietHours.start"
            :disabled="!notifyConfig.enabled || !notifyConfig.quietHours.enabled"
            :class="{ invalid: !quietStartValid }"
            @change="(e) => updateQuietStart((e.target as HTMLInputElement).value)"
          />
          <span class="quiet-text">到</span>
          <input
            type="time"
            class="time-input"
            :value="notifyConfig.quietHours.end"
            :disabled="!notifyConfig.enabled || !notifyConfig.quietHours.enabled"
            :class="{ invalid: !quietEndValid }"
            @change="(e) => updateQuietEnd((e.target as HTMLInputElement).value)"
          />
          <span class="quiet-text">(跨夜支持,如 22:00 → 08:00)</span>
        </div>

        <div class="settings-row-label sub" style="margin-top: 20px">聚合窗口</div>
        <div class="aggregate-row">
          <select
            class="select-input"
            :value="notifyConfig.aggregateWindowSec"
            :disabled="!notifyConfig.enabled"
            @change="(e) => updateAggregateWindow(Number((e.target as HTMLSelectElement).value))"
          >
            <option v-for="opt in aggregateOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
          <span class="quiet-text">同实例同事件在窗口内的多条会合并成一条</span>
        </div>

        <div class="settings-row-label sub" style="margin-top: 20px">测试</div>
        <div class="test-row">
          <button class="test-button" @click="sendTestNotification">发送测试通知</button>
          <span v-if="testResult" class="test-result">{{ testResult }}</span>
        </div>
      </div>
    </section>

    <div v-if="settingsStore.error" class="error-banner">
      {{ settingsStore.error }}
    </div>
    <div v-if="notifyError" class="error-banner">
      {{ notifyError }}
    </div>
  </div>
</template>

<style scoped>
.settings {
  max-width: 720px;
  margin: 0 auto;
  animation: fade-in 0.25s ease-out;
}
@keyframes fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.page-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-strong);
  margin-bottom: 20px;
}
.settings-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  margin-bottom: 16px;
  overflow: hidden;
}
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
}
.settings-row-info {
  flex: 1;
  min-width: 0;
}
.settings-row-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
  margin-bottom: 4px;
}
.settings-row-label.sub {
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
  padding: 0 20px;
}
.settings-row-desc {
  font-size: 12px;
  color: var(--muted);
}
.settings-instance-list {
  border-top: 1px solid var(--border);
  padding: 16px 20px;
  background: var(--bg-accent);
}
.empty-hint {
  font-size: 12px;
  color: var(--muted);
  padding: 4px 0 8px;
}
.instance-item,
.event-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  cursor: pointer;
  user-select: none;
}
.instance-item input[type="checkbox"],
.event-item input[type="checkbox"] {
  cursor: pointer;
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
}
.instance-item input[type="checkbox"]:disabled,
.event-item input[type="checkbox"]:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.instance-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-strong);
}
.instance-version {
  font-size: 11px;
  color: var(--muted);
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
  margin-left: 6px;
}
.event-label {
  font-size: 13px;
  color: var(--text);
}
.event-tag {
  font-size: 10px;
  font-weight: 600;
  color: var(--danger);
  background: var(--accent-subtle);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  margin-left: 4px;
}
.quiet-hours-row,
.aggregate-row,
.test-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 4px 0;
}
.quiet-text {
  font-size: 12px;
  color: var(--muted);
}
.time-input,
.select-input {
  font-size: 13px;
  padding: 4px 8px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--card);
  color: var(--text);
  font-family: inherit;
  cursor: pointer;
}
.time-input:disabled,
.select-input:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.time-input.invalid {
  border-color: var(--danger);
  background: var(--accent-subtle);
}
.test-button {
  font-size: 13px;
  padding: 6px 14px;
  border: 1px solid var(--accent);
  background: transparent;
  color: var(--accent);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-weight: 500;
  transition: all 0.15s;
}
.test-button:hover {
  background: var(--accent-subtle);
}
.test-result {
  font-size: 12px;
  color: var(--muted);
}
.switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  flex-shrink: 0;
}
.switch.small {
  width: 36px;
  height: 20px;
}
.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.switch input:disabled + .slider {
  cursor: not-allowed;
  opacity: 0.5;
}
.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--border-strong);
  border-radius: var(--radius-full);
  transition: background 0.2s;
}
.slider::before {
  content: "";
  position: absolute;
  height: 18px;
  width: 18px;
  left: 3px;
  top: 3px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.2s;
}
.switch.small .slider::before {
  height: 14px;
  width: 14px;
  left: 3px;
  top: 3px;
}
.switch input:checked + .slider {
  background: var(--accent);
}
.switch input:checked + .slider::before {
  transform: translateX(20px);
}
.switch.small input:checked + .slider::before {
  transform: translateX(16px);
}
.error-banner {
  margin-top: 12px;
  padding: 10px 14px;
  background: var(--accent-subtle);
  border: 1px solid var(--danger);
  border-radius: var(--radius-md);
  color: var(--danger);
  font-size: 13px;
}
</style>

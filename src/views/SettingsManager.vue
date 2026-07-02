<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useSettingsStore } from "../stores/settings";
import { useInstancesStore } from "../stores/instances";

const settingsStore = useSettingsStore();
const instancesStore = useInstancesStore();

onMounted(async () => {
  await settingsStore.fetch();
  await instancesStore.fetchList();
});

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

    <div v-if="settingsStore.error" class="error-banner">
      {{ settingsStore.error }}
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
  padding: 8px 0;
}
.instance-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  cursor: pointer;
  user-select: none;
}
.instance-item input[type="checkbox"] {
  cursor: pointer;
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
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
.switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  flex-shrink: 0;
}
.switch input {
  opacity: 0;
  width: 0;
  height: 0;
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
.switch input:checked + .slider {
  background: var(--accent);
}
.switch input:checked + .slider::before {
  transform: translateX(20px);
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

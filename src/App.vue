<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import Dashboard from "./views/Dashboard.vue";
import InstanceDetail from "./views/InstanceDetail.vue";
import VersionManager from "./views/VersionManager.vue";
import ConfigManager from "./views/ConfigManager.vue";

type Tab = "dashboard" | "versions" | "config" | "detail";

const currentTab = ref<Tab>("dashboard");
const detailName = ref("");

let cleanupTrayNav: (() => void) | null = null;

function navigateToDetail(name: string) {
  detailName.value = name;
  currentTab.value = "detail";
}

function navigateToDashboard() {
  currentTab.value = "dashboard";
}

function navigateToVersions() {
  currentTab.value = "versions";
}

function navigateToConfig() {
  currentTab.value = "config";
}

onMounted(() => {
  document.documentElement.lang = "zh-CN";
  cleanupTrayNav = window.api.app.onTrayNavigateInstance((name) => {
    navigateToDetail(name);
  });
});

onUnmounted(() => {
  cleanupTrayNav?.();
});
</script>

<template>
  <div class="app">
    <nav class="nav">
      <div class="nav-brand">OpenClaw Manager</div>
      <div class="nav-links">
        <button
          :class="['nav-link', { active: currentTab === 'dashboard' }]"
          @click="navigateToDashboard"
        >
          仪表盘
        </button>
        <button
          :class="['nav-link', { active: currentTab === 'versions' }]"
          @click="navigateToVersions"
        >
          版本管理
        </button>
        <button
          :class="['nav-link', { active: currentTab === 'config' }]"
          @click="navigateToConfig"
        >
          配置管理
        </button>
      </div>
    </nav>
    <main class="main">
      <Dashboard v-if="currentTab === 'dashboard'" @select="navigateToDetail" />
      <InstanceDetail
        v-else-if="currentTab === 'detail'"
        :name="detailName"
        @back="navigateToDashboard"
      />
      <VersionManager v-else-if="currentTab === 'versions'" />
      <ConfigManager v-else-if="currentTab === 'config'" />
    </main>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

:root {
  --bg: #f8f9fa;
  --bg-accent: #f1f3f5;
  --bg-elevated: #ffffff;
  --bg-hover: #eceef0;
  --bg-muted: #eceef0;
  --card: #ffffff;
  --card-foreground: #1a1a1e;
  --popover: #ffffff;
  --popover-foreground: #1a1a1e;
  --text: #3c3c43;
  --text-strong: #1a1a1e;
  --muted: #6a6a6f;
  --muted-foreground: #6a6a6f;
  --border: #e5e5ea;
  --border-strong: #d1d1d6;
  --border-hover: #aeaeb2;
  --input: #e5e5ea;
  --ring: #dc2626;
  --accent: #dc2626;
  --accent-hover: #ef4444;
  --accent-subtle: rgba(220, 38, 38, 0.08);
  --accent-glow: rgba(220, 38, 38, 0.1);
  --primary: #dc2626;
  --primary-foreground: #ffffff;
  --secondary: #f1f3f5;
  --secondary-foreground: #3c3c43;
  --ok: #15803d;
  --ok-muted: rgba(21, 128, 61, 0.75);
  --warn: #b45309;
  --danger: #dc2626;
  --info: #2563eb;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 12px 28px rgba(0, 0, 0, 0.08);
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-full: 9999px;
  color-scheme: light;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
  border-radius: var(--radius-full);
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.25);
}

::selection {
  background: #005fcc;
  color: #ffffff;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.nav {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 0 24px;
  height: 56px;
  background: rgba(248, 249, 250, 0.96);
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;
  user-select: none;
}

.nav-brand {
  font-size: 18px;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: -0.3px;
}

.nav-links {
  display: flex;
  gap: 4px;
  -webkit-app-region: no-drag;
}

.nav-link {
  background: none;
  border: none;
  color: var(--muted);
  padding: 8px 16px;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.15s;
}

.nav-link:hover {
  color: var(--text);
  background: var(--bg-hover);
}

.nav-link.active {
  color: var(--primary-foreground);
  background: var(--accent);
}

.main {
  flex: 1;
  overflow: hidden;
  padding: 24px;
}
</style>

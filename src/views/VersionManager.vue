<script setup lang="ts">
import { onMounted } from "vue";
import { useVersionsStore } from "../stores/versions";

const store = useVersionsStore();

onMounted(async () => {
  store.restoreFromCache();
  await store.fetchInstalled();
  store.fetchAvailable();
});

function handleRefresh() {
  store.fetchAvailable(true);
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("zh-CN");
  } catch {
    return dateStr;
  }
}
</script>

<template>
  <div class="versions">
    <div class="page-header">
      <div>
        <h1>版本管理</h1>
        <p class="subtitle">管理 OpenClaw CLI 版本</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-ghost" :disabled="store.loading" @click="handleRefresh">
          {{ store.loading ? "刷新中..." : "刷新" }}
        </button>
      </div>
    </div>

    <div v-if="store.error" class="error-banner">{{ store.error }}</div>

    <div class="table-wrap">
      <table class="version-table">
        <thead>
          <tr>
            <th>版本</th>
            <th>发布日期</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="store.loading && store.availableVersions.length === 0">
            <td colspan="4" class="loading-cell">正在加载版本列表...</td>
          </tr>
          <tr v-for="v in store.availableVersions" :key="v.version">
            <td class="version-cell">{{ v.version }}</td>
            <td class="date-cell">{{ formatDate(v.publishedAt) }}</td>
            <td>
              <span v-if="v.installed" class="installed-badge">已安装</span>
              <span v-else class="not-installed">未安装</span>
            </td>
            <td class="actions-cell">
              <button
                v-if="!v.installed"
                class="btn btn-primary btn-sm"
                :disabled="store.installing === v.version"
                @click="store.install(v.version)"
              >
                {{ store.installing === v.version ? "安装中..." : "安装" }}
              </button>
              <button
                v-else
                class="btn btn-danger btn-sm"
                :disabled="store.installing === v.version"
                @click="store.remove(v.version)"
              >
                删除
              </button>
            </td>
          </tr>
          <tr v-if="!store.loading && store.availableVersions.length === 0">
            <td colspan="4" class="empty-cell">未找到版本，请检查网络连接。</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.versions {
  max-width: 900px;
  margin: 0 auto;
  animation: fade-in 0.25s ease-out;
}
@keyframes fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 24px;
  gap: 16px;
}
.page-header h1 {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-strong);
}
.subtitle {
  font-size: 14px;
  color: var(--muted);
  margin-top: 4px;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.btn {
  padding: 8px 18px;
  border: none;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-sm {
  padding: 5px 12px;
  font-size: 12px;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-primary {
  background: var(--accent);
  color: var(--primary-foreground);
}
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.btn-danger {
  background: transparent;
  border: 1px solid var(--danger);
  color: var(--danger);
}
.btn-danger:hover:not(:disabled) { background: var(--danger); color: #fff; }
.btn-ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
}
.btn-ghost:hover:not(:disabled) { border-color: var(--border-hover); color: var(--text); }
.error-banner {
  background: var(--accent-subtle);
  border: 1px solid var(--accent);
  border-radius: var(--radius-md);
  padding: 10px 16px;
  font-size: 13px;
  color: var(--accent);
  margin-bottom: 16px;
}
.table-wrap {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.version-table {
  width: 100%;
  border-collapse: collapse;
}
.version-table th {
  text-align: left;
  padding: 12px 16px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-accent);
}
.version-table td {
  padding: 12px 16px;
  font-size: 14px;
  border-bottom: 1px solid var(--border);
}
.version-table tr:last-child td { border-bottom: none; }
.version-table tr:hover td { background: var(--bg-hover); }
.version-cell {
  font-weight: 600;
  color: var(--text-strong);
}
.date-cell {
  color: var(--muted);
}
.installed-badge {
  display: inline-block;
  padding: 2px 8px;
  background: var(--ok);
  color: #fff;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
}
.not-installed {
  color: var(--muted);
  font-size: 13px;
}
.actions-cell {
  text-align: right;
}
.loading-cell,
.empty-cell {
  text-align: center;
  color: var(--muted);
  padding: 32px 16px !important;
}
</style>

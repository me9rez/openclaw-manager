<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{
  templates: ConfigTemplate[];
}>();

const emit = defineEmits<{
  apply: [templateId: string];
  edit: [templateId: string];
  delete: [templateId: string];
  copy: [templateId: string];
  new: [];
  importOpenclaw: [];
}>();

const showJsonFor = ref<string | null>(null);

function toggleJson(id: string) {
  showJsonFor.value = showJsonFor.value === id ? null : id;
}

function formatTime(t: number): string {
  try { return new Date(t).toLocaleString("zh-CN"); } catch { return String(t); }
}

function prettyJson(content: unknown): string {
  try { return JSON.stringify(content, null, 2); } catch { return String(content); }
}
</script>

<template>
  <div class="template-list">
    <div class="list-header">
      <span>模板库 ({{ templates.length }})</span>
      <div class="header-actions">
        <button class="btn btn-ghost btn-sm" @click="emit('importOpenclaw')">导入模板</button>
        <button class="btn btn-primary btn-sm" @click="emit('new')">+ 新建模板</button>
      </div>
    </div>
    <div v-if="templates.length === 0" class="empty">
      暂无模板。在「实例配置」中编辑块后,点击「另存为模板」即可创建。
    </div>
    <ul v-else class="list">
      <li v-for="t in templates" :key="t.id" class="card">
        <div class="card-row">
          <div class="card-main">
            <div class="title-line">
              <span class="tpl-name">{{ t.name }}</span>
              <span class="tpl-block">{{ t.blockKey }}</span>
            </div>
            <div v-if="t.description" class="tpl-desc">{{ t.description }}</div>
            <div class="tpl-meta">更新于 {{ formatTime(t.updatedAt) }}</div>
          </div>
          <div class="card-actions">
            <button class="btn btn-primary btn-sm" @click="emit('apply', t.id)">应用</button>
            <button class="btn btn-ghost btn-sm" @click="emit('edit', t.id)">编辑</button>
            <button class="btn btn-ghost btn-sm" @click="toggleJson(t.id)">{{ showJsonFor === t.id ? "收起" : "查看" }}</button>
            <button class="btn btn-ghost btn-sm" @click="emit('copy', t.id)">复制</button>
            <button class="btn btn-danger-ghost btn-sm" @click="emit('delete', t.id)">删除</button>
          </div>
        </div>
        <pre v-if="showJsonFor === t.id" class="tpl-json">{{ prettyJson(t.content) }}</pre>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.template-list {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-accent);
}
.header-actions {
  display: flex;
  gap: 6px;
}
.empty {
  padding: 40px 16px;
  color: var(--muted);
  font-size: 13px;
  text-align: center;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.card {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.card:last-child { border-bottom: none; }
.card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.card-main {
  flex: 1;
  min-width: 0;
}
.title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.tpl-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
}
.tpl-block {
  font-size: 11px;
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: var(--accent-subtle);
  color: var(--accent);
}
.tpl-desc {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}
.tpl-meta {
  font-size: 11px;
  color: var(--muted-foreground);
}
.card-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.btn {
  padding: 5px 12px;
  border: none;
  border-radius: var(--radius-md);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-sm { font-size: 12px; }
.btn-primary { background: var(--accent); color: var(--primary-foreground); }
.btn-primary:hover { background: var(--accent-hover); }
.btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--muted); }
.btn-ghost:hover { border-color: var(--border-hover); color: var(--text); }
.btn-danger-ghost { background: transparent; border: 1px solid var(--danger); color: var(--danger); }
.btn-danger-ghost:hover { background: var(--danger); color: #fff; }
.tpl-json {
  margin: 12px 0 0;
  padding: 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  max-height: 320px;
  overflow-y: auto;
  color: var(--text);
}
</style>

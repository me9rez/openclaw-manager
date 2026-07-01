<script setup lang="ts">
import { ref, computed } from "vue";
import RestoreConfirmDialog from "./RestoreConfirmDialog.vue";

const props = defineProps<{
  backups: BackupEntry[];
  instances: { name: string; hasConfig: boolean }[];
  retention: number | null;
  selectedInstance: string | null;
}>();

const emit = defineEmits<{
  changeInstance: [name: string | null];
  changeRetention: [count: number | null];
  refresh: [];
  restore: [backup: BackupEntry];
  delete: [backup: BackupEntry];
}>();

const restoreTarget = ref<BackupEntry | null>(null);

const retentionOptions: { label: string; value: number | null }[] = [
  { label: "5", value: 5 },
  { label: "10", value: 10 },
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "无限", value: null },
];

const instanceOptions = computed(() => {
  const seen = new Set<string>();
  const opts: { label: string; value: string | null }[] = [{ label: "全部", value: null }];
  for (const b of props.backups) {
    if (!seen.has(b.instanceName)) {
      seen.add(b.instanceName);
      opts.push({ label: b.instanceName, value: b.instanceName });
    }
  }
  for (const inst of props.instances) {
    if (!seen.has(inst.name)) {
      seen.add(inst.name);
      opts.push({ label: inst.name, value: inst.name });
    }
  }
  return opts;
});

function formatTime(t: number): string {
  try { return new Date(t).toLocaleString("zh-CN"); } catch { return String(t); }
}

function sizeLabel(b: number): string {
  if (b < 1024) return `${b} B`;
  return `${(b / 1024).toFixed(1)} KB`;
}

const opLabel: Record<BackupEntry["operation"], string> = {
  edit: "编辑",
  sync: "同步",
  "template-apply": "模板",
  "delete-block": "删除块",
  restore: "恢复",
};

function askDelete(b: BackupEntry) {
  if (confirm(`确认删除备份 "${b.id}"?该操作不可撤销。`)) {
    emit("delete", b);
  }
}
</script>

<template>
  <div class="backup-list">
    <div class="toolbar">
      <div class="toolbar-group">
        <label>实例筛选</label>
        <select :value="selectedInstance ?? ''" @change="emit('changeInstance', ($event.target as HTMLSelectElement).value || null)">
          <option v-for="o in instanceOptions" :key="o.value ?? 'all'" :value="o.value ?? ''">{{ o.label }}</option>
        </select>
      </div>
      <div class="toolbar-group">
        <label>保留策略</label>
        <div class="retention-group">
          <button
            v-for="o in retentionOptions"
            :key="o.label"
            :class="['retention-btn', { active: retention === o.value }]"
            @click="emit('changeRetention', o.value)"
          >{{ o.label }}</button>
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" @click="emit('refresh')">刷新</button>
    </div>

    <div v-if="backups.length === 0" class="empty">暂无备份。备份会在编辑、同步、模板应用、恢复等写盘操作前自动创建。</div>

    <table v-else class="b-table">
      <thead>
        <tr>
          <th>时间</th>
          <th>实例</th>
          <th>操作</th>
          <th>来源</th>
          <th>块</th>
          <th>格式</th>
          <th>大小</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="b in backups" :key="b.id">
          <td class="time-cell">{{ formatTime(b.createdAt) }}</td>
          <td>{{ b.instanceName }}</td>
          <td><span :class="['op-tag', `op-${b.operation}`]">{{ opLabel[b.operation] }}</span></td>
          <td>{{ b.source ?? b.templateName ?? "—" }}</td>
          <td><span class="block-tag">{{ b.blockKey }}</span></td>
          <td><span :class="['fmt-tag', b.format]">{{ b.format }}</span></td>
          <td>{{ sizeLabel(b.sizeBytes) }}</td>
          <td class="row-actions">
            <button class="btn btn-primary btn-sm" @click="restoreTarget = b">恢复</button>
            <button class="btn btn-danger-ghost btn-sm" @click="askDelete(b)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>

    <RestoreConfirmDialog
      v-if="restoreTarget"
      :backup="restoreTarget"
      @confirm="emit('restore', restoreTarget); restoreTarget = null"
      @cancel="restoreTarget = null"
    />
  </div>
</template>

<style scoped>
.backup-list {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-accent);
  flex-wrap: wrap;
}
.toolbar-group {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
}
.toolbar-group select {
  padding: 4px 8px;
  border: 1px solid var(--input);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.retention-group {
  display: flex;
  border: 1px solid var(--input);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.retention-btn {
  padding: 4px 10px;
  border: none;
  background: var(--bg-elevated);
  color: var(--muted);
  cursor: pointer;
  font-size: 12px;
  border-right: 1px solid var(--input);
}
.retention-btn:last-child { border-right: none; }
.retention-btn:hover { background: var(--bg-hover); }
.retention-btn.active { background: var(--accent); color: var(--primary-foreground); }
.empty {
  padding: 60px 16px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
.b-table {
  width: 100%;
  border-collapse: collapse;
}
.b-table th {
  text-align: left;
  padding: 10px 16px;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background: var(--bg-accent);
  border-bottom: 1px solid var(--border);
}
.b-table td {
  padding: 10px 16px;
  font-size: 13px;
  border-bottom: 1px solid var(--border);
}
.b-table tr:last-child td { border-bottom: none; }
.b-table tr:hover td { background: var(--bg-hover); }
.time-cell {
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
  font-size: 12px;
  white-space: nowrap;
}
.op-tag {
  display: inline-block;
  padding: 2px 8px;
  font-size: 11px;
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
  color: var(--muted);
}
.op-edit { background: rgba(37, 99, 235, 0.1); color: var(--info); }
.op-sync { background: rgba(220, 38, 38, 0.08); color: var(--accent); }
.op-template-apply { background: rgba(21, 128, 61, 0.1); color: var(--ok); }
.op-delete-block { background: rgba(220, 38, 38, 0.15); color: var(--danger); }
.op-restore { background: rgba(180, 83, 9, 0.1); color: var(--warn); }
.block-tag {
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
  font-size: 12px;
  color: var(--text);
}
.fmt-tag {
  display: inline-block;
  padding: 2px 6px;
  font-size: 11px;
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
  color: var(--muted);
}
.fmt-tag.file-copy { background: rgba(180, 83, 9, 0.1); color: var(--warn); }
.row-actions { display: flex; gap: 6px; }
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
</style>

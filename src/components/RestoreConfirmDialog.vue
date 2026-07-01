<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  backup: BackupEntry;
  busy?: boolean;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const opLabel: Record<BackupEntry["operation"], string> = {
  edit: "编辑",
  sync: "同步",
  "template-apply": "模板应用",
  "delete-block": "删除块",
  restore: "恢复",
};

const timeText = computed(() => {
  try { return new Date(props.backup.createdAt).toLocaleString("zh-CN"); }
  catch { return String(props.backup.createdAt); }
});
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('cancel')">
      <div class="modal">
        <h2>确认恢复备份</h2>
        <p class="desc">将用以下备份覆盖当前 <code>openclaw.json</code>:</p>
        <ul class="info">
          <li><span class="lbl">时间:</span><span class="val">{{ timeText }}</span></li>
          <li><span class="lbl">实例:</span><span class="val">{{ backup.instanceName }}</span></li>
          <li><span class="lbl">操作:</span><span class="val">{{ opLabel[backup.operation] }}</span></li>
          <li v-if="backup.source"><span class="lbl">来源:</span><span class="val">{{ backup.source }}</span></li>
          <li v-if="backup.templateName"><span class="lbl">模板:</span><span class="val">{{ backup.templateName }}</span></li>
          <li><span class="lbl">块:</span><span class="val">{{ backup.blockKey }}</span></li>
          <li><span class="lbl">格式:</span><span class="val">{{ backup.format }}</span></li>
        </ul>
        <p class="warn">恢复前会自动备份当前文件,以便再次回滚。</p>
        <div class="actions">
          <button class="btn btn-ghost" :disabled="busy" @click="emit('cancel')">取消</button>
          <button class="btn btn-primary" :disabled="busy" @click="emit('confirm')">
            {{ busy ? "恢复中..." : "确认恢复" }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  animation: fade-in 0.15s ease-out;
}
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.modal {
  background: var(--popover);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  padding: 24px;
  width: 480px;
  max-width: 90vw;
  box-shadow: var(--shadow-lg);
}
.modal h2 {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-strong);
  margin-bottom: 12px;
}
.desc {
  font-size: 13px;
  color: var(--text);
  margin-bottom: 12px;
}
.desc code {
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
  font-size: 12px;
  padding: 1px 6px;
  background: var(--bg-muted);
  border-radius: var(--radius-sm);
}
.info {
  list-style: none;
  margin: 0 0 12px;
  padding: 12px 14px;
  background: var(--bg-accent);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 13px;
}
.info li {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
}
.lbl { color: var(--muted); }
.val { color: var(--text-strong); font-weight: 500; }
.warn {
  font-size: 12px;
  color: var(--warn);
  margin-bottom: 16px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: var(--accent); color: var(--primary-foreground); }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--muted); }
.btn-ghost:hover:not(:disabled) { border-color: var(--border-hover); color: var(--text); }
</style>

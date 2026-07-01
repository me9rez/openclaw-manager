<script setup lang="ts">
import { ref, watch, computed } from "vue";

const props = defineProps<{
  blockKey: string;
  initialContent: string;
  parseError: string | null;
  dirty: boolean;
  saving: boolean;
  protectedNote?: string;
  hasBlock: boolean;
}>();

const emit = defineEmits<{
  update: [text: string];
  save: [];
  cancel: [];
  delete: [];
  saveAsTemplate: [];
}>();

const textareaRef = ref<HTMLTextAreaElement | null>(null);

const charCount = computed(() => props.initialContent.length);
const lineCount = computed(() => props.initialContent.split("\n").length);

function onInput(e: Event) {
  const v = (e.target as HTMLTextAreaElement).value;
  emit("update", v);
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === "Tab" && textareaRef.value) {
    e.preventDefault();
    const ta = textareaRef.value;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const v = ta.value;
    const next = v.substring(0, start) + "  " + v.substring(end);
    ta.value = next;
    ta.selectionStart = ta.selectionEnd = start + 2;
    emit("update", next);
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    if (!props.parseError && props.dirty && !props.saving) emit("save");
  }
}
</script>

<template>
  <div class="editor">
    <div class="editor-header">
      <div class="header-left">
        <span class="block-key">{{ blockKey }}</span>
        <span v-if="hasBlock" class="hint">已存在</span>
        <span v-else class="hint new">将创建新块</span>
      </div>
      <div class="header-right">
        <span class="meta">{{ lineCount }} 行 · {{ charCount }} 字符</span>
      </div>
    </div>

    <div v-if="protectedNote" class="protected-banner">{{ protectedNote }}</div>

    <textarea
      ref="textareaRef"
      class="json-area"
      :value="initialContent"
      spellcheck="false"
      :placeholder="'{\n  \u0022\u0022: \u0022\u0022\n}'"
      @input="onInput"
      @keydown="onKeyDown"
    />

    <div v-if="parseError" class="error-line">JSON 解析错误: {{ parseError }}</div>

    <div class="actions">
      <button class="btn btn-ghost" :disabled="saving" @click="emit('cancel')">取消</button>
      <button v-if="hasBlock" class="btn btn-danger-ghost" :disabled="saving" @click="emit('delete')">删除此块</button>
      <button class="btn btn-secondary" :disabled="saving" @click="emit('saveAsTemplate')">另存为模板</button>
      <button class="btn btn-primary" :disabled="saving || !!parseError || !dirty" @click="emit('save')">
        {{ saving ? "保存中..." : dirty ? "保存 (Ctrl+S)" : "未修改" }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.editor {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-accent);
}
.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.block-key {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-strong);
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
}
.hint {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
  color: var(--muted);
}
.hint.new {
  background: rgba(37, 99, 235, 0.1);
  color: var(--info);
}
.meta {
  font-size: 11px;
  color: var(--muted);
}
.protected-banner {
  padding: 8px 16px;
  background: rgba(180, 83, 9, 0.08);
  border-bottom: 1px solid rgba(180, 83, 9, 0.2);
  color: var(--warn);
  font-size: 12px;
}
.json-area {
  flex: 1;
  width: 100%;
  min-height: 320px;
  padding: 14px 16px;
  border: none;
  outline: none;
  resize: none;
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-strong);
  background: var(--bg-elevated);
  tab-size: 2;
}
.error-line {
  padding: 8px 16px;
  background: rgba(220, 38, 38, 0.08);
  border-top: 1px solid rgba(220, 38, 38, 0.2);
  color: var(--danger);
  font-size: 12px;
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  background: var(--bg-accent);
  flex-wrap: wrap;
}
.btn {
  padding: 7px 16px;
  border: none;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-primary {
  background: var(--accent);
  color: var(--primary-foreground);
}
.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}
.btn-secondary {
  background: var(--bg-muted);
  color: var(--text-strong);
}
.btn-secondary:hover:not(:disabled) {
  background: var(--bg-hover);
}
.btn-ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
}
.btn-ghost:hover:not(:disabled) {
  border-color: var(--border-hover);
  color: var(--text);
}
.btn-danger-ghost {
  background: transparent;
  border: 1px solid var(--danger);
  color: var(--danger);
}
.btn-danger-ghost:hover:not(:disabled) {
  background: var(--danger);
  color: #fff;
}
</style>

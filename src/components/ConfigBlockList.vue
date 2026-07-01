<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  blocks: BlockSummary[];
  selectedKey: string | null;
}>();

const emit = defineEmits<{
  select: [key: string];
}>();

const sorted = computed(() => [...props.blocks].sort((a, b) => a.key.localeCompare(b.key)));

function typeLabel(t: BlockSummary["type"]): string {
  const map: Record<BlockSummary["type"], string> = {
    object: "对象",
    array: "数组",
    string: "字符串",
    number: "数字",
    boolean: "布尔",
    null: "空",
  };
  return map[t];
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
</script>

<template>
  <div class="block-list">
    <div class="list-header">顶层配置块 ({{ blocks.length }})</div>
    <div v-if="blocks.length === 0" class="empty">该实例暂无配置块</div>
    <ul v-else class="list">
      <li
        v-for="b in sorted"
        :key="b.key"
        :class="['item', { active: b.key === selectedKey }]"
        @click="emit('select', b.key)"
      >
        <div class="item-main">
          <span class="key">{{ b.key }}</span>
          <span class="type">{{ typeLabel(b.type) }}<span v-if="b.type === 'object'"> · {{ b.childCount }} 项</span><span v-else-if="b.type === 'array'"> · {{ b.childCount }} 个</span></span>
        </div>
        <span class="size">{{ sizeLabel(b.size) }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.block-list {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.list-header {
  padding: 12px 16px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-accent);
}
.empty {
  padding: 24px 16px;
  color: var(--muted);
  font-size: 13px;
  text-align: center;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
}
.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  transition: background 0.1s;
}
.item:last-child {
  border-bottom: none;
}
.item:hover {
  background: var(--bg-hover);
}
.item.active {
  background: var(--accent-subtle);
  border-left: 3px solid var(--accent);
  padding-left: 13px;
}
.item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.key {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-strong);
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
}
.type {
  font-size: 11px;
  color: var(--muted);
}
.size {
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
}
</style>

<script setup lang="ts">
defineProps<{
  lines: string[];
  loading?: boolean;
  sourceLabel: string;
  targetLabel: string;
}>();
</script>

<template>
  <div class="diff">
    <div v-if="loading" class="placeholder">正在计算 diff...</div>
    <div v-else-if="lines.length === 0" class="placeholder">点击「显示 diff」预览变更</div>
    <div v-else class="diff-body">
      <div class="diff-head">
        <span class="diff-tag from">--- {{ sourceLabel }}</span>
        <span class="diff-tag to">+++ {{ targetLabel }}</span>
      </div>
      <pre class="diff-pre"><template v-for="(line, idx) in lines" :key="idx"><span :class="['line', line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('@@') ? 'hunk' : 'ctx']">{{ line }}</span></template></pre>
    </div>
  </div>
</template>

<style scoped>
.diff {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  min-height: 240px;
  display: flex;
  flex-direction: column;
}
.placeholder {
  padding: 40px 16px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
.diff-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.diff-head {
  display: flex;
  justify-content: space-between;
  padding: 8px 16px;
  background: var(--bg-accent);
  border-bottom: 1px solid var(--border);
  font-size: 11px;
}
.diff-tag {
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
  font-weight: 600;
}
.diff-tag.from { color: var(--danger); }
.diff-tag.to { color: var(--ok); }
.diff-pre {
  flex: 1;
  margin: 0;
  padding: 0;
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
  font-size: 12px;
  line-height: 1.6;
  overflow: auto;
  background: var(--bg-elevated);
}
.line {
  display: block;
  padding: 0 16px;
  white-space: pre;
}
.line.add {
  background: rgba(21, 128, 61, 0.1);
  color: var(--ok);
}
.line.del {
  background: rgba(220, 38, 38, 0.08);
  color: var(--danger);
}
.line.hunk {
  background: var(--bg-accent);
  color: var(--muted);
  font-weight: 600;
}
.line.ctx {
  color: var(--text);
}
</style>

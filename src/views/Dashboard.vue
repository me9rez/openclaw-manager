<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useInstancesStore } from "../stores/instances";
import InstanceCard from "../components/InstanceCard.vue";

const emit = defineEmits<{
  select: [name: string];
}>();

const store = useInstancesStore();
const showCreate = ref(false);
const createName = ref("");
const createVersion = ref("");
const createError = ref("");
const availableVersions = ref<string[]>([]);
const creating = ref(false);

const INSTANCE_NAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5][a-zA-Z0-9_\-]*$/;

function validateInstanceName(name: string): string | null {
  if (!name) return "实例名称不能为空";
  if (!INSTANCE_NAME_RE.test(name)) {
    return "仅允许字母、数字、下划线、连字符，且不能以连字符开头";
  }
  return null;
}

let cleanupStatus: (() => void) | null = null;

onMounted(async () => {
  await store.fetchList();
  store.setupListeners();

  cleanupStatus = window.api.instances.onStatusChanged(() => {
    store.fetchList();
  });

  const installed = await window.api.versions.listInstalled();
  availableVersions.value = installed;
});

onUnmounted(() => {
  cleanupStatus?.();
});

async function handleRemove(name: string) {
  const inst = store.instances.find((i) => i.name === name);
  if (!inst) return;
  const isRunning = inst.status === "running" || inst.status === "starting" || inst.status === "reconnecting";
  const ok = await store.confirmRemove(name, isRunning);
  if (!ok) return;
  await store.remove(name);
}

async function handleCreate() {
  createError.value = "";
  const err = validateInstanceName(createName.value.trim());
  if (err) {
    createError.value = err;
    return;
  }
  if (!createVersion.value) return;
  creating.value = true;
  try {
    await store.create({
      name: createName.value.trim(),
      version: createVersion.value,
    });
    createName.value = "";
    createVersion.value = "";
    showCreate.value = false;
  } catch (err) {
    createError.value = (err as Error).message;
  } finally {
    creating.value = false;
  }
}

function statusCount(status: string): number {
  return store.instances.filter((i) => i.status === status).length;
}
</script>

<template>
  <div class="dashboard">
    <div class="page-header">
      <h1>实例列表</h1>
      <div class="header-actions">
        <div class="stats">
          <span class="stat">
            <span class="stat-dot" style="background: var(--ok)"></span>
            {{ statusCount("running") }} 运行中
          </span>
          <span class="stat">
            <span class="stat-dot" style="background: var(--muted)"></span>
            {{ statusCount("stopped") + statusCount("installed") }} 已停止
          </span>
          <span class="stat">
            <span class="stat-dot" style="background: var(--warn)"></span>
            {{ statusCount("reconnecting") }} 重新连接中
          </span>
          <span class="stat">
            <span class="stat-dot" style="background: var(--danger)"></span>
            {{ statusCount("error") + statusCount("crashed") }} 错误
          </span>
        </div>
        <button class="btn btn-primary" @click="showCreate = true">+ 新建实例</button>
      </div>
    </div>

    <div v-if="store.error" class="error-banner">{{ store.error }}</div>

    <div v-if="store.instances.length === 0" class="empty-state">
      <div class="empty-icon">⚡</div>
      <p>暂无实例</p>
      <p class="empty-sub">创建一个 OpenClaw 实例来开始使用</p>
      <button class="btn btn-primary" @click="showCreate = true">+ 创建实例</button>
    </div>

    <div v-else class="grid">
      <InstanceCard
        v-for="inst in store.instances"
        :key="inst.name"
        :instance="inst"
        @start="store.start"
        @stop="store.stop"
        @restart="store.restart"
        @remove="handleRemove"
        @select="emit('select', $event)"
      />
    </div>

    <Teleport to="body">
      <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
        <div class="modal">
          <h2>创建实例</h2>
          <div class="form-group">
            <label>实例名称</label>
            <input v-model="createName" type="text" placeholder="例如: test-v1" class="input" />
            <p v-if="createError" class="form-error">{{ createError }}</p>
          </div>
          <div class="form-group">
            <label>版本</label>
            <select v-model="createVersion" class="input">
              <option value="" disabled>选择一个版本</option>
              <option v-for="v in availableVersions" :key="v" :value="v">{{ v }}</option>
            </select>
            <p v-if="availableVersions.length === 0" class="help-text">
              尚未安装任何版本，请先到「版本管理」页面下载。
            </p>
          </div>
          <div class="modal-actions">
            <button class="btn btn-ghost" @click="showCreate = false">取消</button>
            <button
              class="btn btn-primary"
              :disabled="creating || !createName.trim() || !createVersion"
              @click="handleCreate"
            >
              {{ creating ? "创建中..." : "创建" }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.dashboard {
  max-width: 1200px;
  margin: 0 auto;
  animation: fade-in 0.25s ease-out;
}
@keyframes fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 12px;
}
.page-header h1 {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-strong);
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}
.stats {
  display: flex;
  gap: 12px;
  font-size: 13px;
  color: var(--muted);
}
.stat {
  display: flex;
  align-items: center;
  gap: 4px;
}
.stat-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
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
.btn-primary {
  background: var(--accent);
  color: var(--primary-foreground);
}
.btn-primary:hover {
  background: var(--accent-hover);
}
.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
}
.btn-ghost:hover {
  border-color: var(--border-hover);
  color: var(--text);
}
.error-banner {
  background: var(--accent-subtle);
  border: 1px solid var(--accent);
  border-radius: var(--radius-md);
  padding: 10px 16px;
  font-size: 13px;
  color: var(--accent);
  margin-bottom: 16px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}
.empty-state {
  text-align: center;
  padding: 80px 24px;
  color: var(--muted);
}
.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}
.empty-state p {
  font-size: 18px;
  margin-bottom: 8px;
}
.empty-sub {
  font-size: 14px;
  color: var(--muted-foreground);
  margin-bottom: 24px;
}
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fade-in 0.15s ease-out;
}
.modal {
  background: var(--popover);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  padding: 24px;
  width: 420px;
  max-width: 90vw;
  box-shadow: var(--shadow-lg);
}
.modal h2 {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-strong);
  margin-bottom: 20px;
}
.form-group {
  margin-bottom: 16px;
}
.form-group label {
  display: block;
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 6px;
}
.input {
  width: 100%;
  padding: 10px 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--input);
  border-radius: var(--radius-md);
  color: var(--text);
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
}
.input:focus {
  border-color: var(--accent);
}
select.input {
  cursor: pointer;
}
.help-text {
  font-size: 12px;
  color: var(--muted);
  margin-top: 4px;
}
.form-error {
  font-size: 12px;
  color: var(--danger);
  margin-top: 4px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
</style>

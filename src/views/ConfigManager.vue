<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useConfigStore } from "../stores/config";
import ConfigBlockList from "../components/ConfigBlockList.vue";
import ConfigBlockEditor from "../components/ConfigBlockEditor.vue";
import ConfigDiffViewer from "../components/ConfigDiffViewer.vue";
import ConfigTemplateList from "../components/ConfigTemplateList.vue";
import ConfigBackupList from "../components/ConfigBackupList.vue";

type SubTab = "instance" | "sync" | "templates" | "backups";

const store = useConfigStore();
const subTab = ref<SubTab>("instance");

const selectedInstance = ref<string>("");
const selectedBlock = ref<string>("");
const blockContentLoaded = ref<unknown>(null);

const showNewBlockInput = ref(false);
const newBlockKey = ref("");

const syncSource = ref<string>("");
const syncBlock = ref<string>("");
const syncTargets = ref<string[]>([]);
const syncDiff = ref<string[]>([]);
const syncDiffLoading = ref(false);
const syncRunning = ref(false);

const applyTargetTemplate = ref<string>("");
const applyTargets = ref<string[]>([]);
const applyRunning = ref(false);

const showNewTplDialog = ref(false);
const newTplName = ref("");
const newTplDesc = ref("");

const showEditTplDialog = ref(false);
const editingTplId = ref<string>("");
const editTplName = ref("");
const editTplDesc = ref("");
const editTplContent = ref("");

const toastMsg = ref<string | null>(null);
const toastKind = ref<"ok" | "err" | "info">("ok");

function showToast(msg: string, kind: "ok" | "err" | "info" = "ok") {
  toastMsg.value = msg;
  toastKind.value = kind;
  setTimeout(() => { toastMsg.value = null; }, 4000);
}

const currentBlocks = computed(() => {
  if (!selectedInstance.value) return [];
  return store.blocksByInstance[selectedInstance.value] ?? [];
});

const currentBlockExists = computed(() => {
  if (!selectedBlock.value) return false;
  return currentBlocks.value.some((b) => b.key === selectedBlock.value);
});

const protectedNote = computed(() => {
  if (selectedBlock.value === "gateway") {
    return "提示:gateway.auth.token 由管理器管理,同步与编辑时不会覆盖。";
  }
  return undefined;
});

const isProtectedFieldChanged = computed(() => {
  if (selectedBlock.value !== "gateway" || blockContentLoaded.value === undefined) return false;
  try {
    const original = JSON.parse(JSON.stringify(blockContentLoaded.value));
    const draft = JSON.parse(store.blockDraft);
    const origToken = original?.auth?.token;
    const draftToken = draft?.auth?.token;
    if (origToken && origToken !== draftToken) return true;
  } catch { /* ignore */ }
  return false;
});

onMounted(async () => {
  await store.loadInstances();
  await store.loadRetention();
  if (store.instances.length > 0) {
    selectedInstance.value = store.instances[0].name;
    syncSource.value = store.instances[0].name;
    await store.loadBlocks(selectedInstance.value);
  }
  await store.loadTemplates();
  await store.loadBackups(null);
  await store.loadRetention();
});

watch(selectedInstance, async (v, old) => {
  if (v && v !== old) {
    selectedBlock.value = "";
    blockContentLoaded.value = null;
    store.resetBlockDraft("");
    await store.loadBlocks(v);
  }
});

watch(selectedBlock, async (v) => {
  if (!v || !selectedInstance.value) return;
  const content = await store.loadBlockContent(selectedInstance.value, v);
  blockContentLoaded.value = content ?? null;
  const text = content === undefined ? "{\n  \n}" : JSON.stringify(content, null, 2);
  store.resetBlockDraft(text);
});

watch(syncSource, async (v) => {
  syncBlock.value = "";
  syncDiff.value = [];
  if (!v) return;
  await store.loadBlocks(v);
});

watch(syncBlock, async (v) => {
  if (!v || !syncSource.value) {
    syncDiff.value = [];
    return;
  }
  await refreshSyncDiff();
});

async function refreshSyncDiff() {
  if (!syncSource.value || !syncBlock.value || syncTargets.value.length === 0) {
    syncDiff.value = [];
    return;
  }
  const sourceContent = await store.loadBlockContent(syncSource.value, syncBlock.value);
  if (!syncTargets.value[0]) return;
  const targetContent = await store.loadBlockContent(syncTargets.value[0], syncBlock.value);
  syncDiffLoading.value = true;
  try {
    syncDiff.value = await store.diffBlock(targetContent ?? null, sourceContent ?? null);
  } finally {
    syncDiffLoading.value = false;
  }
}

watch(syncTargets, () => { refreshSyncDiff(); });

function selectBlock(key: string) {
  selectedBlock.value = key;
  showNewBlockInput.value = false;
}

function startNewBlock() {
  showNewBlockInput.value = true;
  newBlockKey.value = "";
  selectedBlock.value = "";
  blockContentLoaded.value = null;
  store.resetBlockDraft("{\n  \n}");
}

async function confirmNewBlock() {
  const k = newBlockKey.value.trim();
  if (!k) return;
  selectedBlock.value = k;
  showNewBlockInput.value = false;
  blockContentLoaded.value = null;
  store.resetBlockDraft("{\n  \n}");
}

async function onSave() {
  if (!selectedInstance.value || !selectedBlock.value) return;
  let content: unknown;
  try {
    content = JSON.parse(store.blockDraft);
  } catch (e) {
    showToast("JSON 解析失败: " + (e as Error).message, "err");
    return;
  }
  const result = await store.saveBlock(selectedInstance.value, selectedBlock.value, content);
  if (result.ok) {
    const note = isProtectedFieldChanged.value ? " (gateway.auth.token 已被强制保留)" : "";
    showToast(`已保存到 ${selectedInstance.value}/openclaw.json${note}`, "ok");
    await store.loadBackups(null);
  } else {
    showToast("保存失败: " + (result.error ?? "未知错误"), "err");
  }
}

async function onDeleteBlock() {
  if (!selectedInstance.value || !selectedBlock.value) return;
  if (!confirm(`确认删除实例 "${selectedInstance.value}" 的 "${selectedBlock.value}" 块?`)) return;
  const result = await store.deleteBlock(selectedInstance.value, selectedBlock.value);
  if (result.ok) {
    showToast(`已删除块 ${selectedBlock.value}`, "ok");
    selectedBlock.value = "";
    blockContentLoaded.value = null;
    store.resetBlockDraft("");
    await store.loadBackups(null);
  } else {
    showToast("删除失败: " + (result.error ?? "未知错误"), "err");
  }
}

function onCancel() {
  if (blockContentLoaded.value === null) {
    store.resetBlockDraft("{\n  \n}");
  } else {
    store.resetBlockDraft(JSON.stringify(blockContentLoaded.value, null, 2));
  }
}

function onSaveAsTemplate() {
  if (!selectedBlock.value) return;
  showNewTplDialog.value = true;
  newTplName.value = `${selectedInstance.value}-${selectedBlock.value}`;
  newTplDesc.value = "";
}

async function confirmCreateTemplate() {
  if (!newTplName.value.trim() || !selectedBlock.value) {
    showToast("请填写模板名称", "err");
    return;
  }
  let content: unknown;
  try {
    content = JSON.parse(store.blockDraft);
  } catch (e) {
    showToast("当前 JSON 解析失败,无法保存为模板", "err");
    return;
  }
  const t = await store.createTemplate({
    name: newTplName.value.trim(),
    description: newTplDesc.value.trim() || undefined,
    blockKey: selectedBlock.value,
    content,
  });
  if (t) {
    showToast(`已创建模板 "${t.name}"`, "ok");
    showNewTplDialog.value = false;
    newTplName.value = "";
    newTplDesc.value = "";
  } else {
    showToast("创建模板失败: " + (store.error ?? "未知错误"), "err");
  }
}

async function performSync() {
  if (!syncSource.value || !syncBlock.value || syncTargets.value.length === 0) {
    showToast("请选择源实例、块和至少一个目标", "err");
    return;
  }
  if (!confirm(`确认将 "${syncBlock.value}" 块从 ${syncSource.value} 同步到 ${syncTargets.value.length} 个目标实例?`)) return;
  syncRunning.value = true;
  try {
    const r = await store.syncBlock(syncSource.value, syncBlock.value, syncTargets.value);
    if (r.ok) {
      showToast(`已同步到 ${r.results.length} 个实例`, "ok");
    } else {
      const failed = r.results.filter((x) => !x.ok);
      showToast(`部分失败:${failed.map((f) => `${f.name}(${f.error})`).join("; ")}`, "err");
    }
    await store.loadBackups(null);
  } finally {
    syncRunning.value = false;
  }
}

const allBlockKeysForSource = computed(() => {
  if (!syncSource.value) return [];
  return (store.blocksByInstance[syncSource.value] ?? []).map((b) => b.key);
});

function openApplyTemplate(tplId: string) {
  applyTargetTemplate.value = tplId;
  applyTargets.value = [];
}

async function performApplyTemplate() {
  if (!applyTargetTemplate.value || applyTargets.value.length === 0) {
    showToast("请选择目标和模板", "err");
    return;
  }
  applyRunning.value = true;
  try {
    const r = await store.applyTemplate(applyTargetTemplate.value, applyTargets.value);
    if (r.ok) {
      showToast(`已应用模板到 ${r.results.length} 个实例`, "ok");
    } else {
      const failed = r.results.filter((x) => !x.ok);
      showToast(`部分失败:${failed.map((f) => `${f.name}(${f.error})`).join("; ")}`, "err");
    }
    applyTargetTemplate.value = "";
    applyTargets.value = [];
    await store.loadBackups(null);
  } finally {
    applyRunning.value = false;
  }
}

function openEditTemplate(tpl: ConfigTemplate) {
  editingTplId.value = tpl.id;
  editTplName.value = tpl.name;
  editTplDesc.value = tpl.description ?? "";
  editTplContent.value = JSON.stringify(tpl.content, null, 2);
  showEditTplDialog.value = true;
}

async function confirmEditTemplate() {
  if (!editingTplId.value) return;
  let content: unknown;
  try {
    content = JSON.parse(editTplContent.value);
  } catch (e) {
    showToast("JSON 解析失败: " + (e as Error).message, "err");
    return;
  }
  const t = await store.updateTemplate(editingTplId.value, {
    name: editTplName.value.trim() || undefined,
    description: editTplDesc.value.trim() || undefined,
    content,
  });
  if (t) {
    showToast("模板已更新", "ok");
    showEditTplDialog.value = false;
  } else {
    showToast("更新失败: " + (store.error ?? "未知错误"), "err");
  }
}

async function onDeleteTemplate(id: string) {
  const t = store.templates.find((x) => x.id === id);
  if (!t) return;
  if (!confirm(`确认删除模板 "${t.name}"?`)) return;
  await store.deleteTemplate(id);
  showToast("模板已删除", "ok");
}

async function onRestoreBackup(b: BackupEntry) {
  const r = await store.restoreBackup(b.instanceName, b.id);
  if (r.ok) {
    showToast(`已从备份 ${b.id} 恢复`, "ok");
    if (selectedInstance.value === b.instanceName) {
      await store.loadBlocks(selectedInstance.value);
    }
  } else {
    showToast("恢复失败: " + (r.error ?? "未知错误"), "err");
  }
}

async function onDeleteBackup(_b: BackupEntry) {
  showToast("备份已删除", "ok");
}

function toggleTarget(name: string) {
  const i = syncTargets.value.indexOf(name);
  if (i === -1) syncTargets.value = [...syncTargets.value, name];
  else syncTargets.value = syncTargets.value.filter((n) => n !== name);
}

function toggleApplyTarget(name: string) {
  const i = applyTargets.value.indexOf(name);
  if (i === -1) applyTargets.value = [...applyTargets.value, name];
  else applyTargets.value = applyTargets.value.filter((n) => n !== name);
}
</script>

<template>
  <div class="config-mgr">
    <div class="page-header">
      <h1>配置块管理</h1>
      <p class="subtitle">在各实例的 openclaw.json 间查看、编辑、同步顶层配置块,管理命名模板与备份</p>
    </div>

    <div v-if="store.error" class="error-banner">
      {{ store.error }}
      <button class="dismiss" @click="store.clearError()">×</button>
    </div>

    <div v-if="toastMsg" :class="['toast', `toast-${toastKind}`]">{{ toastMsg }}</div>

    <div class="subtabs">
      <button :class="['subtab', { active: subTab === 'instance' }]" @click="subTab = 'instance'">实例配置</button>
      <button :class="['subtab', { active: subTab === 'sync' }]" @click="subTab = 'sync'">跨实例同步</button>
      <button :class="['subtab', { active: subTab === 'templates' }]" @click="subTab = 'templates'">模板库</button>
      <button :class="['subtab', { active: subTab === 'backups' }]" @click="subTab = 'backups'">备份管理</button>
    </div>

    <div v-if="subTab === 'instance'" class="tab-body instance-tab">
      <div class="instance-toolbar">
        <label>实例</label>
        <select v-model="selectedInstance">
          <option v-for="i in store.instances" :key="i.name" :value="i.name">{{ i.name }}</option>
        </select>
        <button class="btn btn-ghost btn-sm" @click="startNewBlock">+ 新建块</button>
      </div>

      <div v-if="showNewBlockInput" class="new-block-bar">
        <input v-model="newBlockKey" type="text" placeholder="块名,例如 mcp / skills / plugins" class="input" @keydown.enter="confirmNewBlock" />
        <button class="btn btn-primary btn-sm" :disabled="!newBlockKey.trim()" @click="confirmNewBlock">确认</button>
        <button class="btn btn-ghost btn-sm" @click="showNewBlockInput = false">取消</button>
      </div>

      <div class="instance-grid">
        <div class="left-pane">
          <ConfigBlockList
            :blocks="currentBlocks"
            :selectedKey="selectedBlock || null"
            @select="selectBlock"
          />
        </div>
        <div class="right-pane">
          <ConfigBlockEditor
            v-if="selectedBlock"
            :blockKey="selectedBlock"
            :initialContent="store.blockDraft"
            :parseError="store.blockParseError"
            :dirty="store.blockDirty"
            :saving="store.saving"
            :hasBlock="currentBlockExists"
            :protectedNote="protectedNote"
            @update="store.setBlockDraft"
            @save="onSave"
            @cancel="onCancel"
            @delete="onDeleteBlock"
            @saveAsTemplate="onSaveAsTemplate"
          />
          <div v-else class="empty-editor">
            <p>{{ showNewBlockInput ? "请在上方输入新块名后点击「确认」" : "从左侧选择一个块,或点击右上角「+ 新建块」" }}</p>
          </div>
        </div>
      </div>
    </div>

    <div v-if="subTab === 'sync'" class="tab-body sync-tab">
      <div class="sync-grid">
        <div class="sync-form">
          <div class="form-row">
            <label>1. 源实例</label>
            <select v-model="syncSource">
              <option value="" disabled>选择源实例</option>
              <option v-for="i in store.instances" :key="i.name" :value="i.name">{{ i.name }}</option>
            </select>
          </div>
          <div class="form-row">
            <label>2. 块</label>
            <select v-model="syncBlock" :disabled="!syncSource">
              <option value="" disabled>选择顶层块</option>
              <option v-for="k in allBlockKeysForSource" :key="k" :value="k">{{ k }}</option>
            </select>
          </div>
          <div class="form-row">
            <label>3. 目标实例</label>
            <div class="target-list">
              <label v-for="i in store.instances.filter((x) => x.name !== syncSource)" :key="i.name" class="target-check">
                <input type="checkbox" :checked="syncTargets.includes(i.name)" @change="toggleTarget(i.name)" />
                <span>{{ i.name }}</span>
              </label>
              <div v-if="store.instances.filter((x) => x.name !== syncSource).length === 0" class="empty-hint">暂无其他实例</div>
            </div>
          </div>
          <div class="form-row">
            <label>4. 预览 diff</label>
            <button class="btn btn-ghost btn-sm" :disabled="!syncSource || !syncBlock || syncTargets.length === 0" @click="refreshSyncDiff">重新计算 diff</button>
          </div>
          <div class="sync-warning">
            同步前将为每个目标实例自动创建 tar.gz 备份(可通过 <code>openclaw backup verify</code> 校验)。同步后需重启目标实例才能生效。
          </div>
          <button
            class="btn btn-primary"
            :disabled="syncRunning || !syncSource || !syncBlock || syncTargets.length === 0"
            @click="performSync"
          >{{ syncRunning ? "同步中..." : `同步到 ${syncTargets.length} 个实例` }}</button>
        </div>
        <div class="sync-diff">
          <ConfigDiffViewer
            :lines="syncDiff"
            :loading="syncDiffLoading"
            :sourceLabel="`${syncSource}/${syncBlock}`"
            :targetLabel="syncTargets[0] ? `${syncTargets[0]}/${syncBlock}` : '(选择目标)'"
          />
        </div>
      </div>
    </div>

    <div v-if="subTab === 'templates'" class="tab-body">
      <ConfigTemplateList
        :templates="store.templates"
        @apply="openApplyTemplate"
        @edit="(id) => { const t = store.templates.find((x) => x.id === id); if (t) openEditTemplate(t); }"
        @delete="onDeleteTemplate"
        @new="showNewTplDialog = true"
      />

      <div v-if="applyTargetTemplate" class="apply-bar">
        <span>应用模板: <strong>{{ store.templates.find((t) => t.id === applyTargetTemplate)?.name }}</strong></span>
        <div class="apply-targets">
          <label v-for="i in store.instances" :key="i.name" class="target-check">
            <input type="checkbox" :checked="applyTargets.includes(i.name)" @change="toggleApplyTarget(i.name)" />
            <span>{{ i.name }}</span>
          </label>
        </div>
        <button class="btn btn-primary btn-sm" :disabled="applyRunning || applyTargets.length === 0" @click="performApplyTemplate">
          {{ applyRunning ? "应用中..." : `应用到 ${applyTargets.length} 个` }}
        </button>
        <button class="btn btn-ghost btn-sm" @click="applyTargetTemplate = ''">取消</button>
      </div>
    </div>

    <div v-if="subTab === 'backups'" class="tab-body">
      <ConfigBackupList
        :backups="store.backups"
        :instances="store.instances"
        :retention="store.backupRetention"
        :selectedInstance="store.selectedInstanceForBackups"
        @changeInstance="(v) => store.loadBackups(v)"
        @changeRetention="(v) => store.setRetention(v)"
        @refresh="store.loadBackups(store.selectedInstanceForBackups)"
        @restore="onRestoreBackup"
        @delete="onDeleteBackup"
      />
    </div>

    <Teleport to="body">
      <div v-if="showNewTplDialog" class="modal-overlay" @click.self="showNewTplDialog = false">
        <div class="modal">
          <h2>新建模板</h2>
          <p class="desc">基于当前 <code>{{ selectedBlock }}</code> 块的内容创建命名模板,稍后可一键应用到任意实例。</p>
          <div class="form-group">
            <label>模板名称 *</label>
            <input v-model="newTplName" class="input" placeholder="例如:公司 mcp / 默认插件" />
          </div>
          <div class="form-group">
            <label>描述(可选)</label>
            <input v-model="newTplDesc" class="input" placeholder="简短说明" />
          </div>
          <div class="modal-actions">
            <button class="btn btn-ghost" @click="showNewTplDialog = false">取消</button>
            <button class="btn btn-primary" :disabled="!newTplName.trim()" @click="confirmCreateTemplate">创建</button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showEditTplDialog" class="modal-overlay" @click.self="showEditTplDialog = false">
        <div class="modal wide">
          <h2>编辑模板</h2>
          <div class="form-group">
            <label>名称</label>
            <input v-model="editTplName" class="input" />
          </div>
          <div class="form-group">
            <label>描述</label>
            <input v-model="editTplDesc" class="input" />
          </div>
          <div class="form-group">
            <label>内容 (JSON)</label>
            <textarea v-model="editTplContent" class="input json-input" spellcheck="false" />
          </div>
          <div class="modal-actions">
            <button class="btn btn-ghost" @click="showEditTplDialog = false">取消</button>
            <button class="btn btn-primary" @click="confirmEditTemplate">保存</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.config-mgr {
  max-width: 1200px;
  margin: 0 auto;
  animation: fade-in 0.25s ease-out;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 100%;
}
@keyframes fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.page-header h1 {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-strong);
  margin-bottom: 4px;
}
.subtitle {
  font-size: 13px;
  color: var(--muted);
}
.error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--accent-subtle);
  border: 1px solid var(--accent);
  border-radius: var(--radius-md);
  padding: 10px 16px;
  font-size: 13px;
  color: var(--accent);
}
.dismiss {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 18px;
  padding: 0 4px;
}
.toast {
  padding: 10px 16px;
  border-radius: var(--radius-md);
  font-size: 13px;
  border: 1px solid;
  animation: slide-in 0.2s ease-out;
}
@keyframes slide-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
.toast-ok { background: rgba(21, 128, 61, 0.08); border-color: var(--ok); color: var(--ok); }
.toast-err { background: var(--accent-subtle); border-color: var(--accent); color: var(--accent); }
.toast-info { background: rgba(37, 99, 235, 0.08); border-color: var(--info); color: var(--info); }
.subtabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
}
.subtab {
  background: none;
  border: none;
  color: var(--muted);
  padding: 10px 18px;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s;
  border-bottom: 2px solid transparent;
}
.subtab:hover { color: var(--text); background: var(--bg-hover); }
.subtab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  background: var(--accent-subtle);
}
.tab-body {
  flex: 1;
  min-height: 0;
}
.instance-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.instance-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}
.instance-toolbar label {
  font-size: 13px;
  color: var(--muted);
}
.instance-toolbar select {
  flex: 0 0 auto;
  min-width: 200px;
  padding: 7px 10px;
  border: 1px solid var(--input);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}
.new-block-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-accent);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.new-block-bar .input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--input);
  border-radius: var(--radius-sm);
  font-size: 13px;
  background: var(--bg-elevated);
  color: var(--text);
}
.instance-grid {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 16px;
  min-height: 480px;
  height: calc(100vh - 320px);
}
.left-pane, .right-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.empty-editor {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 40px 24px;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sync-tab {
  padding-top: 4px;
}
.sync-grid {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 16px;
  min-height: 480px;
  height: calc(100vh - 260px);
}
.sync-form {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}
.form-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.form-row label {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}
.form-row select {
  padding: 7px 10px;
  border: 1px solid var(--input);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}
.form-row select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.target-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow-y: auto;
  padding: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.target-check {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
  border-radius: var(--radius-sm);
}
.target-check:hover { background: var(--bg-hover); }
.target-check input { cursor: pointer; }
.empty-hint {
  padding: 12px;
  text-align: center;
  color: var(--muted);
  font-size: 12px;
}
.sync-warning {
  padding: 10px 12px;
  background: rgba(180, 83, 9, 0.08);
  border: 1px solid rgba(180, 83, 9, 0.2);
  border-radius: var(--radius-md);
  font-size: 12px;
  color: var(--warn);
  line-height: 1.6;
}
.sync-warning code {
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
  background: rgba(0, 0, 0, 0.05);
  padding: 1px 4px;
  border-radius: var(--radius-sm);
}
.sync-diff { min-height: 0; }
.apply-bar {
  margin-top: 12px;
  padding: 12px 16px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.apply-bar > span { font-size: 13px; }
.apply-targets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
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
.modal.wide { width: 720px; }
.modal h2 {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-strong);
  margin-bottom: 12px;
}
.desc {
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 16px;
}
.desc code {
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
  padding: 1px 6px;
  background: var(--bg-muted);
  border-radius: var(--radius-sm);
  color: var(--text-strong);
}
.form-group { margin-bottom: 14px; }
.form-group label {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 6px;
}
.input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--input);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 13px;
  outline: none;
}
.input:focus { border-color: var(--accent); }
.json-input {
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
  min-height: 280px;
  resize: vertical;
  tab-size: 2;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
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
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-sm { padding: 5px 12px; font-size: 12px; }
.btn-primary { background: var(--accent); color: var(--primary-foreground); }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--muted); }
.btn-ghost:hover:not(:disabled) { border-color: var(--border-hover); color: var(--text); }
</style>

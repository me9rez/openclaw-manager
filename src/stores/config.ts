import { defineStore } from "pinia";
import { ref } from "vue";

export const useConfigStore = defineStore("config", () => {
  const instances = ref<{ name: string; hasConfig: boolean }[]>([]);
  const blocksByInstance = ref<Record<string, BlockSummary[]>>({});
  const loadingBlocks = ref<Record<string, boolean>>({});
  const error = ref<string | null>(null);

  const blockDraft = ref<string>("");
  const blockDirty = ref(false);
  const blockParseError = ref<string | null>(null);
  const saving = ref(false);

  const templates = ref<ConfigTemplate[]>([]);
  const backups = ref<BackupEntry[]>([]);
  const backupRetention = ref<number | null>(20);
  const selectedInstanceForBackups = ref<string | null>(null);

  async function loadInstances() {
    try {
      instances.value = await window.api.config.listInstances();
    } catch (err) {
      error.value = String(err);
    }
  }

  async function loadBlocks(name: string) {
    loadingBlocks.value[name] = true;
    try {
      const list = await window.api.config.listBlocks(name);
      blocksByInstance.value[name] = list;
      return list;
    } catch (err) {
      error.value = String(err);
      return [];
    } finally {
      loadingBlocks.value[name] = false;
    }
  }

  async function loadBlockContent(name: string, blockKey: string): Promise<unknown> {
    try {
      const content = await window.api.config.getBlock(name, blockKey);
      return content;
    } catch (err) {
      error.value = String(err);
      return null;
    }
  }

  function setBlockDraft(text: string) {
    blockDraft.value = text;
    blockDirty.value = true;
    blockParseError.value = null;
    try {
      JSON.parse(text);
    } catch (e) {
      blockParseError.value = (e as Error).message;
    }
  }

  function resetBlockDraft(text: string) {
    blockDraft.value = text;
    blockDirty.value = false;
    blockParseError.value = null;
  }

  async function saveBlock(name: string, blockKey: string, content: unknown): Promise<SetBlockResult> {
    saving.value = true;
    error.value = null;
    try {
      const r = await window.api.config.setBlock(name, blockKey, content);
      if (!r.ok) {
        error.value = r.error ?? "保存失败";
      } else {
        blockDirty.value = false;
        await loadBlocks(name);
      }
      return r;
    } finally {
      saving.value = false;
    }
  }

  async function deleteBlock(name: string, blockKey: string): Promise<SetBlockResult> {
    saving.value = true;
    error.value = null;
    try {
      const r = await window.api.config.deleteBlock(name, blockKey);
      if (!r.ok) {
        error.value = r.error ?? "删除失败";
      } else {
        await loadBlocks(name);
      }
      return r;
    } finally {
      saving.value = false;
    }
  }

  async function diffBlock(from: unknown, to: unknown): Promise<string[]> {
    return await window.api.config.diffBlock(from, to);
  }

  async function syncBlock(sourceName: string, blockKey: string, targets: string[], mode: "overwrite" | "merge" = "overwrite"): Promise<SyncResult> {
    return await window.api.config.syncBlock(sourceName, blockKey, targets, mode);
  }

  async function loadTemplates() {
    try {
      templates.value = await window.api.config.listTemplates();
    } catch (err) {
      error.value = String(err);
    }
  }

  async function createTemplate(input: { name: string; description?: string; blockKey: string; content: unknown }): Promise<ConfigTemplate | null> {
    try {
      const t = await window.api.config.createTemplate(input);
      await loadTemplates();
      return t;
    } catch (err) {
      error.value = String(err);
      return null;
    }
  }

  async function updateTemplate(id: string, patch: { name?: string; description?: string; blockKey?: string; content?: unknown }): Promise<ConfigTemplate | undefined> {
    try {
      const t = await window.api.config.updateTemplate(id, patch);
      await loadTemplates();
      return t ?? undefined;
    } catch (err) {
      error.value = String(err);
      return undefined;
    }
  }

  async function deleteTemplate(id: string) {
    try {
      await window.api.config.deleteTemplate(id);
      await loadTemplates();
    } catch (err) {
      error.value = String(err);
    }
  }

  async function applyTemplate(templateId: string, targets: string[], mode: "overwrite" | "merge" = "overwrite"): Promise<SyncResult> {
    return await window.api.config.applyTemplate(templateId, targets, mode);
  }

  async function copyTemplate(id: string): Promise<boolean> {
    const t = templates.value.find((x) => x.id === id);
    if (!t) return false;
    try {
      await window.api.app.copyText(JSON.stringify(t.content, null, 2));
      return true;
    } catch (err) {
      error.value = String(err);
      return false;
    }
  }

  async function importOpenclawPreview(): Promise<{ canceled: boolean; preview?: ImportOpenclawPreview; error?: string }> {
    try {
      return await window.api.config.importOpenclawPreview();
    } catch (err) {
      return { canceled: false, error: String(err) };
    }
  }

  async function importTemplates(inputs: { name: string; description?: string; blockKey: string; content: unknown }[]): Promise<ConfigTemplate[]> {
    try {
      const created = await window.api.config.importTemplates(inputs);
      await loadTemplates();
      return created;
    } catch (err) {
      error.value = String(err);
      return [];
    }
  }

  async function loadBackups(instanceName: string | null) {
    selectedInstanceForBackups.value = instanceName;
    try {
      if (instanceName === null) {
        backups.value = await window.api.config.listAllBackups();
      } else {
        backups.value = await window.api.config.listBackups(instanceName);
      }
    } catch (err) {
      error.value = String(err);
    }
  }

  async function restoreBackup(instanceName: string, backupId: string) {
    try {
      const r = await window.api.config.restoreBackup(instanceName, backupId);
      if (r.ok) {
        await loadBackups(selectedInstanceForBackups.value);
      } else {
        error.value = r.error ?? "恢复失败";
      }
      return r;
    } catch (err) {
      error.value = String(err);
      return { ok: false, error: String(err) };
    }
  }

  async function deleteBackup(instanceName: string, backupId: string) {
    try {
      await window.api.config.deleteBackup(instanceName, backupId);
      await loadBackups(selectedInstanceForBackups.value);
    } catch (err) {
      error.value = String(err);
    }
  }

  async function loadRetention() {
    try {
      backupRetention.value = await window.api.config.getBackupRetention();
    } catch (err) {
      error.value = String(err);
    }
  }

  async function setRetention(count: number | null) {
    try {
      await window.api.config.setBackupRetention(count);
      backupRetention.value = count;
    } catch (err) {
      error.value = String(err);
    }
  }

  function clearError() {
    error.value = null;
  }

  return {
    instances,
    blocksByInstance,
    loadingBlocks,
    error,
    blockDraft,
    blockDirty,
    blockParseError,
    saving,
    templates,
    backups,
    backupRetention,
    selectedInstanceForBackups,
    loadInstances,
    loadBlocks,
    loadBlockContent,
    setBlockDraft,
    resetBlockDraft,
    saveBlock,
    deleteBlock,
    diffBlock,
    syncBlock,
    loadTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    applyTemplate,
    copyTemplate,
    importOpenclawPreview,
    importTemplates,
    loadBackups,
    restoreBackup,
    deleteBackup,
    loadRetention,
    setRetention,
    clearError,
  };
});

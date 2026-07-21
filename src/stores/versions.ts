import { defineStore } from "pinia";
import { ref } from "vue";

export interface AvailableVersion {
  version: string;
  publishedAt: string;
  installed: boolean;
}

const STORAGE_KEY = "openclaw-manager:available-versions";

/**
 * Normalize an error coming out of `ipcRenderer.invoke` so the UI sees a
 * human-readable message rather than the full Electron wrapper.
 *
 * When the main process throws an `Error`, `ipcRenderer.invoke` rejects
 * with `Error: Error invoking remote method '<channel>': Error: <msg>`
 * — that double "Error" + channel name is noise. This function strips
 * the prefix and unwraps to `.message` when given an Error instance.
 */
function normalizeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message.replace(
      /^Error invoking remote method '[^']+':\s*Error:\s*/,
      "",
    );
  }
  return String(err);
}

export const useVersionsStore = defineStore("versions", () => {
  const installedVersions = ref<string[]>([]);
  const availableVersions = ref<AvailableVersion[]>([]);
  const loading = ref(false);
  const installing = ref<string | null>(null);
  const error = ref<string | null>(null);

  function restoreFromCache() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AvailableVersion[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          availableVersions.value = parsed.map((v) => ({
            ...v,
            installed: installedVersions.value.includes(v.version),
          }));
        }
      }
    } catch {}
  }

  function saveToCache() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(availableVersions.value));
    } catch {}
  }

  async function fetchInstalled() {
    try {
      installedVersions.value = await window.api.versions.listInstalled();
      availableVersions.value = availableVersions.value.map((v) => ({
        ...v,
        installed: installedVersions.value.includes(v.version),
      }));
    } catch (err) {
      error.value = normalizeError(err);
    }
  }

  async function fetchAvailable(force = false) {
    loading.value = true;
    error.value = null;
    try {
      const list = await window.api.versions.listAvailable(force);
      const installed = installedVersions.value;
      availableVersions.value = list.map((v) => ({
        ...v,
        installed: installed.includes(v.version),
      }));
      saveToCache();
    } catch (err) {
      error.value = normalizeError(err);
    } finally {
      loading.value = false;
    }
  }

  async function install(version: string) {
    installing.value = version;
    error.value = null;
    try {
      await window.api.versions.install(version);
      await fetchInstalled();
      await fetchAvailable();
    } catch (err) {
      error.value = normalizeError(err);
    } finally {
      installing.value = null;
    }
  }

  async function remove(version: string) {
    error.value = null;
    try {
      await window.api.versions.remove(version);
      await fetchInstalled();
      availableVersions.value = availableVersions.value.map((v) =>
        v.version === version ? { ...v, installed: false } : v,
      );
      saveToCache();
    } catch (err) {
      error.value = normalizeError(err);
    }
  }

  return {
    installedVersions,
    availableVersions,
    loading,
    installing,
    error,
    restoreFromCache,
    fetchInstalled,
    fetchAvailable,
    install,
    remove,
  };
});

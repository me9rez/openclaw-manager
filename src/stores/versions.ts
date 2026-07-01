import { defineStore } from "pinia";
import { ref } from "vue";

export interface AvailableVersion {
  version: string;
  publishedAt: string;
  installed: boolean;
}

const STORAGE_KEY = "openclaw-manager:available-versions";

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
      error.value = String(err);
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
      error.value = String(err);
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
      error.value = String(err);
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
      error.value = String(err);
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

import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * Normalize an error coming out of `ipcRenderer.invoke` so the UI sees a
 * human-readable message rather than the full Electron wrapper. See
 * `src/stores/versions.ts` for the same helper.
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

export interface InstanceInfo {
  name: string;
  version: string;
  port: number;
  token: string;
  status: InstanceStatus;
  statusMessage?: string;
  startedAt?: number;
  health?: { version?: string; uptime?: number };
}

type InstanceStatus = "installed" | "starting" | "running" | "stopping" | "stopped" | "reconnecting" | "error" | "crashed";

export const useInstancesStore = defineStore("instances", () => {
  const instances = ref<InstanceInfo[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchList() {
    loading.value = true;
    error.value = null;
    try {
      instances.value = await window.api.instances.list();
    } catch (err) {
      error.value = normalizeError(err);
    } finally {
      loading.value = false;
    }
  }

  async function create(params: { name: string; version: string; port?: number }): Promise<CreateInstanceResult> {
    error.value = null;
    try {
      const result = await window.api.instances.create(params);
      await fetchList();
      return result;
    } catch (err) {
      error.value = normalizeError(err);
      throw err;
    }
  }

  async function start(name: string) {
    try {
      await window.api.instances.start(name);
    } catch (err) {
      error.value = normalizeError(err);
    }
  }

  async function stop(name: string) {
    try {
      await window.api.instances.stop(name);
    } catch (err) {
      error.value = normalizeError(err);
    }
  }

  async function restart(name: string) {
    try {
      await window.api.instances.restart(name);
    } catch (err) {
      error.value = normalizeError(err);
    }
  }

  async function confirmRemove(name: string, isRunning: boolean): Promise<boolean> {
    try {
      return await window.api.instances.confirmRemove(name, isRunning);
    } catch (err) {
      error.value = normalizeError(err);
      return false;
    }
  }

  async function remove(name: string) {
    error.value = null;
    try {
      await window.api.instances.remove(name);
      await fetchList();
    } catch (err) {
      error.value = normalizeError(err);
    }
  }

  async function updatePort(name: string, port: number): Promise<{ port: number }> {
    error.value = null;
    try {
      const result = await window.api.instances.updatePort(name, port);
      await fetchList();
      return result;
    } catch (err) {
      error.value = normalizeError(err);
      throw err;
    }
  }

  async function checkConfigConsistency(name: string): Promise<ConfigConsistencyResult> {
    try {
      return await window.api.instances.checkConfigConsistency(name);
    } catch (err) {
      error.value = normalizeError(err);
      throw err;
    }
  }

  async function forceReconnect(name: string) {
    error.value = null;
    try {
      await window.api.instances.forceReconnect(name);
    } catch (err) {
      error.value = normalizeError(err);
    }
  }

  async function stopReconnect(name: string) {
    error.value = null;
    try {
      await window.api.instances.stopReconnect(name);
    } catch (err) {
      error.value = normalizeError(err);
    }
  }

  function setupListeners() {
    window.api.instances.onStatusChanged((data) => {
      const idx = instances.value.findIndex((i) => i.name === data.name);
      if (idx !== -1) {
        instances.value[idx] = {
          ...instances.value[idx],
          status: data.status as InstanceStatus,
          statusMessage: data.message,
        };
      }
    });
  }

  return {
    instances,
    loading,
    error,
    fetchList,
    create,
    start,
    stop,
    restart,
    remove,
    updatePort,
    checkConfigConsistency,
    forceReconnect,
    stopReconnect,
    confirmRemove,
    setupListeners,
  };
});

import { defineStore } from "pinia";
import { ref } from "vue";

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

type InstanceStatus = "installed" | "starting" | "running" | "stopping" | "stopped" | "error" | "crashed";

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
      error.value = String(err);
    } finally {
      loading.value = false;
    }
  }

  async function create(params: { name: string; version: string; port?: number }) {
    error.value = null;
    try {
      await window.api.instances.create(params);
      await fetchList();
    } catch (err) {
      error.value = String(err);
      throw err;
    }
  }

  async function start(name: string) {
    try {
      await window.api.instances.start(name);
    } catch (err) {
      error.value = String(err);
    }
  }

  async function stop(name: string) {
    try {
      await window.api.instances.stop(name);
    } catch (err) {
      error.value = String(err);
    }
  }

  async function restart(name: string) {
    try {
      await window.api.instances.restart(name);
    } catch (err) {
      error.value = String(err);
    }
  }

  async function remove(name: string) {
    error.value = null;
    try {
      await window.api.instances.remove(name);
      await fetchList();
    } catch (err) {
      error.value = String(err);
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
    setupListeners,
  };
});

import { defineStore } from "pinia";
import { ref } from "vue";

// See `src/stores/versions.ts` — strip the Electron IPC wrapper from
// errors before they hit the UI.
function normalizeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message.replace(
      /^Error invoking remote method '[^']+':\s*Error:\s*/,
      "",
    );
  }
  return String(err);
}

export const useSettingsStore = defineStore("settings", () => {
  const data = ref<AppSettings>({
    autoStart: false,
    autoStartInstances: false,
    autoStartInstanceList: [],
  });
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetch() {
    loading.value = true;
    error.value = null;
    try {
      data.value = await window.api.settings.get();
    } catch (err) {
      error.value = normalizeError(err);
    } finally {
      loading.value = false;
    }
  }

  async function update(patch: { autoStart?: boolean; autoStartInstances?: boolean; autoStartInstanceList?: string[] }) {
    error.value = null;
    try {
      await window.api.settings.set(patch);
      data.value = { ...data.value, ...patch };
    } catch (err) {
      error.value = normalizeError(err);
      throw err;
    }
  }

  return { data, loading, error, fetch, update };
});

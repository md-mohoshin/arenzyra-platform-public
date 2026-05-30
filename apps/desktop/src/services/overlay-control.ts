export type OverlayConfig = {
  port: number;
  baseUrl: string;
  matchId: string | null;
};

function getLauncherInvoke() {
  const bridge = (
    window as Window &
      typeof globalThis & {
        arenzyra?: {
          launcher?: {
            invoke?: (channel: string, payload?: unknown) => Promise<unknown>;
          };
        };
      }
  ).arenzyra;

  return bridge?.launcher?.invoke ?? null;
}

export function useOverlayConfig() {
  const invoke = getLauncherInvoke();

  async function getConfig(): Promise<OverlayConfig> {
    if (!invoke) {
      return { port: 7000, baseUrl: "http://127.0.0.1:4000", matchId: null };
    }

    const cfg = await invoke("overlay:getConfig");
    return cfg as OverlayConfig;
  }

  async function setConfig(cfg: Partial<OverlayConfig>): Promise<OverlayConfig> {
    if (!invoke) {
      return { port: 7000, baseUrl: "http://127.0.0.1:4000", matchId: null };
    }

    const next = await invoke("overlay:setConfig", cfg);
    return next as OverlayConfig;
  }

  async function restart() {
    if (!invoke) {
      return;
    }

    await invoke("overlay:restart");
  }

  return { getConfig, setConfig, restart };
}

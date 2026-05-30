export type ObsClient = {
  switchScene: (scene: string) => Promise<void>;
};

export function makeObsClient(): ObsClient {
  return {
    switchScene: async (scene: string) => {
      // Placeholder for OBS integration; replace with obs-websocket in production.
      console.info("[OBS] switch scene ->", scene);
    },
  };
}

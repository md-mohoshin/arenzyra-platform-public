import axios from "axios";

export type ShadowClient = ReturnType<typeof makeShadowClient>;

const DEFAULT_BASE = "http://127.0.0.1:5000";

const asRecord = (val: unknown): Record<string, unknown> | null =>
  val && typeof val === "object" ? (val as Record<string, unknown>) : null;

export function makeShadowClient(baseUrl = DEFAULT_BASE) {
  const base = (baseUrl || DEFAULT_BASE).replace(/\/$/, "") || DEFAULT_BASE;
  const client = axios.create({
    baseURL: base,
    timeout: 5000,
  });

  const post = async <T = unknown>(path: string): Promise<T | null> => {
    try {
      const res = await client.post<T>(path);
      return (res?.data as T | undefined) ?? null;
    } catch {
      return null;
    }
  };

  const getAllInfo = () => post("/getallinfo");
  const getTeamInfoList = () => post("/getteaminfolist");
  const getKillInfo = () => post("/getkillinfo");
  const getCircleInfo = () => post("/getcircleinfo");
  const getTotalPlayerList = () => post("/gettotalplayerlist");
  const getObservingPlayer = () => post("/getobservingplayer");
  const getTeamBackpackInfo = () => post("/getteambackpackinfo");

  return {
    base,
    getAllInfo,
    getTeamInfoList,
    getKillInfo,
    getCircleInfo,
    getTotalPlayerList,
    getObservingPlayer,
    getTeamBackpackInfo,
    asRecord,
  };
}

export type ShadowSnapshot = {
  allInfo: unknown | null;
  teams: unknown | null;
  players: unknown | null;
  kills: unknown | null;
  circle: unknown | null;
  backpack: unknown | null;
  observer: unknown | null;
};

export async function pollShadow(client: ShadowClient): Promise<ShadowSnapshot> {
  const [allInfo, kills, circle, players, teams, backpack, observer] = await Promise.all([
    client.getAllInfo(),
    client.getKillInfo(),
    client.getCircleInfo(),
    client.getTotalPlayerList(),
    client.getTeamInfoList(),
    client.getTeamBackpackInfo(),
    client.getObservingPlayer(),
  ]);
  return { allInfo, kills, circle, players, teams, backpack, observer };
}

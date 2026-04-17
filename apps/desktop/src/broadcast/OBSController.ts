"use client";

export type ObsStatus = "disconnected" | "connecting" | "connected" | "error";

export type ObsConnectionOptions = {
  url: string;
  password?: string;
};

type HelloPayload = {
  op: number;
  d: {
    authentication?: { challenge: string; salt: string };
    obsWebSocketVersion: string;
    rpcVersion: number;
  };
};

type IdentifiedPayload = { op: number };
type RequestResponse = { op: number; d: { requestId: string; requestStatus: { result: boolean }; responseData?: any } };

export class OBSController {
  private status: ObsStatus = "disconnected";
  private onStatusChange?: (status: ObsStatus) => void;
  private options: ObsConnectionOptions;
  private ws: WebSocket | null = null;
  private pending = new Map<string, (resp: any) => void>();
  private reqId = 0;

  constructor(options: ObsConnectionOptions, onStatusChange?: (status: ObsStatus) => void) {
    this.options = options;
    this.onStatusChange = onStatusChange;
  }

  connect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus("connecting");
    try {
      this.ws = new WebSocket(this.options.url);
    } catch (err) {
      console.error("[OBS] failed to open socket", err);
      this.setStatus("error");
      return;
    }

    this.ws.onopen = () => {
      // wait for Hello
    };

    this.ws.onmessage = async (ev) => {
      try {
        const data = JSON.parse(ev.data as string);
        this.handleMessage(data);
      } catch (err) {
        console.warn("[OBS] failed to parse message", err);
      }
    };

    this.ws.onerror = (err) => {
      console.error("[OBS] socket error", err);
      this.setStatus("error");
    };

    this.ws.onclose = () => {
      this.setStatus("disconnected");
    };
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
    this.pending.clear();
    this.setStatus("disconnected");
  }

  async switchScene(scene: string, transition?: string, durationMs?: number) {
    if (!(await this.ensureConnected())) return;
    if (transition) {
      await this.sendRequest("SetCurrentSceneTransition", { transitionName: transition });
    }
    if (typeof durationMs === "number") {
      await this.sendRequest("SetCurrentSceneTransitionDuration", { transitionDuration: durationMs });
    }
    await this.sendRequest("SetCurrentProgramScene", { sceneName: scene });
  }

  async setSourceVisibility(sourceName: string, visible: boolean, sceneName?: string) {
    if (!(await this.ensureConnected())) return;
    const scene = sceneName || (await this.getCurrentScene());
    if (!scene) return;
    const itemId = await this.findSceneItemId(scene, sourceName);
    if (!itemId) return;
    await this.sendRequest("SetSceneItemEnabled", { sceneName: scene, sceneItemId: itemId, sceneItemEnabled: visible });
  }

  async setBrowserSourceUrl(sourceName: string, url: string) {
    if (!(await this.ensureConnected())) return;
    await this.sendRequest("SetInputSettings", { inputName: sourceName, inputSettings: { url }, overlay: true });
  }

  async triggerTransition(name?: string, durationMs?: number) {
    if (!(await this.ensureConnected())) return;
    const data: Record<string, any> = {};
    if (name) data.transitionName = name;
    if (typeof durationMs === "number") data.transitionDuration = durationMs;
    await this.sendRequest("TriggerStudioModeTransition", data);
  }

  getStatus(): ObsStatus {
    return this.status;
  }

  private async handleMessage(msg: any) {
    if (msg.op === 0) {
      await this.replyIdentify(msg as HelloPayload);
      return;
    }
    if (msg.op === 2) {
      this.setStatus("connected");
      return;
    }
    if (msg.op === 7) {
      const payload = msg as RequestResponse;
      const resolve = this.pending.get(payload.d.requestId);
      if (resolve) {
        this.pending.delete(payload.d.requestId);
        resolve(payload.d);
      }
    }
  }

  private async replyIdentify(hello: HelloPayload) {
    const auth = hello.d.authentication;
    let authentication: string | undefined;
    if (auth?.challenge && auth?.salt && this.options.password) {
      const secret = await this.sha256Base64(this.options.password + auth.salt);
      authentication = await this.sha256Base64(secret + auth.challenge);
    }
    const identify = {
      op: 1,
      d: {
        rpcVersion: hello.d.rpcVersion ?? 1,
        authentication,
      },
    };
    this.sendRaw(identify);
  }

  private async ensureConnected() {
    let status: ObsStatus = this.status;
    if (status === "connected") return true;
    if (status === "disconnected") {
      this.connect();
    }
    // wait briefly, then re-check
    await new Promise((res) => setTimeout(res, 150));
    status = this.status;
    return status === "connected";
  }

  private sendRaw(obj: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(obj));
  }

  private async sendRequest(requestType: string, requestData?: Record<string, any>) {
    const id = `req-${++this.reqId}`;
    const payload = { op: 6, d: { requestType, requestId: id, requestData: requestData || {} } };
    this.sendRaw(payload);
    return new Promise((resolve) => this.pending.set(id, resolve));
  }

  private async getCurrentScene(): Promise<string | null> {
    const resp: any = await this.sendRequest("GetCurrentProgramScene");
    return resp?.responseData?.currentProgramSceneName ?? null;
  }

  private async findSceneItemId(sceneName: string, sourceName: string): Promise<number | null> {
    const resp: any = await this.sendRequest("GetSceneItemList", { sceneName });
    const items: Array<{ sceneItemId: number; sourceName: string }> = resp?.responseData?.sceneItems ?? [];
    const found = items.find((i) => i.sourceName === sourceName);
    return found?.sceneItemId ?? null;
  }

  private async sha256Base64(text: string): Promise<string> {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", data);
    const bytes = Array.from(new Uint8Array(hash));
    return btoa(String.fromCharCode(...bytes));
  }

  private setStatus(status: ObsStatus) {
    this.status = status;
    this.onStatusChange?.(status);
  }
}

export default OBSController;

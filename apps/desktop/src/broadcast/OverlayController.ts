export type WidgetAnimation = "slide-up" | "slide-left" | "fade-in" | "pop";
export type WidgetTheme = "pmgc" | "sponsor" | "minimal" | "gold";

export type WidgetCommand = {
  widgetId: string;
  action: "show" | "hide" | "update";
  payload?: Record<string, any>;
  animation?: WidgetAnimation;
  theme?: WidgetTheme;
};

export type OverlayStatus = "idle" | "connecting" | "connected" | "disconnected";

export interface OverlayTransport {
  send: (event: string, payload: any) => void;
  connect: () => void;
  disconnect: () => void;
  onStatusChange?: (status: OverlayStatus) => void;
}

export class OverlayController {
  private transport: OverlayTransport;

  constructor(transport: OverlayTransport) {
    this.transport = transport;
  }

  connect() {
    this.transport.connect();
  }

  disconnect() {
    this.transport.disconnect();
  }

  showWidget(widgetId: string, payload?: Record<string, any>, animation?: WidgetAnimation, theme?: WidgetTheme) {
    this.send({ widgetId, action: "show", payload, animation, theme });
  }

  updateWidget(widgetId: string, payload?: Record<string, any>, animation?: WidgetAnimation, theme?: WidgetTheme) {
    this.send({ widgetId, action: "update", payload, animation, theme });
  }

  hideWidget(widgetId: string) {
    this.send({ widgetId, action: "hide" });
  }

  toggleWidget(widgetId: string, visible: boolean, payload?: Record<string, any>) {
    if (visible) this.showWidget(widgetId, payload);
    else this.hideWidget(widgetId);
  }

  private send(command: WidgetCommand) {
    this.transport.send("widget:command", command);
  }
}

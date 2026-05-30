import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { MatchStateSnapshot } from "./state.types";

@WebSocketGateway({
  namespace: "/ws",
  cors: { origin: "*" },
})
export class StateGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private latestSnapshot: MatchStateSnapshot | null = null;

  handleConnection(client: Socket) {
    if (this.latestSnapshot) {
      client.emit("state:update", this.latestSnapshot);
    }
  }

  pushLatest(snapshot: MatchStateSnapshot) {
    this.latestSnapshot = snapshot;
    if (this.server) {
      this.server.emit("state:update", snapshot);
    }
  }
}

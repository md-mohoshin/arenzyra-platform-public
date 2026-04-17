declare module 'socket.io' {
  export type Socket = {
    on(event: string, listener: (...args: any[]) => void): void;
    emit(event: string, ...args: any[]): void;
    join(room: string): void;
    leave(room: string): void;
  };

  export class Server {
    constructor(...args: any[]);
    on(event: 'connection', listener: (socket: Socket) => void): void;
    on(event: string, listener: (...args: any[]) => void): void;
    to(room: string): { emit(event: string, ...args: any[]): void };
    emit(event: string, ...args: any[]): void;
  }
}

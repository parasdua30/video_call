import { io } from "socket.io-client";

class MeetingSocket {
  constructor() {
    this.socket = io({
      autoConnect: false,
      transports: ["websocket", "polling"]
    });
  }

  connect() {
    if (!this.socket.connected) {
      this.socket.connect();
    }
  }

  disconnect() {
    this.socket.disconnect();
  }

  on(eventName, handler) {
    this.socket.on(eventName, handler);
  }

  off(eventName, handler) {
    this.socket.off(eventName, handler);
  }

  emit(eventName, payload) {
    this.socket.emit(eventName, payload);
  }

  emitWithAck(eventName, payload) {
    this.connect();

    return new Promise((resolve, reject) => {
      this.socket.timeout(10000).emit(eventName, payload, (error, response) => {
        if (error) {
          reject(new Error("The server did not respond. Please try again."));
          return;
        }

        if (!response?.ok) {
          reject(new Error(response?.error || "Something went wrong."));
          return;
        }

        resolve(response.data);
      });
    });
  }
}

export const meetingSocket = new MeetingSocket();

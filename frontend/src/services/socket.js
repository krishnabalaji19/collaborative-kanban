import { io } from "socket.io-client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

let socket = null;

export function connectSocket(token) {
  if (socket) socket.disconnect();
  socket = io(API_URL, { auth: { token } }); // auto-reconnect is built in
  return socket;
}

export const getSocket = () => socket;

export function disconnectSocket() {
  if (socket) socket.disconnect();
  socket = null;
}

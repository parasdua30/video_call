export const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

export const isPeerConnectionClosed = (peerConnection) => {
  return ["closed", "failed"].includes(peerConnection.connectionState);
};

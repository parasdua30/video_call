import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { MeetingStore, serializeParticipantForClient } from "./meetingStore.js";
import { normalizeMeetingCode } from "./code.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true
  }
});
const meetings = new MeetingStore();

app.use(express.json());
app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

const acknowledge = async (callback, operation) => {
  try {
    const data = await operation();
    callback?.({ ok: true, data });
  } catch (error) {
    callback?.({ ok: false, error: error.message || "Something went wrong." });
  }
};

const emitMeetingSync = (code) => {
  const snapshot = meetings.getSnapshot(code);
  if (snapshot) {
    io.to(code).emit("meeting:sync", snapshot);
    io.to(snapshot.meeting.hostId).emit("meeting:waiting-updated", snapshot);
  }
};

const notifyParticipantJoined = (code, participant) => {
  const snapshot = meetings.getSnapshot(code);
  if (!snapshot) {
    return;
  }

  io.to(code).emit("meeting:participant-joined", {
    participant: serializeParticipantForClient(participant),
    ...snapshot
  });
};

const notifyParticipantLeft = (code, participant) => {
  const snapshot = meetings.getSnapshot(code);
  if (!snapshot) {
    return;
  }

  io.to(code).emit("meeting:participant-left", {
    participantId: participant.id,
    ...snapshot
  });
};

io.on("connection", (socket) => {
  socket.on("meeting:create", (payload = {}, callback) => {
    acknowledge(callback, () => {
      const { meeting, self } = meetings.createMeeting({
        hostSocketId: socket.id,
        hostName: payload.name,
        media: payload.media
      });

      socket.join(meeting.code);
      return {
        ...meetings.serializeMeeting(meeting),
        self: serializeParticipantForClient(self)
      };
    });
  });

  socket.on("meeting:request-join", (payload = {}, callback) => {
    acknowledge(callback, () => {
      const code = normalizeMeetingCode(payload.code);
      const participant = meetings.requestJoin({
        code,
        socketId: socket.id,
        name: payload.name,
        media: payload.media
      });
      const snapshot = meetings.getSnapshot(code);

      io.to(snapshot.meeting.hostId).emit("meeting:join-requested", {
        participant: serializeParticipantForClient(participant),
        ...snapshot
      });

      return {
        status: "waiting",
        meeting: snapshot.meeting,
        participantId: participant.id,
        self: serializeParticipantForClient(participant)
      };
    });
  });

  socket.on("meeting:admit", (payload = {}, callback) => {
    acknowledge(callback, () => {
      const code = normalizeMeetingCode(payload.code);
      const participant = meetings.admitParticipant({
        code,
        hostSocketId: socket.id,
        participantId: payload.participantId
      });
      const participantSocket = io.sockets.sockets.get(participant.socketId);

      participantSocket?.join(code);
      const snapshot = meetings.getSnapshot(code);
      io.to(participant.socketId).emit("meeting:admitted", {
        ...snapshot,
        self: serializeParticipantForClient(participant)
      });
      notifyParticipantJoined(code, participant);

      return snapshot;
    });
  });

  socket.on("meeting:admit-all", (payload = {}, callback) => {
    acknowledge(callback, () => {
      const code = normalizeMeetingCode(payload.code);
      const admitted = meetings.admitAll({
        code,
        hostSocketId: socket.id
      });

      admitted.forEach((participant) => {
        const participantSocket = io.sockets.sockets.get(participant.socketId);
        participantSocket?.join(code);
      });

      const snapshot = meetings.getSnapshot(code);
      admitted.forEach((participant) => {
        io.to(participant.socketId).emit("meeting:admitted", {
          ...snapshot,
          self: serializeParticipantForClient(participant)
        });
      });
      admitted.forEach((participant) => notifyParticipantJoined(code, participant));

      return snapshot;
    });
  });

  socket.on("meeting:deny", (payload = {}, callback) => {
    acknowledge(callback, () => {
      const code = normalizeMeetingCode(payload.code);
      const participant = meetings.denyParticipant({
        code,
        hostSocketId: socket.id,
        participantId: payload.participantId
      });
      const snapshot = meetings.getSnapshot(code);

      io.to(participant.socketId).emit("meeting:denied", {
        reason: "The host denied your request to join."
      });
      emitMeetingSync(code);

      return snapshot;
    });
  });

  socket.on("meeting:leave", (payload = {}, callback) => {
    acknowledge(callback, () => {
      const removal = meetings.removeSocket(socket.id, {
        endForAll: Boolean(payload.endForAll)
      });
      if (!removal) {
        return { left: false };
      }

      socket.leave(removal.code);
      if (removal.ended) {
        io.to(removal.code).emit("meeting:ended", {
          reason: "The host ended the meeting."
        });
      } else if (removal.status === "waiting") {
        emitMeetingSync(removal.code);
      } else {
        if (removal.participant.media.isScreenSharing) {
          io.to(removal.code).emit("presentation:stopped", {
            participantId: removal.participant.id,
            ...meetings.getSnapshot(removal.code)
          });
        }
        notifyParticipantLeft(removal.code, removal.participant);
      }

      return { left: true };
    });
  });

  socket.on("participant:update-media", (payload = {}) => {
    const context = meetings.updateMedia({
      socketId: socket.id,
      media: payload.media
    });

    if (context?.status === "admitted") {
      emitMeetingSync(context.code);
    }
  });

  socket.on("presentation:started", (payload = {}) => {
    const context = meetings.updateMedia({
      socketId: socket.id,
      media: {
        isScreenSharing: true,
        hasPresentationAudio: Boolean(payload.hasAudio)
      }
    });

    if (context?.status === "admitted") {
      const snapshot = meetings.getSnapshot(context.code);
      io.to(context.code).emit("presentation:started", {
        participantId: socket.id,
        hasAudio: Boolean(payload.hasAudio),
        ...snapshot
      });
    }
  });

  socket.on("presentation:stopped", () => {
    const context = meetings.updateMedia({
      socketId: socket.id,
      media: {
        isScreenSharing: false,
        hasPresentationAudio: false
      }
    });

    if (context?.status === "admitted") {
      const snapshot = meetings.getSnapshot(context.code);
      io.to(context.code).emit("presentation:stopped", {
        participantId: socket.id,
        ...snapshot
      });
    }
  });

  socket.on("signal:offer", (payload = {}) => {
    relaySignal(socket, "signal:offer", payload);
  });

  socket.on("signal:answer", (payload = {}) => {
    relaySignal(socket, "signal:answer", payload);
  });

  socket.on("signal:ice-candidate", (payload = {}) => {
    relaySignal(socket, "signal:ice-candidate", payload);
  });

  socket.on("media:request-offer", (payload = {}) => {
    relaySignal(socket, "media:request-offer", payload);
  });

  socket.on("signal:presentation-offer", (payload = {}) => {
    relaySignal(socket, "signal:presentation-offer", payload);
  });

  socket.on("signal:presentation-answer", (payload = {}) => {
    relaySignal(socket, "signal:presentation-answer", payload);
  });

  socket.on("signal:presentation-ice-candidate", (payload = {}) => {
    relaySignal(socket, "signal:presentation-ice-candidate", payload);
  });

  socket.on("presentation:request-offer", (payload = {}) => {
    relaySignal(socket, "presentation:request-offer", payload);
  });

  socket.on("disconnect", () => {
    const removal = meetings.removeSocket(socket.id);
    if (!removal) {
      return;
    }

    if (removal.ended) {
      io.to(removal.code).emit("meeting:ended", {
        reason: "The host ended the meeting."
      });
    } else if (removal.status === "waiting") {
      emitMeetingSync(removal.code);
    } else {
      if (removal.participant.media.isScreenSharing) {
        io.to(removal.code).emit("presentation:stopped", {
          participantId: removal.participant.id,
          ...meetings.getSnapshot(removal.code)
        });
      }
      notifyParticipantLeft(removal.code, removal.participant);
    }
  });
});

function relaySignal(socket, eventName, payload) {
  const sender = meetings.findBySocketId(socket.id);
  if (!sender || sender.status !== "admitted") {
    return;
  }

  const targetId = payload.to;
  if (!meetings.hasAdmittedParticipant(sender.code, targetId)) {
    return;
  }

  io.to(targetId).emit(eventName, {
    from: socket.id,
    presenterId: payload.presenterId,
    description: payload.description,
    candidate: payload.candidate
  });
}

if (isProduction) {
  const distDir = path.join(rootDir, "dist");
  app.use(express.static(distDir));
  app.use((_request, response) => {
    response.sendFile(path.join(distDir, "index.html"));
  });
} else {
  const vite = await import("vite");
  const viteServer = await vite.createServer({
    root: rootDir,
    server: {
      middlewareMode: true
    },
    appType: "spa"
  });

  app.use(viteServer.middlewares);
}

server.listen(port, "0.0.0.0", () => {
  console.log(`Meet clone running at http://localhost:${port}`);
});

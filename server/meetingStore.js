import { createMeetingCode, normalizeMeetingCode } from "./code.js";

const DEFAULT_MEDIA_STATE = {
  isAudioEnabled: false,
  isVideoEnabled: false,
  isScreenSharing: false,
  hasPresentationAudio: false
};

const toInitials = (name) => {
  const parts = String(name || "Guest")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "G";
};

const createParticipant = ({ socketId, name, role, media }) => ({
  id: socketId,
  socketId,
  name: String(name || "Guest").trim().slice(0, 60) || "Guest",
  initials: toInitials(name),
  role,
  isHost: role === "host",
  media: {
    ...DEFAULT_MEDIA_STATE,
    ...media
  },
  joinedAt: new Date().toISOString()
});

const setParticipantRole = (participant, role) => {
  participant.role = role;
  participant.isHost = role === "host";
};

const serializeParticipant = (participant) => ({
  id: participant.id,
  name: participant.name,
  initials: participant.initials,
  role: participant.role,
  isHost: participant.isHost,
  isAudioEnabled: Boolean(participant.media.isAudioEnabled),
  isVideoEnabled: Boolean(participant.media.isVideoEnabled),
  isScreenSharing: Boolean(participant.media.isScreenSharing),
  hasPresentationAudio: Boolean(participant.media.hasPresentationAudio),
  joinedAt: participant.joinedAt
});

export class MeetingStore {
  constructor() {
    this.meetings = new Map();
  }

  createMeeting({ hostSocketId, hostName, media }) {
    let code = createMeetingCode();
    while (this.meetings.has(code)) {
      code = createMeetingCode();
    }

    const host = createParticipant({
      socketId: hostSocketId,
      name: hostName || "You",
      role: "host",
      media
    });

    const meeting = {
      code,
      hostId: host.id,
      participants: new Map([[host.id, host]]),
      waiting: new Map(),
      createdAt: new Date().toISOString()
    };

    this.meetings.set(code, meeting);

    return {
      meeting,
      self: host
    };
  }

  requestJoin({ code, socketId, name, media }) {
    const meeting = this.getMeeting(code);
    if (!meeting) {
      throw new Error("Meeting not found.");
    }

    if (meeting.participants.has(socketId)) {
      return meeting.participants.get(socketId);
    }

    const waitingParticipant = createParticipant({
      socketId,
      name,
      role: "guest",
      media
    });

    meeting.waiting.set(waitingParticipant.id, waitingParticipant);
    return waitingParticipant;
  }

  admitParticipant({ code, hostSocketId, participantId }) {
    const meeting = this.requireHostedMeeting(code, hostSocketId);
    const participant = meeting.waiting.get(participantId);

    if (!participant) {
      throw new Error("Participant is no longer waiting.");
    }

    meeting.waiting.delete(participantId);
    meeting.participants.set(participant.id, participant);
    return participant;
  }

  admitAll({ code, hostSocketId }) {
    const meeting = this.requireHostedMeeting(code, hostSocketId);
    const admitted = Array.from(meeting.waiting.values());

    admitted.forEach((participant) => {
      meeting.waiting.delete(participant.id);
      meeting.participants.set(participant.id, participant);
    });

    return admitted;
  }

  denyParticipant({ code, hostSocketId, participantId }) {
    const meeting = this.requireHostedMeeting(code, hostSocketId);
    const participant = meeting.waiting.get(participantId);

    if (!participant) {
      throw new Error("Participant is no longer waiting.");
    }

    meeting.waiting.delete(participantId);
    return participant;
  }

  updateMedia({ socketId, media }) {
    const context = this.findBySocketId(socketId);
    if (!context) {
      return null;
    }

    context.participant.media = {
      ...context.participant.media,
      ...media
    };

    return context;
  }

  removeSocket(socketId, { endForAll = false } = {}) {
    const context = this.findBySocketId(socketId);
    if (!context) {
      return null;
    }

    const { meeting, participant, status } = context;

    if (status === "waiting") {
      meeting.waiting.delete(participant.id);
      return {
        ...context,
        ended: false
      };
    }

    meeting.participants.delete(participant.id);

    if (meeting.hostId === participant.id) {
      if (endForAll || meeting.participants.size === 0) {
        this.meetings.delete(meeting.code);
        return {
          ...context,
          ended: Boolean(endForAll)
        };
      }

      const nextHost = meeting.participants.values().next().value;
      setParticipantRole(nextHost, "host");
      meeting.hostId = nextHost.id;

      return {
        ...context,
        ended: false,
        newHost: nextHost
      };
    }

    if (meeting.participants.size === 0) {
      this.meetings.delete(meeting.code);
    }

    return {
      ...context,
      ended: false
    };
  }

  getMeeting(code) {
    return this.meetings.get(normalizeMeetingCode(code));
  }

  getSnapshot(code) {
    const meeting = this.getMeeting(code);
    if (!meeting) {
      return null;
    }

    return this.serializeMeeting(meeting);
  }

  findBySocketId(socketId) {
    for (const meeting of this.meetings.values()) {
      if (meeting.participants.has(socketId)) {
        return {
          code: meeting.code,
          meeting,
          participant: meeting.participants.get(socketId),
          status: "admitted"
        };
      }

      if (meeting.waiting.has(socketId)) {
        return {
          code: meeting.code,
          meeting,
          participant: meeting.waiting.get(socketId),
          status: "waiting"
        };
      }
    }

    return null;
  }

  hasAdmittedParticipant(code, participantId) {
    const meeting = this.getMeeting(code);
    return Boolean(meeting?.participants.has(participantId));
  }

  requireHostedMeeting(code, hostSocketId) {
    const meeting = this.getMeeting(code);
    if (!meeting) {
      throw new Error("Meeting not found.");
    }

    if (meeting.hostId !== hostSocketId) {
      throw new Error("Only the host can manage admission.");
    }

    return meeting;
  }

  serializeMeeting(meeting) {
    return {
      meeting: {
        code: meeting.code,
        hostId: meeting.hostId,
        createdAt: meeting.createdAt
      },
      participants: Array.from(meeting.participants.values()).map(serializeParticipant),
      waiting: Array.from(meeting.waiting.values()).map(serializeParticipant)
    };
  }
}

export const serializeParticipantForClient = serializeParticipant;

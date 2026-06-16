import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { meetingSocket } from "../services/socketClient.js";
import { ICE_SERVERS, isPeerConnectionClosed } from "../services/webrtc.js";
import { normalizeMeetingCode } from "../utils/meetingCode.js";

const initialState = {
  status: "idle",
  meeting: null,
  self: null,
  participants: [],
  waiting: [],
  error: ""
};

export function useMeeting({ localStream, mediaState, onAdmitted, onDenied, onEnded }) {
  const [state, setState] = useState(initialState);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const peerConnections = useRef(new Map());
  const remoteStreamsRef = useRef(new Map());
  const localStreamRef = useRef(localStream);
  const selfRef = useRef(null);
  const meetingCodeRef = useRef("");

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  const updateStateFromSnapshot = useCallback((snapshot) => {
    if (!snapshot?.meeting) {
      return;
    }

    meetingCodeRef.current = snapshot.meeting.code;
    setState((current) => ({
      ...current,
      meeting: snapshot.meeting,
      participants: snapshot.participants ?? [],
      waiting: snapshot.waiting ?? [],
      error: ""
    }));
  }, []);

  const removePeerConnection = useCallback((participantId) => {
    const peerConnection = peerConnections.current.get(participantId);
    if (peerConnection) {
      peerConnection.close();
      peerConnections.current.delete(participantId);
    }

    remoteStreamsRef.current.delete(participantId);
    setRemoteStreams(new Map(remoteStreamsRef.current));
  }, []);

  const cleanupPeerConnections = useCallback(() => {
    peerConnections.current.forEach((peerConnection) => peerConnection.close());
    peerConnections.current.clear();
    remoteStreamsRef.current.clear();
    setRemoteStreams(new Map());
  }, []);

  const getPeerConnection = useCallback(
    (participantId) => {
      const existing = peerConnections.current.get(participantId);
      if (existing && !isPeerConnectionClosed(existing)) {
        return existing;
      }

      const peerConnection = new RTCPeerConnection(ICE_SERVERS);
      const mediaStream = localStreamRef.current;

      mediaStream?.getTracks().forEach((track) => {
        peerConnection.addTrack(track, mediaStream);
      });

      peerConnection.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (!remoteStream) {
          return;
        }

        remoteStreamsRef.current.set(participantId, remoteStream);
        setRemoteStreams(new Map(remoteStreamsRef.current));
      };

      peerConnection.onicecandidate = (event) => {
        if (!event.candidate) {
          return;
        }

        meetingSocket.emit("signal:ice-candidate", {
          to: participantId,
          candidate: event.candidate
        });
      };

      peerConnection.onconnectionstatechange = () => {
        if (["closed", "failed"].includes(peerConnection.connectionState)) {
          removePeerConnection(participantId);
        }
      };

      peerConnections.current.set(participantId, peerConnection);
      return peerConnection;
    },
    [removePeerConnection]
  );

  const startOffer = useCallback(
    async (participantId) => {
      if (!participantId || participantId === selfRef.current?.id) {
        return;
      }

      const peerConnection = getPeerConnection(participantId);
      if (peerConnection.signalingState !== "stable") {
        return;
      }

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      meetingSocket.emit("signal:offer", {
        to: participantId,
        description: peerConnection.localDescription
      });
    },
    [getPeerConnection]
  );

  const handleOffer = useCallback(
    async ({ from, description }) => {
      if (!from || !description) {
        return;
      }

      const peerConnection = getPeerConnection(from);
      await peerConnection.setRemoteDescription(new RTCSessionDescription(description));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      meetingSocket.emit("signal:answer", {
        to: from,
        description: peerConnection.localDescription
      });
    },
    [getPeerConnection]
  );

  const handleAnswer = useCallback(
    async ({ from, description }) => {
      const peerConnection = peerConnections.current.get(from);
      if (!peerConnection || !description) {
        return;
      }

      await peerConnection.setRemoteDescription(new RTCSessionDescription(description));
    },
    []
  );

  const handleIceCandidate = useCallback(async ({ from, candidate }) => {
    const peerConnection = peerConnections.current.get(from);
    if (!peerConnection || !candidate) {
      return;
    }

    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // ICE candidates can arrive after a peer has already left.
    }
  }, []);

  useEffect(() => {
    meetingSocket.connect();

    const handleSync = (snapshot) => updateStateFromSnapshot(snapshot);
    const handleWaitingUpdated = (snapshot) => updateStateFromSnapshot(snapshot);
    const handleJoinRequested = (snapshot) => updateStateFromSnapshot(snapshot);
    const handleParticipantJoined = (payload) => {
      updateStateFromSnapshot(payload);
      startOffer(payload.participant?.id);
    };
    const handleParticipantLeft = (payload) => {
      updateStateFromSnapshot(payload);
      removePeerConnection(payload.participantId);
    };
    const handleAdmitted = (payload) => {
      selfRef.current = payload.self;
      updateStateFromSnapshot(payload);
      setState((current) => ({
        ...current,
        status: "joined",
        self: payload.self,
        error: ""
      }));
      onAdmitted?.(payload.meeting.code);
    };
    const handleDenied = (payload) => {
      cleanupPeerConnections();
      setState((current) => ({
        ...current,
        status: "denied",
        waiting: [],
        error: payload.reason || "The host denied your request."
      }));
      onDenied?.(payload.reason);
    };
    const handleEnded = (payload) => {
      cleanupPeerConnections();
      selfRef.current = null;
      meetingCodeRef.current = "";
      setState({
        ...initialState,
        status: "ended",
        error: payload.reason || "The meeting ended."
      });
      onEnded?.(payload.reason);
    };

    meetingSocket.on("meeting:sync", handleSync);
    meetingSocket.on("meeting:waiting-updated", handleWaitingUpdated);
    meetingSocket.on("meeting:join-requested", handleJoinRequested);
    meetingSocket.on("meeting:participant-joined", handleParticipantJoined);
    meetingSocket.on("meeting:participant-left", handleParticipantLeft);
    meetingSocket.on("meeting:admitted", handleAdmitted);
    meetingSocket.on("meeting:denied", handleDenied);
    meetingSocket.on("meeting:ended", handleEnded);
    meetingSocket.on("signal:offer", handleOffer);
    meetingSocket.on("signal:answer", handleAnswer);
    meetingSocket.on("signal:ice-candidate", handleIceCandidate);

    return () => {
      meetingSocket.off("meeting:sync", handleSync);
      meetingSocket.off("meeting:waiting-updated", handleWaitingUpdated);
      meetingSocket.off("meeting:join-requested", handleJoinRequested);
      meetingSocket.off("meeting:participant-joined", handleParticipantJoined);
      meetingSocket.off("meeting:participant-left", handleParticipantLeft);
      meetingSocket.off("meeting:admitted", handleAdmitted);
      meetingSocket.off("meeting:denied", handleDenied);
      meetingSocket.off("meeting:ended", handleEnded);
      meetingSocket.off("signal:offer", handleOffer);
      meetingSocket.off("signal:answer", handleAnswer);
      meetingSocket.off("signal:ice-candidate", handleIceCandidate);
    };
  }, [
    cleanupPeerConnections,
    handleAnswer,
    handleIceCandidate,
    handleOffer,
    onAdmitted,
    onDenied,
    onEnded,
    removePeerConnection,
    startOffer,
    updateStateFromSnapshot
  ]);

  useEffect(() => {
    if (!selfRef.current || !["joined", "waiting"].includes(state.status)) {
      return;
    }

    meetingSocket.emit("participant:update-media", {
      media: mediaState
    });
  }, [mediaState, state.status]);

  const createMeeting = useCallback(
    async (name = "You") => {
      setState((current) => ({ ...current, status: "creating", error: "" }));
      const data = await meetingSocket.emitWithAck("meeting:create", {
        name,
        media: mediaState
      });

      selfRef.current = data.self;
      meetingCodeRef.current = data.meeting.code;
      updateStateFromSnapshot(data);
      setState((current) => ({
        ...current,
        status: "joined",
        self: data.self
      }));

      return data;
    },
    [mediaState, updateStateFromSnapshot]
  );

  const requestJoin = useCallback(
    async ({ code, name }) => {
      const meetingCode = normalizeMeetingCode(code);
      setState((current) => ({ ...current, status: "requesting", error: "" }));

      const data = await meetingSocket.emitWithAck("meeting:request-join", {
        code: meetingCode,
        name,
        media: mediaState
      });

      selfRef.current = data.self;
      meetingCodeRef.current = data.meeting.code;
      setState((current) => ({
        ...current,
        status: "waiting",
        meeting: data.meeting,
        self: data.self,
        error: ""
      }));

      return data;
    },
    [mediaState]
  );

  const admitParticipant = useCallback(async (participantId) => {
    if (!meetingCodeRef.current) {
      return;
    }

    const snapshot = await meetingSocket.emitWithAck("meeting:admit", {
      code: meetingCodeRef.current,
      participantId
    });
    updateStateFromSnapshot(snapshot);
  }, [updateStateFromSnapshot]);

  const admitAll = useCallback(async () => {
    if (!meetingCodeRef.current) {
      return;
    }

    const snapshot = await meetingSocket.emitWithAck("meeting:admit-all", {
      code: meetingCodeRef.current
    });
    updateStateFromSnapshot(snapshot);
  }, [updateStateFromSnapshot]);

  const denyParticipant = useCallback(async (participantId) => {
    if (!meetingCodeRef.current) {
      return;
    }

    const snapshot = await meetingSocket.emitWithAck("meeting:deny", {
      code: meetingCodeRef.current,
      participantId
    });
    updateStateFromSnapshot(snapshot);
  }, [updateStateFromSnapshot]);

  const leaveMeeting = useCallback(async () => {
    try {
      await meetingSocket.emitWithAck("meeting:leave", {});
    } catch {
      // Leaving should still reset the local UI if the server already dropped the socket.
    }

    cleanupPeerConnections();
    selfRef.current = null;
    meetingCodeRef.current = "";
    setState(initialState);
  }, [cleanupPeerConnections]);

  const isHost = useMemo(() => {
    return Boolean(state.self?.isHost);
  }, [state.self]);

  return {
    ...state,
    isHost,
    remoteStreams,
    createMeeting,
    requestJoin,
    admitParticipant,
    admitAll,
    denyParticipant,
    leaveMeeting
  };
}

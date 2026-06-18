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

const getMediaPayload = (stream, fallback) => ({
  isAudioEnabled: stream?.getAudioTracks()[0]?.enabled ?? fallback.isAudioEnabled,
  isVideoEnabled: stream?.getVideoTracks()[0]?.enabled ?? fallback.isVideoEnabled
});

const hasEnabledMedia = (participant) => Boolean(participant?.isAudioEnabled || participant?.isVideoEnabled);

const hasExpectedRemoteMedia = (participant, stream) => {
  if (!hasEnabledMedia(participant)) {
    return true;
  }

  if (!stream) {
    return false;
  }

  if (participant.isVideoEnabled && !stream.getVideoTracks().some((track) => track.readyState === "live")) {
    return false;
  }

  if (participant.isAudioEnabled && !stream.getAudioTracks().some((track) => track.readyState === "live")) {
    return false;
  }

  return true;
};

const needsIceRestart = (peerConnection) => {
  return ["disconnected", "failed"].includes(peerConnection?.connectionState)
    || ["disconnected", "failed"].includes(peerConnection?.iceConnectionState);
};

const hasLivePresentationStream = (stream) => {
  return Boolean(stream?.getVideoTracks().some((track) => track.readyState === "live"));
};

export function useMeeting({ localStream, mediaState, onAdmitted, onDenied, onEnded }) {
  const [state, setState] = useState(initialState);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const [presentationStreams, setPresentationStreams] = useState(new Map());
  const [localPresentationStream, setLocalPresentationStream] = useState(null);
  const peerConnections = useRef(new Map());
  const presentationSendPeerConnections = useRef(new Map());
  const presentationReceivePeerConnections = useRef(new Map());
  const remoteStreamsRef = useRef(new Map());
  const presentationStreamsRef = useRef(new Map());
  const localStreamRef = useRef(localStream);
  const localPresentationStreamRef = useRef(null);
  const selfRef = useRef(null);
  const meetingCodeRef = useRef("");

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  const updateStateFromSnapshot = useCallback((snapshot) => {
    if (!snapshot?.meeting) {
      return;
    }

    const participants = snapshot.participants ?? [];
    const waiting = snapshot.waiting ?? [];
    meetingCodeRef.current = snapshot.meeting.code;
    setState((current) => ({
      ...current,
      meeting: snapshot.meeting,
      self: current.self
        ? [...participants, ...waiting].find((participant) => participant.id === current.self.id) ?? current.self
        : current.self,
      participants,
      waiting,
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

  const shouldInitiateMediaOffer = useCallback((participantId) => {
    return Boolean(selfRef.current?.id && participantId && selfRef.current.id < participantId);
  }, []);

  const syncLocalTracksToPeerConnection = useCallback((peerConnection) => {
    const mediaStream = localStreamRef.current;
    if (!mediaStream) {
      return false;
    }

    let negotiationNeeded = false;
    const senders = peerConnection.getSenders();

    mediaStream.getTracks().forEach((track) => {
      const existingSender = senders.find((sender) => sender.track?.kind === track.kind);
      if (existingSender) {
        if (existingSender.track !== track) {
          existingSender.replaceTrack(track).catch(() => {});
        }
        return;
      }

      peerConnection.addTrack(track, mediaStream);
      negotiationNeeded = true;
    });

    return negotiationNeeded;
  }, []);

  const requestMediaOffer = useCallback((participantId) => {
    if (!participantId || participantId === selfRef.current?.id) {
      return;
    }

    meetingSocket.emit("media:request-offer", {
      to: participantId
    });
  }, []);

  const closePresentationSendPeerConnection = useCallback((participantId) => {
    const peerConnection = presentationSendPeerConnections.current.get(participantId);
    if (peerConnection) {
      peerConnection.onconnectionstatechange = null;
      peerConnection.onicecandidate = null;
      peerConnection.close();
      presentationSendPeerConnections.current.delete(participantId);
    }
  }, []);

  const closePresentationReceivePeerConnection = useCallback((participantId, { removeStream = false } = {}) => {
    const peerConnection = presentationReceivePeerConnections.current.get(participantId);
    if (peerConnection) {
      peerConnection.onconnectionstatechange = null;
      peerConnection.onicecandidate = null;
      peerConnection.ontrack = null;
      peerConnection.close();
      presentationReceivePeerConnections.current.delete(participantId);
    }

    if (removeStream) {
      presentationStreamsRef.current.delete(participantId);
      setPresentationStreams(new Map(presentationStreamsRef.current));
    }
  }, []);

  const cleanupLocalPresentationPeerConnections = useCallback(() => {
    presentationSendPeerConnections.current.forEach((peerConnection) => peerConnection.close());
    presentationSendPeerConnections.current.clear();
  }, []);

  const cleanupPresentationPeerConnections = useCallback(() => {
    presentationSendPeerConnections.current.forEach((peerConnection) => peerConnection.close());
    presentationReceivePeerConnections.current.forEach((peerConnection) => peerConnection.close());
    presentationSendPeerConnections.current.clear();
    presentationReceivePeerConnections.current.clear();
    presentationStreamsRef.current.clear();
    setPresentationStreams(new Map());
  }, []);

  const removePresentationForParticipant = useCallback(
    (participantId) => {
      closePresentationSendPeerConnection(participantId);
      closePresentationReceivePeerConnection(participantId, { removeStream: true });
    },
    [closePresentationReceivePeerConnection, closePresentationSendPeerConnection]
  );

  const stopPresentation = useCallback((notifyServer = true) => {
    const stream = localPresentationStreamRef.current;
    const hadActivePresentation = Boolean(stream);
    stream?.getTracks().forEach((track) => track.stop());
    localPresentationStreamRef.current = null;
    setLocalPresentationStream(null);
    cleanupLocalPresentationPeerConnections();

    if (notifyServer && selfRef.current && hadActivePresentation) {
      meetingSocket.emit("presentation:stopped");
    }
  }, [cleanupLocalPresentationPeerConnections]);

  const getPeerConnection = useCallback(
    (participantId) => {
      const existing = peerConnections.current.get(participantId);
      if (existing && !isPeerConnectionClosed(existing)) {
        syncLocalTracksToPeerConnection(existing);
        return existing;
      }

      existing?.close();
      const peerConnection = new RTCPeerConnection(ICE_SERVERS);
      syncLocalTracksToPeerConnection(peerConnection);

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
        if (peerConnection.connectionState === "closed") {
          removePeerConnection(participantId);
          return;
        }

        if (peerConnection.connectionState === "failed") {
          removePeerConnection(participantId);
          window.setTimeout(() => requestMediaOffer(participantId), 600);
          return;
        }

        if (peerConnection.connectionState === "disconnected") {
          window.setTimeout(() => {
            if (needsIceRestart(peerConnections.current.get(participantId))) {
              requestMediaOffer(participantId);
            }
          }, 1400);
        }
      };

      peerConnections.current.set(participantId, peerConnection);
      return peerConnection;
    },
    [removePeerConnection, requestMediaOffer, syncLocalTracksToPeerConnection]
  );

  const getPresentationSendPeerConnection = useCallback(
    (participantId) => {
      const existing = presentationSendPeerConnections.current.get(participantId);
      if (existing && !isPeerConnectionClosed(existing)) {
        return existing;
      }

      const peerConnection = new RTCPeerConnection(ICE_SERVERS);

      peerConnection.onicecandidate = (event) => {
        if (!event.candidate) {
          return;
        }

        meetingSocket.emit("signal:presentation-ice-candidate", {
          to: participantId,
          presenterId: selfRef.current?.id,
          candidate: event.candidate
        });
      };

      peerConnection.onconnectionstatechange = () => {
        if (["closed", "failed"].includes(peerConnection.connectionState)) {
          closePresentationSendPeerConnection(participantId);
        }
      };

      presentationSendPeerConnections.current.set(participantId, peerConnection);
      return peerConnection;
    },
    [closePresentationSendPeerConnection]
  );

  const getPresentationReceivePeerConnection = useCallback(
    (participantId, { forceNew = false } = {}) => {
      if (forceNew) {
        closePresentationReceivePeerConnection(participantId);
      }

      const existing = presentationReceivePeerConnections.current.get(participantId);
      if (existing && !isPeerConnectionClosed(existing)) {
        return existing;
      }

      const peerConnection = new RTCPeerConnection(ICE_SERVERS);

      peerConnection.ontrack = (event) => {
        const [presentationStream] = event.streams;
        if (!presentationStream) {
          return;
        }

        presentationStreamsRef.current.set(participantId, presentationStream);
        setPresentationStreams(new Map(presentationStreamsRef.current));
      };

      peerConnection.onicecandidate = (event) => {
        if (!event.candidate) {
          return;
        }

        meetingSocket.emit("signal:presentation-ice-candidate", {
          to: participantId,
          presenterId: participantId,
          candidate: event.candidate
        });
      };

      peerConnection.onconnectionstatechange = () => {
        if (["closed", "failed"].includes(peerConnection.connectionState)) {
          closePresentationReceivePeerConnection(participantId, { removeStream: true });
        }
      };

      presentationReceivePeerConnections.current.set(participantId, peerConnection);
      return peerConnection;
    },
    [closePresentationReceivePeerConnection]
  );

  const startOffer = useCallback(
    async (participantId, { force = false, iceRestart = false } = {}) => {
      if (!participantId || participantId === selfRef.current?.id) {
        return;
      }

      if (!force && !shouldInitiateMediaOffer(participantId)) {
        return;
      }

      let peerConnection = getPeerConnection(participantId);
      if (peerConnection.signalingState !== "stable") {
        return;
      }

      syncLocalTracksToPeerConnection(peerConnection);
      const offer = await peerConnection.createOffer({ iceRestart });
      await peerConnection.setLocalDescription(offer);
      meetingSocket.emit("signal:offer", {
        to: participantId,
        description: peerConnection.localDescription
      });
    },
    [getPeerConnection, shouldInitiateMediaOffer, syncLocalTracksToPeerConnection]
  );

  const startPresentationOffer = useCallback(
    async (participantId, { iceRestart = false } = {}) => {
      const presentationStream = localPresentationStreamRef.current;
      if (!presentationStream || !participantId || participantId === selfRef.current?.id) {
        return;
      }

      let peerConnection = getPresentationSendPeerConnection(participantId);
      if (peerConnection.signalingState !== "stable") {
        closePresentationSendPeerConnection(participantId);
        peerConnection = getPresentationSendPeerConnection(participantId);
      }

      const existingTrackIds = new Set(
        peerConnection
          .getSenders()
          .map((sender) => sender.track?.id)
          .filter(Boolean)
      );

      presentationStream.getTracks().forEach((track) => {
        if (!existingTrackIds.has(track.id)) {
          peerConnection.addTrack(track, presentationStream);
        }
      });

      if (peerConnection.signalingState !== "stable") {
        return;
      }

      const offer = await peerConnection.createOffer({ iceRestart });
      await peerConnection.setLocalDescription(offer);
      meetingSocket.emit("signal:presentation-offer", {
        to: participantId,
        presenterId: selfRef.current?.id,
        description: peerConnection.localDescription
      });
    },
    [closePresentationSendPeerConnection, getPresentationSendPeerConnection]
  );

  const handleOffer = useCallback(
    async ({ from, description }) => {
      if (!from || !description) {
        return;
      }

      let peerConnection = getPeerConnection(from);
      if (peerConnection.signalingState !== "stable") {
        removePeerConnection(from);
        peerConnection = getPeerConnection(from);
      }

      syncLocalTracksToPeerConnection(peerConnection);
      await peerConnection.setRemoteDescription(new RTCSessionDescription(description));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      meetingSocket.emit("signal:answer", {
        to: from,
        description: peerConnection.localDescription
      });
    },
    [getPeerConnection, removePeerConnection, syncLocalTracksToPeerConnection]
  );

  const handleAnswer = useCallback(
    async ({ from, description }) => {
      const peerConnection = peerConnections.current.get(from);
      if (!peerConnection || !description) {
        return;
      }

      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(description));
      } catch {
        removePeerConnection(from);
        if (shouldInitiateMediaOffer(from)) {
          window.setTimeout(() => startOffer(from), 600);
        } else {
          requestMediaOffer(from);
        }
      }
    },
    [removePeerConnection, requestMediaOffer, shouldInitiateMediaOffer, startOffer]
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

  const handlePresentationOffer = useCallback(
    async ({ from, description, presenterId }) => {
      if (!from || !description) {
        return;
      }

      const presenter = presenterId ?? from;
      if (presenter !== from) {
        return;
      }

      let peerConnection = getPresentationReceivePeerConnection(presenter);
      if (peerConnection.signalingState !== "stable") {
        peerConnection = getPresentationReceivePeerConnection(presenter, { forceNew: true });
      }

      await peerConnection.setRemoteDescription(new RTCSessionDescription(description));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      meetingSocket.emit("signal:presentation-answer", {
        to: from,
        presenterId: presenter,
        description: peerConnection.localDescription
      });
    },
    [getPresentationReceivePeerConnection]
  );

  const handlePresentationAnswer = useCallback(async ({ from, description, presenterId }) => {
    if (presenterId !== selfRef.current?.id) {
      return;
    }

    const peerConnection = presentationSendPeerConnections.current.get(from);
    if (!peerConnection || !description) {
      return;
    }

    await peerConnection.setRemoteDescription(new RTCSessionDescription(description));
  }, []);

  const handlePresentationIceCandidate = useCallback(async ({ from, candidate, presenterId }) => {
    const peerConnection =
      presenterId === selfRef.current?.id
        ? presentationSendPeerConnections.current.get(from)
        : presentationReceivePeerConnections.current.get(presenterId ?? from);

    if (!peerConnection || !candidate) {
      return;
    }

    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // Presentation ICE candidates can arrive after presenting has stopped.
    }
  }, []);

  const requestPresentationOffer = useCallback((participantId, { force = false } = {}) => {
    if (!participantId || participantId === selfRef.current?.id) {
      return;
    }

    if (!force && presentationStreamsRef.current.has(participantId)) {
      return;
    }

    meetingSocket.emit("presentation:request-offer", {
      to: participantId,
      presenterId: participantId
    });
  }, []);

  useEffect(() => {
    meetingSocket.connect();

    const handleSync = (snapshot) => updateStateFromSnapshot(snapshot);
    const handleWaitingUpdated = (snapshot) => updateStateFromSnapshot(snapshot);
    const handleJoinRequested = (snapshot) => updateStateFromSnapshot(snapshot);
    const handleParticipantJoined = (payload) => {
      updateStateFromSnapshot(payload);
      startOffer(payload.participant?.id);
      startPresentationOffer(payload.participant?.id);
    };
    const handleParticipantLeft = (payload) => {
      updateStateFromSnapshot(payload);
      removePeerConnection(payload.participantId);
      removePresentationForParticipant(payload.participantId);
    };
    const handlePresentationStarted = (payload) => {
      updateStateFromSnapshot(payload);
      if (payload.participantId !== selfRef.current?.id) {
        window.setTimeout(() => requestPresentationOffer(payload.participantId), 800);
      }
    };
    const handlePresentationStopped = (payload) => {
      updateStateFromSnapshot(payload);
      if (payload.participantId !== selfRef.current?.id) {
        removePresentationForParticipant(payload.participantId);
      }
    };
    const handlePresentationOfferRequested = ({ from }) => {
      startPresentationOffer(from, { iceRestart: true });
    };
    const handleMediaOfferRequested = ({ from }) => {
      if (shouldInitiateMediaOffer(from)) {
        startOffer(from, { iceRestart: true });
      }
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
      cleanupPresentationPeerConnections();
      localPresentationStreamRef.current?.getTracks().forEach((track) => track.stop());
      localPresentationStreamRef.current = null;
      setLocalPresentationStream(null);
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
      cleanupPresentationPeerConnections();
      localPresentationStreamRef.current?.getTracks().forEach((track) => track.stop());
      localPresentationStreamRef.current = null;
      setLocalPresentationStream(null);
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
    meetingSocket.on("presentation:started", handlePresentationStarted);
    meetingSocket.on("presentation:stopped", handlePresentationStopped);
    meetingSocket.on("presentation:request-offer", handlePresentationOfferRequested);
    meetingSocket.on("signal:offer", handleOffer);
    meetingSocket.on("signal:answer", handleAnswer);
    meetingSocket.on("signal:ice-candidate", handleIceCandidate);
    meetingSocket.on("media:request-offer", handleMediaOfferRequested);
    meetingSocket.on("signal:presentation-offer", handlePresentationOffer);
    meetingSocket.on("signal:presentation-answer", handlePresentationAnswer);
    meetingSocket.on("signal:presentation-ice-candidate", handlePresentationIceCandidate);

    return () => {
      meetingSocket.off("meeting:sync", handleSync);
      meetingSocket.off("meeting:waiting-updated", handleWaitingUpdated);
      meetingSocket.off("meeting:join-requested", handleJoinRequested);
      meetingSocket.off("meeting:participant-joined", handleParticipantJoined);
      meetingSocket.off("meeting:participant-left", handleParticipantLeft);
      meetingSocket.off("meeting:admitted", handleAdmitted);
      meetingSocket.off("meeting:denied", handleDenied);
      meetingSocket.off("meeting:ended", handleEnded);
      meetingSocket.off("presentation:started", handlePresentationStarted);
      meetingSocket.off("presentation:stopped", handlePresentationStopped);
      meetingSocket.off("presentation:request-offer", handlePresentationOfferRequested);
      meetingSocket.off("signal:offer", handleOffer);
      meetingSocket.off("signal:answer", handleAnswer);
      meetingSocket.off("signal:ice-candidate", handleIceCandidate);
      meetingSocket.off("media:request-offer", handleMediaOfferRequested);
      meetingSocket.off("signal:presentation-offer", handlePresentationOffer);
      meetingSocket.off("signal:presentation-answer", handlePresentationAnswer);
      meetingSocket.off("signal:presentation-ice-candidate", handlePresentationIceCandidate);
    };
  }, [
    cleanupPeerConnections,
    cleanupPresentationPeerConnections,
    handleAnswer,
    handleIceCandidate,
    handleOffer,
    handlePresentationAnswer,
    handlePresentationIceCandidate,
    handlePresentationOffer,
    onAdmitted,
    onDenied,
    onEnded,
    removePeerConnection,
    removePresentationForParticipant,
    requestPresentationOffer,
    shouldInitiateMediaOffer,
    startOffer,
    startPresentationOffer,
    updateStateFromSnapshot
  ]);

  useEffect(() => {
    if (state.status !== "joined" || !selfRef.current) {
      return undefined;
    }

    const remoteParticipants = state.participants.filter((participant) => participant.id !== selfRef.current?.id);
    if (remoteParticipants.length === 0) {
      return undefined;
    }

    const syncMediaMesh = () => {
      remoteParticipants.forEach((participant) => {
        const peerConnection = peerConnections.current.get(participant.id);
        if (peerConnection && !isPeerConnectionClosed(peerConnection)) {
          syncLocalTracksToPeerConnection(peerConnection);
        }

        const remoteStream = remoteStreamsRef.current.get(participant.id);
        const shouldRetryMedia = !hasExpectedRemoteMedia(participant, remoteStream) || needsIceRestart(peerConnection);

        if (!shouldRetryMedia) {
          return;
        }

        if (shouldInitiateMediaOffer(participant.id)) {
          startOffer(participant.id, { iceRestart: needsIceRestart(peerConnection) });
          return;
        }

        requestMediaOffer(participant.id);
      });
    };

    const warmupTimer = window.setTimeout(syncMediaMesh, 700);
    const interval = window.setInterval(syncMediaMesh, 3500);

    return () => {
      window.clearTimeout(warmupTimer);
      window.clearInterval(interval);
    };
  }, [
    mediaState,
    remoteStreams,
    requestMediaOffer,
    shouldInitiateMediaOffer,
    startOffer,
    state.participants,
    state.status,
    syncLocalTracksToPeerConnection
  ]);

  useEffect(() => {
    if (state.status !== "joined" || !selfRef.current) {
      return undefined;
    }

    const remotePresenters = state.participants.filter((participant) => (
      participant.id !== selfRef.current?.id
      && participant.isScreenSharing
    ));

    if (remotePresenters.length === 0) {
      return undefined;
    }

    const syncPresentationMesh = () => {
      remotePresenters.forEach((participant) => {
        const peerConnection = presentationReceivePeerConnections.current.get(participant.id);
        const stream = presentationStreamsRef.current.get(participant.id);
        const shouldRetryPresentation = !hasLivePresentationStream(stream) || needsIceRestart(peerConnection);

        if (shouldRetryPresentation) {
          requestPresentationOffer(participant.id, { force: true });
        }
      });
    };

    const warmupTimer = window.setTimeout(syncPresentationMesh, 900);
    const interval = window.setInterval(syncPresentationMesh, 3500);

    return () => {
      window.clearTimeout(warmupTimer);
      window.clearInterval(interval);
    };
  }, [presentationStreams, requestPresentationOffer, state.participants, state.status]);

  useEffect(() => {
    if (!selfRef.current || !["joined", "waiting"].includes(state.status)) {
      return;
    }

    meetingSocket.emit("participant:update-media", {
      media: mediaState
    });
  }, [mediaState, state.status]);

  const createMeeting = useCallback(
    async (name = "You", activeStream = localStreamRef.current) => {
      localStreamRef.current = activeStream;
      setState((current) => ({ ...current, status: "creating", error: "" }));
      const data = await meetingSocket.emitWithAck("meeting:create", {
        name,
        media: getMediaPayload(activeStream, mediaState)
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
    async ({ code, name, activeStream = localStreamRef.current }) => {
      const meetingCode = normalizeMeetingCode(code);
      localStreamRef.current = activeStream;
      setState((current) => ({ ...current, status: "requesting", error: "" }));

      const data = await meetingSocket.emitWithAck("meeting:request-join", {
        code: meetingCode,
        name,
        media: getMediaPayload(activeStream, mediaState)
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

  const startPresentation = useCallback(
    async ({ includeAudio = false } = {}) => {
      if (localPresentationStreamRef.current) {
        return localPresentationStreamRef.current;
      }

      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("Screen sharing is not supported in this browser.");
      }

      const presentationStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: "always",
          displaySurface: "browser"
        },
        audio: includeAudio
      });

      const videoTrack = presentationStream.getVideoTracks()[0];
      if (!videoTrack) {
        throw new Error("No screen video track was selected.");
      }

      localPresentationStreamRef.current = presentationStream;
      setLocalPresentationStream(presentationStream);

      videoTrack.addEventListener(
        "ended",
        () => {
          stopPresentation(true);
        },
        { once: true }
      );

      const hasAudio = presentationStream.getAudioTracks().length > 0;
      meetingSocket.emit("presentation:started", {
        hasAudio
      });

      state.participants
        .filter((participant) => participant.id !== selfRef.current?.id)
        .forEach((participant) => {
          startPresentationOffer(participant.id);
        });

      return presentationStream;
    },
    [startPresentationOffer, state.participants, stopPresentation]
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

  const leaveMeeting = useCallback(async ({ endForAll = false } = {}) => {
    stopPresentation(false);

    try {
      await meetingSocket.emitWithAck("meeting:leave", {
        endForAll
      });
    } catch {
      // Leaving should still reset the local UI if the server already dropped the socket.
    }

    cleanupPeerConnections();
    cleanupPresentationPeerConnections();
    selfRef.current = null;
    meetingCodeRef.current = "";
    setState(initialState);
  }, [cleanupPeerConnections, cleanupPresentationPeerConnections, stopPresentation]);

  const isHost = useMemo(() => {
    return Boolean(state.self?.isHost);
  }, [state.self]);

  return {
    ...state,
    isHost,
    remoteStreams,
    presentationStreams,
    localPresentationStream,
    isPresenting: Boolean(localPresentationStream),
    createMeeting,
    requestJoin,
    startPresentation,
    stopPresentation,
    admitParticipant,
    admitAll,
    denyParticipant,
    leaveMeeting
  };
}

import { useCallback, useEffect, useMemo, useState } from "react";

const requestUserMedia = async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    return new MediaStream();
  }

  const attempts = [
    {
      audio: true,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user"
      }
    },
    { audio: true, video: false },
    { audio: false, video: true }
  ];

  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch {
      continue;
    }
  }

  return new MediaStream();
};

export function useLocalMedia() {
  const [stream, setStream] = useState(null);
  const [permissionState, setPermissionState] = useState("idle");
  const [error, setError] = useState("");
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);

  const syncTrackState = useCallback((mediaStream) => {
    const audioTrack = mediaStream?.getAudioTracks()[0];
    const videoTrack = mediaStream?.getVideoTracks()[0];

    setIsAudioEnabled(Boolean(audioTrack?.enabled));
    setIsVideoEnabled(Boolean(videoTrack?.enabled));
  }, []);

  const requestPermissions = useCallback(async () => {
    if (stream?.getTracks().some((track) => track.readyState === "live")) {
      setPermissionState("granted");
      syncTrackState(stream);
      return stream;
    }

    setPermissionState("requesting");
    setError("");

    try {
      const mediaStream = await requestUserMedia();
      setStream(mediaStream);
      setPermissionState(mediaStream.getTracks().length > 0 ? "granted" : "unavailable");
      syncTrackState(mediaStream);
      return mediaStream;
    } catch (mediaError) {
      setError(mediaError.message || "Camera and microphone are unavailable.");
      setPermissionState("denied");
      const emptyStream = new MediaStream();
      setStream(emptyStream);
      syncTrackState(emptyStream);
      return emptyStream;
    }
  }, [stream, syncTrackState]);

  const toggleAudio = useCallback(async () => {
    const activeStream = stream ?? (await requestPermissions());
    const audioTrack = activeStream.getAudioTracks()[0];
    if (!audioTrack) {
      setIsAudioEnabled(false);
      return false;
    }

    audioTrack.enabled = !audioTrack.enabled;
    setIsAudioEnabled(audioTrack.enabled);
    return audioTrack.enabled;
  }, [requestPermissions, stream]);

  const toggleVideo = useCallback(async () => {
    const activeStream = stream ?? (await requestPermissions());
    const videoTrack = activeStream.getVideoTracks()[0];
    if (!videoTrack) {
      setIsVideoEnabled(false);
      return false;
    }

    videoTrack.enabled = !videoTrack.enabled;
    setIsVideoEnabled(videoTrack.enabled);
    return videoTrack.enabled;
  }, [requestPermissions, stream]);

  const stop = useCallback(() => {
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setPermissionState("idle");
    setIsAudioEnabled(false);
    setIsVideoEnabled(false);
  }, [stream]);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  const mediaState = useMemo(
    () => ({
      isAudioEnabled,
      isVideoEnabled
    }),
    [isAudioEnabled, isVideoEnabled]
  );

  return {
    stream,
    permissionState,
    error,
    mediaState,
    requestPermissions,
    toggleAudio,
    toggleVideo,
    stop
  };
}

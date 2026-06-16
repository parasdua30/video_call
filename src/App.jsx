import { useEffect, useMemo, useState } from "react";
import { HomePage } from "./components/HomePage.jsx";
import { MeetingRoom } from "./components/MeetingRoom.jsx";
import { PreJoinPage } from "./components/PreJoinPage.jsx";
import { WaitingRoom } from "./components/WaitingRoom.jsx";
import { useLocalMedia } from "./hooks/useLocalMedia.js";
import { useMeeting } from "./hooks/useMeeting.js";
import { isMeetingCode, normalizeMeetingCode } from "./utils/meetingCode.js";

const readInitialRoute = () => {
  const [, route, code] = window.location.pathname.split("/");
  if ((route === "join" || route === "meeting") && code) {
    return {
      view: "prejoin",
      code: normalizeMeetingCode(code)
    };
  }

  return {
    view: "home",
    code: ""
  };
};

export default function App() {
  const [route, setRoute] = useState(readInitialRoute);
  const [codeInput, setCodeInput] = useState("");
  const [guestName, setGuestName] = useState(() => localStorage.getItem("meetClone.displayName") || "");
  const [banner, setBanner] = useState("");
  const localMedia = useLocalMedia();

  const navigate = (nextRoute, path) => {
    window.history.pushState({}, "", path);
    setRoute(nextRoute);
  };

  const meeting = useMeeting({
    localStream: localMedia.stream,
    mediaState: localMedia.mediaState,
    onAdmitted: (code) => navigate({ view: "meeting", code }, `/meeting/${code}`),
    onDenied: (reason) => setBanner(reason || "The host denied your request."),
    onEnded: (reason) => {
      setBanner(reason || "The meeting ended.");
      navigate({ view: "home", code: "" }, "/");
    }
  });

  useEffect(() => {
    const handlePopState = () => setRoute(readInitialRoute());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (guestName.trim()) {
      localStorage.setItem("meetClone.displayName", guestName.trim());
    }
  }, [guestName]);

  const appError = useMemo(() => meeting.error || banner, [banner, meeting.error]);

  const handleCreateMeeting = async () => {
    setBanner("");
    const stream = await localMedia.requestPermissions();

    try {
      const data = await meeting.createMeeting("You", stream);
      navigate({ view: "meeting", code: data.meeting.code }, `/meeting/${data.meeting.code}`);
    } catch (error) {
      setBanner(error.message);
    }
  };

  const handleJoinCode = (code) => {
    const meetingCode = normalizeMeetingCode(code);
    if (!isMeetingCode(meetingCode)) {
      setBanner("Enter a valid meeting code.");
      return;
    }

    setBanner("");
    navigate({ view: "prejoin", code: meetingCode }, `/join/${meetingCode}`);
  };

  const handleAskToJoin = async () => {
    setBanner("");
    const stream = await localMedia.requestPermissions();

    try {
      await meeting.requestJoin({
        code: route.code,
        name: guestName.trim(),
        activeStream: stream
      });
    } catch (error) {
      setBanner(error.message);
    }
  };

  const handleLeave = async () => {
    await meeting.leaveMeeting();
    navigate({ view: "home", code: "" }, "/");
  };

  if (meeting.status === "waiting") {
    return (
      <WaitingRoom
        meeting={meeting.meeting}
        self={meeting.self}
        localStream={localMedia.stream}
        mediaState={localMedia.mediaState}
        onToggleAudio={localMedia.toggleAudio}
        onToggleVideo={localMedia.toggleVideo}
        onLeave={handleLeave}
      />
    );
  }

  if (meeting.status === "joined") {
    return (
      <MeetingRoom
        meeting={meeting.meeting}
        self={meeting.self}
        participants={meeting.participants}
        waiting={meeting.waiting}
        localStream={localMedia.stream}
        remoteStreams={meeting.remoteStreams}
        localPresentationStream={meeting.localPresentationStream}
        presentationStreams={meeting.presentationStreams}
        mediaState={localMedia.mediaState}
        isPresenting={meeting.isPresenting}
        isHost={meeting.isHost}
        onToggleAudio={localMedia.toggleAudio}
        onToggleVideo={localMedia.toggleVideo}
        onStartPresentation={meeting.startPresentation}
        onStopPresentation={meeting.stopPresentation}
        onLeave={handleLeave}
        onAdmit={meeting.admitParticipant}
        onDeny={meeting.denyParticipant}
        onAdmitAll={meeting.admitAll}
      />
    );
  }

  if (route.view === "prejoin") {
    return (
      <PreJoinPage
        code={route.code}
        name={guestName}
        onNameChange={setGuestName}
        media={localMedia}
        onAllowMedia={localMedia.requestPermissions}
        onToggleAudio={localMedia.toggleAudio}
        onToggleVideo={localMedia.toggleVideo}
        onAskToJoin={handleAskToJoin}
        isBusy={meeting.status === "requesting"}
        error={appError}
      />
    );
  }

  return (
    <HomePage
      codeInput={codeInput}
      onCodeChange={(value) => {
        setBanner("");
        setCodeInput(value);
      }}
      onJoinCode={handleJoinCode}
      onCreateMeeting={handleCreateMeeting}
      isBusy={meeting.status === "creating"}
      error={appError}
    />
  );
}

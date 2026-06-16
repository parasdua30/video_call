import { Copy, Info, MessageSquare, ShieldCheck, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { meetingLinkFor } from "../utils/meetingCode.js";
import { ControlBar } from "./ControlBar.jsx";
import { PeoplePanel } from "./PeoplePanel.jsx";
import { VideoTile } from "./VideoTile.jsx";

const gridClassFor = (count) => {
  if (count <= 1) return "tile-grid-one";
  if (count === 2) return "tile-grid-two";
  if (count <= 4) return "tile-grid-four";
  return "tile-grid-many";
};

export function MeetingRoom({
  meeting,
  self,
  participants,
  waiting,
  localStream,
  remoteStreams,
  mediaState,
  isHost,
  onToggleAudio,
  onToggleVideo,
  onLeave,
  onAdmit,
  onDeny,
  onAdmitAll
}) {
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [copyState, setCopyState] = useState("idle");
  const meetingCode = meeting?.code || "";
  const selfId = self?.id;

  const tiles = useMemo(() => {
    const selfParticipant = participants.find((participant) => participant.id === selfId) ?? self;
    const remoteParticipants = participants.filter((participant) => participant.id !== selfId);

    return [
      {
        participant: {
          ...selfParticipant,
          isAudioEnabled: mediaState.isAudioEnabled,
          isVideoEnabled: mediaState.isVideoEnabled
        },
        stream: localStream,
        isLocal: true
      },
      ...remoteParticipants.map((participant) => ({
        participant,
        stream: remoteStreams.get(participant.id),
        isLocal: false
      }))
    ].filter((tile) => tile.participant);
  }, [localStream, mediaState, participants, remoteStreams, self, selfId]);

  const copyInvite = async () => {
    await navigator.clipboard?.writeText(meetingLinkFor(meetingCode));
    setCopyState("copied");
    window.setTimeout(() => setCopyState("idle"), 1600);
  };

  return (
    <main className={`meeting-room ${peopleOpen ? "has-panel" : ""}`}>
      <header className="meeting-topbar">
        <div className="meeting-meta">
          <span>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          <span className="meta-divider" />
          <strong>{meetingCode}</strong>
          <Info size={18} />
        </div>
        <div className="meeting-top-actions">
          {isHost && waiting.length > 0 ? (
            <button className="admit-guest-pill" type="button" onClick={() => setPeopleOpen(true)}>
              <Users size={19} /> Admit {waiting.length} guest{waiting.length > 1 ? "s" : ""}
            </button>
          ) : null}
          <button className="copy-link-button" type="button" onClick={copyInvite}>
            <Copy size={17} />
            {copyState === "copied" ? "Copied" : "Copy link"}
          </button>
        </div>
      </header>

      <section className={`video-grid ${gridClassFor(tiles.length)}`} aria-label="Participants">
        {tiles.map((tile) => (
          <VideoTile
            key={tile.participant.id}
            participant={tile.participant}
            selfId={selfId}
            stream={tile.stream}
            isLocal={tile.isLocal}
          />
        ))}
      </section>

      <PeoplePanel
        open={peopleOpen}
        isHost={isHost}
        selfId={selfId}
        participants={participants}
        waiting={waiting}
        onClose={() => setPeopleOpen(false)}
        onAdmit={onAdmit}
        onDeny={onDeny}
        onAdmitAll={onAdmitAll}
      />

      <div className="meeting-corner-actions" aria-label="Meeting panels">
        <button type="button" aria-label="Chat">
          <MessageSquare size={24} />
        </button>
        <button type="button" aria-label="People" onClick={() => setPeopleOpen(true)}>
          <Users size={24} />
        </button>
        <button type="button" aria-label="Host controls">
          <ShieldCheck size={24} />
        </button>
      </div>

      <ControlBar
        mediaState={mediaState}
        onToggleAudio={onToggleAudio}
        onToggleVideo={onToggleVideo}
        onLeave={onLeave}
        onTogglePeople={() => setPeopleOpen((value) => !value)}
        peopleOpen={peopleOpen}
      />
    </main>
  );
}

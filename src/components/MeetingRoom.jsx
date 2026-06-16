import { Copy, Info, MessageSquare, MonitorUp, ShieldCheck, Users, Volume2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { meetingLinkFor } from "../utils/meetingCode.js";
import { ControlBar } from "./ControlBar.jsx";
import { PeoplePanel } from "./PeoplePanel.jsx";
import { StreamVideo } from "./StreamVideo.jsx";
import { VideoTile } from "./VideoTile.jsx";

const gridClassFor = (count) => {
  if (count <= 1) return "tile-grid-one";
  if (count === 2) return "tile-grid-two";
  if (count <= 4) return "tile-grid-four";
  return "tile-grid-many";
};

function PresentationTile({ presentation, selfId }) {
  const isLocal = presentation.isLocal ?? presentation.participant.id === selfId;
  const title = isLocal
    ? `${presentation.participant.name} (You, presenting)`
    : `${presentation.participant.name} is presenting`;

  return (
    <article className="presentation-tile">
      {presentation.stream ? (
        <StreamVideo stream={presentation.stream} muted={isLocal} className="presentation-video" />
      ) : (
        <div className="presentation-placeholder">
          <MonitorUp size={48} />
          <span>Presentation is connecting</span>
        </div>
      )}
      <div className="presentation-tile-label">
        <MonitorUp size={18} />
        <span>{title}</span>
        {presentation.participant.hasPresentationAudio ? (
          <>
            <span className="meta-divider" />
            <Volume2 size={18} />
            <span>Presentation audio</span>
          </>
        ) : null}
      </div>
    </article>
  );
}

export function MeetingRoom({
  meeting,
  self,
  participants,
  waiting,
  localStream,
  remoteStreams,
  localPresentationStream,
  presentationStreams,
  mediaState,
  isPresenting,
  isHost,
  onToggleAudio,
  onToggleVideo,
  onStartPresentation,
  onStopPresentation,
  onLeave,
  onAdmit,
  onDeny,
  onAdmitAll
}) {
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [copyState, setCopyState] = useState("idle");
  const [presentationMenuOpen, setPresentationMenuOpen] = useState(false);
  const [includePresentationAudio, setIncludePresentationAudio] = useState(true);
  const [presentationError, setPresentationError] = useState("");
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

  const presentationTiles = useMemo(() => {
    const localParticipant = participants.find((participant) => participant.id === selfId) ?? self;
    const activeTiles = [];

    if (localPresentationStream && localParticipant) {
      activeTiles.push({
        id: `presentation-${selfId}`,
        participant: {
          ...localParticipant,
          isScreenSharing: true,
          hasPresentationAudio: localPresentationStream.getAudioTracks().length > 0
        },
        stream: localPresentationStream,
        isLocal: true
      });
    }

    participants
      .filter((participant) => participant.id !== selfId && participant.isScreenSharing)
      .forEach((participant) => {
        activeTiles.push({
          id: `presentation-${participant.id}`,
          participant,
          stream: presentationStreams.get(participant.id),
          isLocal: false
        });
      });

    return activeTiles;
  }, [localPresentationStream, participants, presentationStreams, self, selfId]);

  const allTileCount = tiles.length + presentationTiles.length;
  const hasPresentationTiles = presentationTiles.length > 0;

  const copyInvite = async () => {
    await navigator.clipboard?.writeText(meetingLinkFor(meetingCode));
    setCopyState("copied");
    window.setTimeout(() => setCopyState("idle"), 1600);
  };

  const openPresentationMenu = () => {
    setPresentationError("");
    if (isPresenting) {
      onStopPresentation();
      return;
    }

    setPresentationMenuOpen(true);
  };

  const sharePresentation = async () => {
    setPresentationError("");
    try {
      await onStartPresentation({ includeAudio: includePresentationAudio });
      setPresentationMenuOpen(false);
    } catch (error) {
      setPresentationError(error.message || "Could not start presenting.");
    }
  };

  return (
    <main className={`meeting-room ${peopleOpen ? "has-panel" : ""} ${hasPresentationTiles ? "has-presentation" : ""}`}>
      <header className="meeting-topbar">
        <div className="meeting-meta">
          <span>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          <span className="meta-divider" />
          <strong>{meetingCode}</strong>
          <Info size={18} />
        </div>
        <div className="meeting-top-actions">
          {isPresenting ? (
            <div className="presenting-pill">
              <MonitorUp size={18} />
              <span>{self?.name || "You"} (You, presenting)</span>
              {localPresentationStream?.getAudioTracks().length > 0 ? (
                <>
                  <span className="meta-divider" />
                  <Volume2 size={18} />
                  <span>Presentation audio</span>
                </>
              ) : null}
              <button type="button" onClick={onStopPresentation}>
                Stop presenting
              </button>
            </div>
          ) : null}
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

      <section
        className={`video-grid ${hasPresentationTiles ? "has-presentation-tiles" : ""} ${gridClassFor(allTileCount)}`}
        aria-label="Participants and presentations"
      >
        {presentationTiles.map((presentation) => (
          <PresentationTile key={presentation.id} presentation={presentation} selfId={selfId} />
        ))}
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

      {presentationMenuOpen ? (
        <div className="presentation-menu" role="dialog" aria-label="Present now">
          <div className="presentation-menu-header">
            <strong>Present now</strong>
            <button type="button" onClick={() => setPresentationMenuOpen(false)} aria-label="Close">
              <X size={20} />
            </button>
          </div>
          <label className="presentation-audio-toggle">
            <span>
              <Volume2 size={20} />
              Presentation audio
            </span>
            <input
              type="checkbox"
              checked={includePresentationAudio}
              onChange={(event) => setIncludePresentationAudio(event.target.checked)}
            />
          </label>
          {presentationError ? <p className="inline-error">{presentationError}</p> : null}
          <button className="presentation-share-button" type="button" onClick={sharePresentation}>
            <MonitorUp size={20} />
            Share screen
          </button>
        </div>
      ) : null}

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
        isPresenting={isPresenting}
        onToggleAudio={onToggleAudio}
        onToggleVideo={onToggleVideo}
        onTogglePresentation={openPresentationMenu}
        onLeave={onLeave}
        onTogglePeople={() => setPeopleOpen((value) => !value)}
        peopleOpen={peopleOpen}
      />
    </main>
  );
}

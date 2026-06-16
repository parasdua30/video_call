import { Mic, MicOff, VideoOff } from "lucide-react";
import { Avatar } from "./Avatar.jsx";
import { StreamVideo } from "./StreamVideo.jsx";
import { formatParticipantName } from "../utils/participant.js";

export function VideoTile({ participant, selfId, stream, isLocal = false }) {
  const hasVideo = Boolean(stream && participant?.isVideoEnabled);
  const displayName = formatParticipantName(participant, selfId);

  return (
    <article className={`video-tile ${hasVideo ? "has-video" : ""}`}>
      {hasVideo ? (
        <StreamVideo stream={stream} muted={isLocal} />
      ) : (
        <div className="tile-avatar-wrap">
          <Avatar name={participant?.name} initials={participant?.initials} size="large" />
          <VideoOff size={20} className="tile-muted-video" />
        </div>
      )}
      <div className="tile-footer">
        <span>{displayName}</span>
        <span className={`tile-audio ${participant?.isAudioEnabled ? "" : "is-muted"}`}>
          {participant?.isAudioEnabled ? <Mic size={16} /> : <MicOff size={16} />}
        </span>
      </div>
    </article>
  );
}

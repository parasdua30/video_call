import {
  Captions,
  Hand,
  Mic,
  MicOff,
  MonitorUp,
  MoreVertical,
  PhoneOff,
  Smile,
  Users,
  Video,
  VideoOff
} from "lucide-react";
import { IconButton } from "./IconButton.jsx";

export function ControlBar({
  mediaState,
  isPresenting,
  onToggleAudio,
  onToggleVideo,
  onTogglePresentation,
  onLeave,
  onTogglePeople,
  peopleOpen
}) {
  return (
    <footer className="control-bar" aria-label="Meeting controls">
      <div className="control-group">
        <IconButton
          icon={mediaState.isAudioEnabled ? Mic : MicOff}
          label={mediaState.isAudioEnabled ? "Mute microphone" : "Unmute microphone"}
          active={mediaState.isAudioEnabled}
          onClick={onToggleAudio}
        />
        <IconButton
          icon={mediaState.isVideoEnabled ? Video : VideoOff}
          label={mediaState.isVideoEnabled ? "Turn camera off" : "Turn camera on"}
          active={mediaState.isVideoEnabled}
          onClick={onToggleVideo}
        />
      </div>
      <div className="control-group control-group-secondary">
        <IconButton
          icon={MonitorUp}
          label={isPresenting ? "Stop presenting" : "Present now"}
          active={isPresenting}
          onClick={onTogglePresentation}
        />
        <IconButton icon={Smile} label="Reactions" />
        <IconButton icon={Captions} label="Captions" />
        <IconButton icon={Hand} label="Raise hand" />
        <IconButton icon={MoreVertical} label="More options" />
      </div>
      <IconButton icon={PhoneOff} label="Leave call" danger onClick={onLeave} />
      <button
        type="button"
        className={`people-mobile-toggle ${peopleOpen ? "is-active" : ""}`}
        onClick={onTogglePeople}
        aria-label="People"
        title="People"
      >
        <Users size={22} />
      </button>
    </footer>
  );
}

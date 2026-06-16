import { Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";
import { IconButton } from "./IconButton.jsx";
import { VideoTile } from "./VideoTile.jsx";

export function WaitingRoom({ meeting, self, localStream, mediaState, onToggleAudio, onToggleVideo, onLeave }) {
  return (
    <main className="waiting-room">
      <div className="waiting-illustration" aria-hidden="true">
        <div className="person-shape" />
        <div className="chair-shape left" />
        <div className="chair-shape right" />
      </div>
      <p className="waiting-message">
        <span className="waiting-spinner" />
        Please wait until a meeting host brings you into the call
      </p>
      <div className="waiting-preview">
        <VideoTile
          participant={{ ...self, isAudioEnabled: mediaState.isAudioEnabled, isVideoEnabled: mediaState.isVideoEnabled }}
          selfId={self?.id}
          stream={localStream}
          isLocal
        />
      </div>
      <footer className="waiting-controls">
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
        <IconButton icon={PhoneOff} label={`Leave ${meeting?.code || "meeting"}`} danger onClick={onLeave} />
      </footer>
    </main>
  );
}

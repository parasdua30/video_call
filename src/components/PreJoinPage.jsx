import { ChevronDown, ImagePlus, Mic, MicOff, MoreVertical, Video, VideoOff, Volume2 } from "lucide-react";
import { Avatar } from "./Avatar.jsx";
import { StreamVideo } from "./StreamVideo.jsx";

export function PreJoinPage({
  code,
  name,
  onNameChange,
  media,
  onAllowMedia,
  onToggleAudio,
  onToggleVideo,
  onAskToJoin,
  isBusy,
  error
}) {
  const canAskToJoin = name.trim().length > 0 && !isBusy;
  const hasVideo = Boolean(media.stream && media.mediaState.isVideoEnabled);
  const nameLength = name.length;

  return (
    <main className="prejoin-page">
      <section className="prejoin-preview" aria-label="Camera preview">
        <button type="button" className="preview-more" aria-label="More preview options">
          <MoreVertical size={24} />
        </button>
        {hasVideo ? (
          <StreamVideo stream={media.stream} muted />
        ) : (
          <div className="permission-prompt">
            <Avatar name={name || "Guest"} size="large" />
            <p>Do you want people to see and hear you in the meeting?</p>
            <button className="blue-rectangle-button" type="button" onClick={onAllowMedia} disabled={media.permissionState === "requesting"}>
              {media.permissionState === "requesting" ? "Requesting..." : "Allow microphone and camera"}
            </button>
          </div>
        )}
        <div className="preview-controls">
          <button type="button" className="round-outline-button" onClick={onToggleAudio} aria-label="Toggle microphone">
            {media.mediaState.isAudioEnabled ? <Mic size={25} /> : <MicOff size={25} />}
          </button>
          <button type="button" className="round-outline-button" onClick={onToggleVideo} aria-label="Toggle camera">
            {media.mediaState.isVideoEnabled ? <Video size={25} /> : <VideoOff size={25} />}
          </button>
          <button type="button" className="round-outline-button" aria-label="Visual effects">
            <ImagePlus size={25} />
          </button>
        </div>
      </section>

      <section className="prejoin-form">
        <p className="prejoin-code">Meeting {code}</p>
        <h2>What's your name?</h2>
        <label className="name-field">
          <input
            value={name}
            maxLength={60}
            onChange={(event) => onNameChange(event.target.value.slice(0, 60))}
            placeholder="Your name"
            aria-label="Your name"
          />
          <span>{nameLength}/60</span>
        </label>
        {error ? <p className="inline-error">{error}</p> : null}
        {media.error ? <p className="soft-warning">{media.error}</p> : null}
        <button className="ask-join-button" type="button" onClick={onAskToJoin} disabled={!canAskToJoin}>
          {isBusy ? "Asking..." : "Ask to join"}
        </button>
        <button className="other-ways-button" type="button">
          Other ways to join <ChevronDown size={18} />
        </button>
      </section>

      <div className="device-row" aria-label="Device permissions">
        <button type="button">
          <Mic size={18} /> Permission <ChevronDown size={16} />
        </button>
        <button type="button">
          <Volume2 size={18} /> Permission <ChevronDown size={16} />
        </button>
        <button type="button">
          <Video size={18} /> Permission <ChevronDown size={16} />
        </button>
      </div>
    </main>
  );
}

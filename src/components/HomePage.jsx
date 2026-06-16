import { Keyboard, Video } from "lucide-react";
import { isMeetingCode, normalizeMeetingCode } from "../utils/meetingCode.js";

export function HomePage({ codeInput, onCodeChange, onJoinCode, onCreateMeeting, isBusy, error }) {
  const normalizedCode = normalizeMeetingCode(codeInput);
  const canJoin = isMeetingCode(normalizedCode);

  return (
    <main className="home-page">
      <section className="home-content">
        <p className="product-mark">Meet Clone</p>
        <h1>Video calls and meetings for everyone</h1>
        <p className="home-subtitle">Connect, collaborate, and celebrate from anywhere.</p>
        <div className="home-actions">
          <button className="primary-button new-meeting-button" type="button" onClick={onCreateMeeting} disabled={isBusy}>
            <Video size={23} />
            <span>{isBusy ? "Starting..." : "New meeting"}</span>
          </button>
          <label className="code-entry">
            <Keyboard size={25} />
            <input
              value={codeInput}
              onChange={(event) => onCodeChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canJoin) {
                  onJoinCode(normalizedCode);
                }
              }}
              placeholder="Enter a code or link"
              aria-label="Enter a code or link"
            />
          </label>
          <button className="join-button" type="button" onClick={() => onJoinCode(normalizedCode)} disabled={!canJoin}>
            Join
          </button>
        </div>
        {error ? <p className="inline-error">{error}</p> : null}
      </section>
    </main>
  );
}

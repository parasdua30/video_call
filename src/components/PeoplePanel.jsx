import { Search, UserPlus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "./Avatar.jsx";
import { formatParticipantName } from "../utils/participant.js";

export function PeoplePanel({
  open,
  isHost,
  selfId,
  participants,
  waiting,
  onClose,
  onAdmit,
  onDeny,
  onAdmitAll
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleParticipants = useMemo(() => {
    if (!normalizedQuery) {
      return participants;
    }

    return participants.filter((participant) => participant.name.toLowerCase().includes(normalizedQuery));
  }, [normalizedQuery, participants]);

  return (
    <aside className={`people-panel ${open ? "is-open" : ""}`} aria-label="People">
      <div className="people-panel-header">
        <h2>People</h2>
        <button type="button" className="plain-icon-button" onClick={onClose} aria-label="Close people panel">
          <X size={30} />
        </button>
      </div>
      <button className="add-people-button" type="button">
        <UserPlus size={26} />
        Add people
      </button>
      <label className="people-search">
        <Search size={28} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search for people" />
      </label>

      {isHost ? (
        <section className="people-section">
          <p className="section-kicker">Waiting to join</p>
          <div className="people-list">
            <div className="people-list-title">
              <strong>Waiting to be admitted</strong>
              <span>{waiting.length}</span>
            </div>
            {waiting.length > 0 ? (
              <>
                <button type="button" className="admit-all-button" onClick={onAdmitAll}>
                  Admit all
                </button>
                {waiting.map((participant) => (
                  <div className="person-row" key={participant.id}>
                    <Avatar name={participant.name} initials={participant.initials} />
                    <div>
                      <strong>{participant.name}</strong>
                      <span>Waiting</span>
                    </div>
                    <button type="button" className="text-action" onClick={() => onAdmit(participant.id)}>
                      Admit
                    </button>
                    <button type="button" className="muted-text-action" onClick={() => onDeny(participant.id)}>
                      Deny
                    </button>
                  </div>
                ))}
              </>
            ) : (
              <p className="empty-panel-copy">No one is waiting.</p>
            )}
          </div>
        </section>
      ) : null}

      <section className="people-section">
        <p className="section-kicker">In the meeting</p>
        <div className="people-list">
          <div className="people-list-title">
            <strong>Contributors</strong>
            <span>{participants.length}</span>
          </div>
          {visibleParticipants.map((participant) => (
            <div className="person-row" key={participant.id}>
              <Avatar name={participant.name} initials={participant.initials} />
              <div>
                <strong>{formatParticipantName(participant, selfId)}</strong>
                <span>{participant.isHost ? "Meeting host" : "Guest"}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}

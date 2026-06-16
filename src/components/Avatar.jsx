import { getInitials } from "../utils/participant.js";

export function Avatar({ name, initials, size = "medium" }) {
  return (
    <div className={`avatar avatar-${size}`} aria-hidden="true">
      {initials || getInitials(name)}
    </div>
  );
}

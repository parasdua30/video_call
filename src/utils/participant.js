export const getInitials = (name = "Guest") => {
  return String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "G";
};

export const formatParticipantName = (participant, selfId) => {
  if (!participant) {
    return "Guest";
  }

  return participant.id === selfId ? `${participant.name} (You)` : participant.name;
};

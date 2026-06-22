export const normalizeMeetingCode = (value = "") => {
  const lastSegment = String(value).trim().split("/").filter(Boolean).at(-1) ?? "";
  return lastSegment.toLowerCase().replace(/[^a-z0-9-]/g, "");
};

export const isMeetingCode = (value = "") => {
  return /^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/.test(normalizeMeetingCode(value));
};

export const meetingLinkFor = (code) => {
  return `${window.location.origin}/meeting/${normalizeMeetingCode(code)}`;
};

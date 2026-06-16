const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";

const randomSegment = (length) => {
  let segment = "";
  for (let index = 0; index < length; index += 1) {
    segment += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return segment;
};

export const createMeetingCode = () => {
  return `${randomSegment(3)}-${randomSegment(4)}-${randomSegment(3)}`;
};

export const normalizeMeetingCode = (code = "") => {
  const fromUrl = String(code).trim().split("/").filter(Boolean).at(-1) ?? "";
  return fromUrl.toLowerCase().replace(/[^a-z0-9-]/g, "");
};

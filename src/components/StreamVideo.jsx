import { useEffect, useRef } from "react";

export function StreamVideo({ stream, muted = false, className = "" }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream ?? null;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={muted}
      className={`stream-video ${className}`}
    />
  );
}

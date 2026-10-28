import { useCallback, useEffect, useRef, useState } from "react";

function chooseMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    .find((type) => MediaRecorder.isTypeSupported(type));
}

export function useMediaRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback((stream: MediaStream) => {
    if (typeof MediaRecorder === "undefined") {
      setError("Video recording is not supported by this browser.");
      return false;
    }
    if (recorderRef.current?.state === "recording") return true;
    try {
      chunksRef.current = [];
      const mimeType = chooseMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const onTrackEnded = () => {
        if (recorder.state === "recording") {
          setError("A camera or microphone device disconnected. The answer transcript will still be saved.");
        }
      };
      stream.getTracks().forEach((track) => track.addEventListener("ended", onTrackEnded));
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError("The recording stopped unexpectedly. Your transcript will still be saved.");
        setIsRecording(false);
      };
      recorder.onstart = () => setIsRecording(true);
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.removeEventListener("ended", onTrackEnded));
        setIsRecording(false);
      };
      recorder.start(500);
      recorderRef.current = recorder;
      setError(null);
      return true;
    } catch {
      setError("Could not start recording. Check camera and microphone permissions.");
      setIsRecording(false);
      return false;
    }
  }, []);

  const stop = useCallback((): Promise<Blob | undefined> => {
    const recorder = recorderRef.current;
    if (!recorder) return Promise.resolve(undefined);
    if (recorder.state === "inactive") {
      const blob = chunksRef.current.length
        ? new Blob(chunksRef.current, { type: chunksRef.current[0].type || "video/webm" })
        : undefined;
      recorderRef.current = null;
      return Promise.resolve(blob);
    }
    return new Promise((resolve) => {
      recorder.addEventListener("stop", () => {
        const blob = chunksRef.current.length
          ? new Blob(chunksRef.current, { type: chunksRef.current[0].type || "video/webm" })
          : undefined;
        recorderRef.current = null;
        resolve(blob);
      }, { once: true });
      try {
        recorder.stop();
      } catch {
        setError("The recording stopped unexpectedly. Your transcript will still be saved.");
        const blob = chunksRef.current.length
          ? new Blob(chunksRef.current, { type: chunksRef.current[0].type || "video/webm" })
          : undefined;
        recorderRef.current = null;
        resolve(blob);
      }
    });
  }, []);

  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorderRef.current = null;
  }, []);

  return { start, stop, isRecording, error };
}

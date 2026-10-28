import { useCallback, useEffect, useRef, useState } from "react";

function getRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

function formatRecognitionError(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was denied. Allow microphone access in your browser settings, then try again.";
    case "no-speech":
      return "No speech detected. Try speaking a little closer to your microphone.";
    case "network":
      return "A network error interrupted speech recognition. Check your connection and try again.";
    case "language-not-supported":
      return "This language is not supported by your browser's speech recognition service.";
    case "audio-capture":
      return "No microphone was found. Connect a microphone and try again.";
    default:
      return "Speech recognition ran into a problem. Please try again.";
  }
}

function appendPhrase(current: string, phrase: string): string {
  const cleanPhrase = phrase.trim();
  if (!cleanPhrase) return current;
  if (!current) return cleanPhrase;
  if (/\s$/.test(current) || /^[,.;:!?]/.test(cleanPhrase)) {
    return `${current}${cleanPhrase}`;
  }
  return `${current} ${cleanPhrase}`;
}

export function useSpeechRecognition() {
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSupported] = useState(() => Boolean(getRecognitionConstructor()));
  const transcriptRef = useRef("");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const recognitionRunningRef = useRef(false);
  const shouldListenRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFinalIndexRef = useRef(-1);
  const mountedRef = useRef(true);

  const updateTranscript = useCallback((value: string) => {
    transcriptRef.current = value;
    setTranscript(value);
  }, []);

  const stop = useCallback(() => {
    shouldListenRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    setIsListening(false);
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback((language = "en-IN") => {
    const Recognition = getRecognitionConstructor();
    if (!Recognition) {
      setError("Speech recognition is not supported in this browser. Try Chrome or Edge.");
      return;
    }

    setError(null);
    shouldListenRef.current = true;
    setInterimTranscript("");

    let recognition = recognitionRef.current;
    if (!recognition) {
      recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognitionRef.current = recognition;

      recognition.onstart = () => {
        recognitionRunningRef.current = true;
        if (mountedRef.current && shouldListenRef.current) setIsListening(true);
      };
      recognition.onresult = (event) => {
        if (!mountedRef.current) return;
        let interim = "";
        for (let index = 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          const phrase = result[0]?.transcript ?? "";
          if (result.isFinal) {
            if (index > lastFinalIndexRef.current) {
              updateTranscript(appendPhrase(transcriptRef.current, phrase));
              lastFinalIndexRef.current = index;
            }
          } else {
            interim += phrase;
          }
        }
        setInterimTranscript(interim);
        if (interim || event.results.length > 0) setError(null);
      };
      recognition.onerror = (event) => {
        if (!mountedRef.current) return;
        setError(formatRecognitionError(event.error));
        if (
          event.error === "not-allowed" ||
          event.error === "service-not-allowed" ||
          event.error === "language-not-supported"
        ) {
          shouldListenRef.current = false;
          setIsListening(false);
        }
      };
      recognition.onend = () => {
        recognitionRunningRef.current = false;
        if (!mountedRef.current) return;
        if (shouldListenRef.current) {
          setIsListening(true);
          lastFinalIndexRef.current = -1;
          restartTimerRef.current = setTimeout(() => {
            restartTimerRef.current = null;
            if (!shouldListenRef.current || !recognitionRef.current) return;
            try {
              recognitionRef.current.start();
            } catch {
              if (mountedRef.current) {
                shouldListenRef.current = false;
                setIsListening(false);
                setError("Speech recognition could not restart. Please start dictation again.");
              }
            }
          }, 250);
        } else {
          setIsListening(false);
          setInterimTranscript("");
        }
      };
    }

    recognition.lang = language;
    lastFinalIndexRef.current = -1;
    if (recognitionRunningRef.current) return;
    try {
      recognition.start();
    } catch {
      shouldListenRef.current = false;
      setIsListening(false);
      setError("Speech recognition could not start. Please try again.");
    }
  }, [updateTranscript]);

  const reset = useCallback(() => {
    updateTranscript("");
    setInterimTranscript("");
    setError(null);
  }, [updateTranscript]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      shouldListenRef.current = false;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      const recognition = recognitionRef.current;
      if (recognition) {
        recognition.onstart = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    transcript,
    interimTranscript,
    isListening,
    start,
    stop,
    reset,
    error,
    isSupported,
    updateTranscript,
  };
}

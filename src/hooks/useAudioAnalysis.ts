import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioMetrics } from "../interview/scoring";

const EMPTY_METRICS: AudioMetrics = {
  averageLevel: 0,
  levelVariation: 0,
  estimatedPitchVariation: 0,
  longPauseSeconds: 0,
  paceSamples: [],
};

export function useAudioAnalysis() {
  const contextRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<number | null>(null);
  const pauseSinceRef = useRef<number | null>(null);
  const pauseTotalRef = useRef(0);
  const levelsRef = useRef<number[]>([]);
  const pitchesRef = useRef<number[]>([]);
  const [metrics, setMetrics] = useState<AudioMetrics>(EMPTY_METRICS);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(async (): Promise<AudioMetrics> => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== "closed") await context.close();
    const levels = levelsRef.current;
    const average = levels.length ? levels.reduce((sum, item) => sum + item, 0) / levels.length : 0;
    const variance = levels.length
      ? levels.reduce((sum, item) => sum + (item - average) ** 2, 0) / levels.length
      : 0;
    const pitchValues = pitchesRef.current;
    const pitchAverage = pitchValues.length
      ? pitchValues.reduce((sum, item) => sum + item, 0) / pitchValues.length
      : 0;
    const pitchDeviation = pitchValues.length
      ? Math.sqrt(pitchValues.reduce((sum, item) => sum + (item - pitchAverage) ** 2, 0) / pitchValues.length)
      : 0;
    const result = {
      averageLevel: average,
      levelVariation: Math.sqrt(variance),
      estimatedPitchVariation: pitchDeviation,
      longPauseSeconds: pauseTotalRef.current,
      paceSamples: [],
    };
    setMetrics(result);
    pauseSinceRef.current = null;
    return result;
  }, []);

  const start = useCallback((stream: MediaStream) => {
    if (typeof AudioContext === "undefined") {
      setError("Audio analysis is not supported. The interview can continue without voice estimates.");
      return;
    }
    void stop().then(async () => {
      try {
        const context = new AudioContext();
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        contextRef.current = context;
        levelsRef.current = [];
        pitchesRef.current = [];
        pauseTotalRef.current = 0;
        pauseSinceRef.current = null;
        const samples = new Float32Array(analyser.fftSize);
        intervalRef.current = window.setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          let crossings = 0;
          for (let index = 0; index < samples.length; index += 1) {
            sum += samples[index] * samples[index];
            if (index > 0 && (samples[index - 1] < 0) !== (samples[index] < 0)) crossings += 1;
          }
          const rms = Math.sqrt(sum / samples.length);
          levelsRef.current.push(rms);
          if (crossings) pitchesRef.current.push(crossings * context.sampleRate / (2 * samples.length));
          const now = performance.now();
          if (rms < 0.012) {
            if (pauseSinceRef.current === null) pauseSinceRef.current = now;
            if (now - pauseSinceRef.current >= 1_000) pauseTotalRef.current += 0.1;
          } else if (pauseSinceRef.current !== null) {
            pauseSinceRef.current = null;
          }
        }, 100);
        setError(null);
      } catch {
        setError("Audio analysis could not start. Recording will continue without voice estimates.");
      }
    });
  }, [stop]);

  useEffect(() => () => {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    if (contextRef.current && contextRef.current.state !== "closed") void contextRef.current.close();
  }, []);

  return { metrics, start, stop, error };
}

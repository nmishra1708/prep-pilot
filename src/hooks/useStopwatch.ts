import { useCallback, useEffect, useRef, useState } from "react";

export function useStopwatch() {
  const [elapsedMs, setElapsedMs] = useState(0);
  const runningSinceRef = useRef<number | null>(null);
  const accumulatedRef = useRef(0);

  const start = useCallback(() => {
    if (runningSinceRef.current !== null) return;
    runningSinceRef.current = performance.now();
    setElapsedMs(accumulatedRef.current);
  }, []);

  const stop = useCallback(() => {
    if (runningSinceRef.current === null) return;
    accumulatedRef.current += performance.now() - runningSinceRef.current;
    runningSinceRef.current = null;
    setElapsedMs(accumulatedRef.current);
  }, []);

  const reset = useCallback(() => {
    runningSinceRef.current = null;
    accumulatedRef.current = 0;
    setElapsedMs(0);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (runningSinceRef.current !== null) {
        setElapsedMs(accumulatedRef.current + performance.now() - runningSinceRef.current);
      }
    }, 200);
    return () => window.clearInterval(interval);
  }, []);

  return { elapsedMs, start, stop, reset };
}

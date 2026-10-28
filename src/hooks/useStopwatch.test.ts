import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStopwatch } from "./useStopwatch";

describe("useStopwatch", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("tracks elapsed time and pauses without losing accumulated duration", () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { result } = renderHook(() => useStopwatch());
    act(() => result.current.start());
    act(() => {
      now += 2_400;
      vi.advanceTimersByTime(2_400);
    });
    expect(result.current.elapsedMs).toBe(2_400);

    act(() => result.current.stop());
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.elapsedMs).toBe(2_400);

    act(() => result.current.start());
    act(() => {
      now += 1_600;
      vi.advanceTimersByTime(1_600);
    });
    expect(result.current.elapsedMs).toBe(4_000);
    act(() => result.current.reset());
    expect(result.current.elapsedMs).toBe(0);
  });
});

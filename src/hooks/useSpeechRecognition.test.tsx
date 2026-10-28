import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpeechRecognition } from "./useSpeechRecognition";

class MockRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onstart: (() => void) | null = null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null = null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(() => this.onstart?.());
  stop = vi.fn();
  abort = vi.fn();
}

let recognition: MockRecognition;

class MockRecognitionConstructor extends MockRecognition {
  constructor() {
    super();
    recognition = this;
  }
}

function mockResult(text: string, isFinal: boolean): SpeechRecognitionResult {
  return Object.assign([{ transcript: text }], { isFinal }) as unknown as SpeechRecognitionResult;
}

function dispatchResults(recognition: MockRecognition, results: SpeechRecognitionResult[]) {
  const event = {
    resultIndex: 0,
    results: Object.assign(results, { length: results.length }),
  } as unknown as SpeechRecognitionEvent;
  act(() => recognition.onresult?.(event));
}

describe("useSpeechRecognition", () => {
  beforeEach(() => {
    recognition = new MockRecognition();
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: MockRecognitionConstructor,
    });
  });

  afterEach(() => {
    delete window.SpeechRecognition;
  });

  it("configures continuous recognition and replaces interim speech with final text", () => {
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => result.current.start("en-GB"));

    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);
    expect(recognition.lang).toBe("en-GB");
    expect(result.current.isListening).toBe(true);

    dispatchResults(recognition, [mockResult("hello world", false)]);
    expect(result.current.interimTranscript).toBe("hello world");
    expect(result.current.transcript).toBe("");

    dispatchResults(recognition, [mockResult("hello world", true)]);
    expect(result.current.interimTranscript).toBe("");
    expect(result.current.transcript).toBe("hello world");
  });

  it("preserves manual edits when final speech arrives and stops cleanly", () => {
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => result.current.start());
    act(() => result.current.updateTranscript("My edited words"));
    dispatchResults(recognition, [mockResult("and more", true)]);

    expect(result.current.transcript).toBe("My edited words and more");
    act(() => result.current.stop());
    expect(recognition.stop).toHaveBeenCalledOnce();
    expect(result.current.isListening).toBe(false);
  });

  it("reports microphone permission errors in friendly language", () => {
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => result.current.start());
    act(() => recognition.onerror?.({ error: "not-allowed" } as SpeechRecognitionErrorEvent));
    expect(result.current.error).toMatch(/Microphone access was denied/);
    expect(result.current.isListening).toBe(false);
  });

  it("aborts recognition on unmount", () => {
    const { result, unmount } = renderHook(() => useSpeechRecognition());
    act(() => result.current.start());
    unmount();
    expect(recognition.abort).toHaveBeenCalledOnce();
  });
});

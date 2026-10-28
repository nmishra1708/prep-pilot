import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useInterviews } from "./useDataCollection";
import type { Interview } from "../features/interviewStudy/types";

const interview = {
  id: "interview-1", createdAt: "", updatedAt: "", companyName: "Example", profile: "Engineer",
  rounds: [], status: "Scheduled", hr: { name: "", email: "", phone: "", linkedInUrl: "" },
  jobLink: "", linkedApplicationId: "", questions: [], overallNotes: "", feedbackReceived: "",
  offerDetails: { ctc: "", joiningDate: "" },
} satisfies Interview;

describe("useInterviews", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads, creates and deletes through the REST API", async () => {
    Object.defineProperty(document, "cookie", { configurable: true, value: "csrf_token=test-token" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [interview], page: 1, limit: 100, total: 1, pages: 1 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => interview })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [interview], page: 1, limit: 100, total: 1, pages: 1 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => undefined })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [], page: 1, limit: 100, total: 0, pages: 0 }) });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useInterviews());
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => { await result.current.save({ companyName: "New company" } as Partial<Interview>); });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
    await act(async () => { await result.current.remove("interview-1"); });
    expect(fetchMock.mock.calls[3][1]).toMatchObject({ method: "DELETE" });
    expect(result.current.items).toEqual([]);
  });
});

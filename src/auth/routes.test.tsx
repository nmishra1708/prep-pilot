import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";

describe("protected account routes", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("redirects a signed-out visitor to login without showing the protected workspace", async () => {
    window.history.replaceState({}, "", "/profile");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Authentication required." }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: "test-csrf" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Session expired. Please sign in again." }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    expect(await screen.findByRole("heading", { name: "Welcome back." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your profile." })).not.toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/login"));
  });
});

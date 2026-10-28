import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownPreview } from "./components";

describe("MarkdownPreview", () => {
  it("sanitizes raw HTML before rendering Markdown", async () => {
    const { container } = render(<MarkdownPreview value={'<img src="x" onerror="alert(1)"><script>alert("x")</script>**safe**'} />);
    await waitFor(() => expect(screen.getByText("safe")).toBeInTheDocument());
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
  });
});

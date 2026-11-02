import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MessageTemplateManager from "./MessageTemplateManager";
import { loadMessageTemplates } from "./message-templates";

describe("message template manager", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    const storage: Storage = {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, String(value)),
    };
    Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("adds, edits, and deletes templates while keeping them scoped to the user", () => {
    const { rerender } = render(<MessageTemplateManager userId="user-a" />);
    expect(screen.getByText("Recruiter introduction email")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^\+ Add template$/ }));
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Hiring manager note" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello from my profile." } });
    fireEvent.click(screen.getByRole("button", { name: /^Add template$/ }));

    expect(screen.getByText("Hiring manager note")).toBeInTheDocument();
    expect(loadMessageTemplates("user-a")).toHaveLength(4);
    expect(loadMessageTemplates("user-b")).toHaveLength(3);

    const templateCard = screen.getByText("Hiring manager note").closest("article");
    if (!templateCard) throw new Error("New template card was not rendered.");
    fireEvent.click(within(templateCard).getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Updated note." } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByText("Updated note.")).toBeInTheDocument();

    const updatedCard = screen.getByText("Hiring manager note").closest("article");
    if (!updatedCard) throw new Error("Updated template card was not rendered.");
    fireEvent.click(within(updatedCard).getByRole("button", { name: "Delete" }));
    expect(screen.queryByText("Hiring manager note")).not.toBeInTheDocument();
    expect(loadMessageTemplates("user-a")).toHaveLength(3);

    rerender(<MessageTemplateManager userId="user-b" />);
    expect(screen.queryByText("Hiring manager note")).not.toBeInTheDocument();
  });

  it("copies a template, including an optional email subject", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<MessageTemplateManager userId="user-a" />);

    const card = screen.getByText("Recruiter introduction email").closest("article");
    if (!card) throw new Error("Recruiter email template card was not rendered.");
    fireEvent.click(within(card).getByRole("button", { name: "Copy" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Subject: Interest in {{role}} at {{company}}"));
    });
  });
});

import { useState } from "react";
import type { FormEvent } from "react";
import {
  defaultMessageTemplates,
  loadMessageTemplates,
  messageTemplateCategories,
  saveMessageTemplates,
} from "./message-templates";
import type { MessageTemplate, MessageTemplateCategory } from "./message-templates";

interface TemplateDraft {
  id?: string;
  name: string;
  category: MessageTemplateCategory;
  subject: string;
  body: string;
}

const blankDraft: TemplateDraft = {
  name: "",
  category: "linkedin",
  subject: "",
  body: "",
};

function categoryLabel(category: MessageTemplateCategory): string {
  return messageTemplateCategories.find((item) => item.value === category)?.label ?? "Other";
}

export default function MessageTemplateManager({ userId }: { userId: string }) {
  const [initialState] = useState(() => {
    try {
      return { templates: loadMessageTemplates(userId), error: "" };
    } catch (error) {
      return {
        templates: defaultMessageTemplates.map((template) => ({ ...template })),
        error: error instanceof Error ? error.message : "Could not load saved message templates.",
      };
    }
  });
  const [templates, setTemplates] = useState(initialState.templates);
  const [storageError, setStorageError] = useState(initialState.error);
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [message, setMessage] = useState("");

  const persist = (next: MessageTemplate[]) => {
    try {
      saveMessageTemplates(userId, next);
      setTemplates(next);
      setStorageError("");
      return true;
    } catch {
      setStorageError("Could not save your templates in this browser. Check available storage and try again.");
      return false;
    }
  };

  const saveDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    const now = new Date().toISOString();
    const nextTemplate: MessageTemplate = {
      id: draft.id ?? (typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`),
      name: draft.name.trim(),
      category: draft.category,
      subject: draft.subject.trim(),
      body: draft.body.trim(),
      updatedAt: now,
    };
    const next = draft.id
      ? templates.map((template) => template.id === draft.id ? nextTemplate : template)
      : [nextTemplate, ...templates];
    if (persist(next)) {
      setDraft(null);
      setMessage(draft.id ? "Template updated." : "Template added.");
    }
  };

  const removeTemplate = (id: string) => {
    if (persist(templates.filter((template) => template.id !== id))) {
      setMessage("Template deleted.");
      if (draft?.id === id) setDraft(null);
    }
  };

  const copyTemplate = async (template: MessageTemplate) => {
    const content = template.subject ? `Subject: ${template.subject}\n\n${template.body}` : template.body;
    try {
      await navigator.clipboard.writeText(content);
      setMessage(`${template.name} copied to clipboard.`);
    } catch {
      setMessage("Clipboard access is unavailable. Select and copy the template text instead.");
    }
  };

  return (
    <section className="message-templates" aria-labelledby="message-templates-title">
      <header className="message-templates-heading">
        <div>
          <h2 id="message-templates-title">Your outreach, ready when you are.</h2>
          <p>Save reusable messages for networking, applications, and interview follow-ups. Replace placeholders like {"{{name}}"} before sending.</p>
        </div>
        <button className="button button-primary" type="button" onClick={() => { setDraft({ ...blankDraft }); setMessage(""); }}>
          + Add template
        </button>
      </header>
      {(storageError || message) && <p className={storageError ? "job-error" : "template-status"} role={storageError ? "alert" : "status"}>{storageError || message}</p>}

      {draft && (
        <form className="template-editor" onSubmit={saveDraft}>
          <h3>{draft.id ? "Edit template" : "New template"}</h3>
          <div className="template-editor-fields">
            <label>Template name
              <input autoFocus required maxLength={100} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. Message to a hiring manager" />
            </label>
            <label>Format
              <select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as MessageTemplateCategory })}>
                {messageTemplateCategories.map((category) => <option value={category.value} key={category.value}>{category.label}</option>)}
              </select>
            </label>
            <label className="template-subject-field">Email subject <span>(optional)</span>
              <input maxLength={180} value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} placeholder="A subject line for email formats" />
            </label>
            <label className="template-body-field">Message
              <textarea required maxLength={10000} rows={8} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} placeholder="Write your reusable message here…" />
            </label>
          </div>
          <div className="template-editor-actions">
            <button className="button button-primary" type="submit">{draft.id ? "Save changes" : "Add template"}</button>
            <button className="button button-outline" type="button" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </form>
      )}

      {templates.length ? (
        <div className="template-list">
          {templates.map((template) => (
            <article className="template-card" key={template.id}>
              <div className="template-card-heading">
                <div>
                  <span className="template-category">{categoryLabel(template.category)}</span>
                  <h3>{template.name}</h3>
                </div>
                <div className="template-card-actions">
                  <button className="button button-outline" type="button" onClick={() => void copyTemplate(template)}>Copy</button>
                  <button className="button button-outline" type="button" onClick={() => { setDraft({ id: template.id, name: template.name, category: template.category, subject: template.subject, body: template.body }); setMessage(""); }}>Edit</button>
                  <button className="text-button template-delete" type="button" onClick={() => removeTemplate(template.id)}>Delete</button>
                </div>
              </div>
              {template.subject && <p className="template-subject"><strong>Subject:</strong> {template.subject}</p>}
              <p className="template-body">{template.body}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="job-empty-state">
          <h2>No message templates yet.</h2>
          <p>Add a template to keep your favorite outreach messages ready to use.</p>
        </div>
      )}
    </section>
  );
}

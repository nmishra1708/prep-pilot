export type MessageTemplateCategory =
  | "linkedin"
  | "recruiter-email"
  | "thank-you"
  | "follow-up"
  | "other";

export interface MessageTemplate {
  id: string;
  name: string;
  category: MessageTemplateCategory;
  subject: string;
  body: string;
  updatedAt: string;
}

export const messageTemplateCategories: Array<{ value: MessageTemplateCategory; label: string }> = [
  { value: "linkedin", label: "LinkedIn message" },
  { value: "recruiter-email", label: "Recruiter email" },
  { value: "thank-you", label: "Thank-you message" },
  { value: "follow-up", label: "Follow-up" },
  { value: "other", label: "Other" },
];

export const defaultMessageTemplates: MessageTemplate[] = [
  {
    id: "starter-linkedin",
    name: "LinkedIn connection request",
    category: "linkedin",
    subject: "",
    body: "Hi {{name}}, I came across your work at {{company}} and am exploring {{role}} opportunities. I would love to connect and learn more about your experience. Thank you!",
    updatedAt: "",
  },
  {
    id: "starter-recruiter-email",
    name: "Recruiter introduction email",
    category: "recruiter-email",
    subject: "Interest in {{role}} at {{company}}",
    body: "Hello {{name}},\n\nI am reaching out about the {{role}} opportunity at {{company}}. My experience with {{skills}} could be a strong fit for the role. I have attached my resume and would welcome the chance to discuss how I can contribute.\n\nThank you for your time,\n{{your name}}",
    updatedAt: "",
  },
  {
    id: "starter-thank-you",
    name: "Interview thank-you",
    category: "thank-you",
    subject: "",
    body: "Hi {{name}},\n\nThank you for taking the time to speak with me about the {{role}} position at {{company}}. I enjoyed learning about the team and the work ahead. Our conversation strengthened my interest, especially in {{topic}}.\n\nPlease let me know if I can provide anything else. I look forward to hearing from you.\n\nBest,\n{{your name}}",
    updatedAt: "",
  },
];

function storageKey(userId: string): string {
  return `say-it-message-templates-${userId}`;
}

function isMessageTemplate(value: unknown): value is MessageTemplate {
  if (!value || typeof value !== "object") return false;
  const template = value as Partial<MessageTemplate>;
  return typeof template.id === "string"
    && typeof template.name === "string"
    && messageTemplateCategories.some(({ value: category }) => category === template.category)
    && typeof template.subject === "string"
    && typeof template.body === "string"
    && typeof template.updatedAt === "string";
}

export function loadMessageTemplates(userId: string): MessageTemplate[] {
  const stored = localStorage.getItem(storageKey(userId));
  if (stored === null) return defaultMessageTemplates.map((template) => ({ ...template }));

  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed) || !parsed.every(isMessageTemplate)) {
    throw new Error("Saved message templates could not be read. Clear the damaged templates or try again.");
  }
  return parsed;
}

export function saveMessageTemplates(userId: string, templates: MessageTemplate[]): void {
  localStorage.setItem(storageKey(userId), JSON.stringify(templates));
}

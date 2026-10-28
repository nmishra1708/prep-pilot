import { useEffect, useId, useState } from "react";
import hljs from "highlight.js/lib/common";
import type { InterviewStatus, StudyItem } from "./types";

export function StatusBadge({ status }: { status: InterviewStatus }) {
  return <span className={`feature-status status-${status.toLowerCase().replace(/ /g, "-")}`}>{status}</span>;
}

export function TagInput({ label, value, onChange }: { label: string; value: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const id = useId();
  const addTags = () => {
    const additions = draft.split(",").map((tag) => tag.trim()).filter(Boolean);
    if (additions.length) onChange([...new Set([...value, ...additions])]);
    setDraft("");
  };
  return <div className="feature-field">
    <label htmlFor={id}>{label}</label>
    <div className="tag-input-row">
      <input id={id} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addTags(); }
      }} placeholder="Add a tag, then press Enter" />
      <button className="button button-outline" type="button" onClick={addTags}>Add</button>
    </div>
    <div className="feature-tags">{value.map((tag) => <button key={tag} type="button" className="feature-tag" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((current) => current !== tag))}>{tag} ×</button>)}</div>
  </div>;
}

export function MarkdownEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div className="markdown-editor-grid">
    <label className="feature-field">Answer in Markdown<textarea rows={10} value={value} onChange={(event) => onChange(event.target.value)} placeholder="Write an answer. Markdown and fenced code blocks are supported." /></label>
    <div className="feature-field"><span className="feature-label">Safe preview</span><MarkdownPreview value={value} /></div>
  </div>;
}

export function MarkdownPreview({ value }: { value: string }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    let active = true;
    void import("marked").then(async ({ marked }) => {
      const DOMPurify = (await import("dompurify")).default;
      const renderer = new marked.Renderer();
      renderer.code = ({ text, lang }) => {
        const language = lang?.match(/^[a-zA-Z0-9_+-]+/)?.[0];
        const highlighted = language && hljs.getLanguage(language)
          ? hljs.highlight(text, { language }).value
          : hljs.highlightAuto(text).value;
        const className = language ? ` class="hljs language-${language}"` : ' class="hljs"';
        return `<pre><code${className}>${highlighted}</code></pre>`;
      };
      const rendered = DOMPurify.sanitize(await marked.parse(value, { renderer }));
      if (active) setHtml(rendered);
    });
    return () => { active = false; };
  }, [value]);
  return <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function DiagramViewer({ diagram }: { diagram: StudyItem["diagram"] }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let active = true;
    if (diagram?.type !== "mermaid") { setSvg(""); return () => { active = false; }; }
    void import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true });
      const { svg: rendered } = await mermaid.render(`study-diagram-${Math.random().toString(36).slice(2)}`, diagram.content);
      if (active) setSvg(rendered);
    }).catch(() => { if (active) setSvg(""); });
    return () => { active = false; };
  }, [diagram]);
  if (!diagram) return null;
  if (diagram.type === "image") return <img className="study-diagram" src={diagram.content} alt="Study diagram" />;
  return svg ? <div className="study-diagram" dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="feature-error">Diagram preview is unavailable for this Mermaid text.</p>;
}

export function ConfirmDialog({ title, children, onCancel, onConfirm }: { title: string; children: string; onCancel: () => void; onConfirm: () => void }) {
  return <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
    <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(event) => event.stopPropagation()}>
      <h2 id="confirm-title">{title}</h2><p>{children}</p>
      <div className="feature-actions"><button className="button button-outline" type="button" onClick={onCancel}>Cancel</button><button className="button button-stop" type="button" onClick={onConfirm}>Delete</button></div>
    </section>
  </div>;
}

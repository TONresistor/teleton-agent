import { Markdown } from './Markdown';
import { splitMetadataSection } from '../lib/memory-document';

export function MemoryDocument({ content }: { content: string }) {
  const section = splitMetadataSection(content);
  if (!section) return <Markdown>{content}</Markdown>;

  return (
    <div className="memory-document">
      {section.before && <Markdown>{section.before}</Markdown>}
      <details className="memory-metadata">
        <summary>
          <span className="memory-metadata-label">
            <span className="memory-metadata-title">Metadata</span>
            {section.preview && <span className="memory-metadata-preview">{section.preview}</span>}
          </span>
          <span className="memory-metadata-actions" aria-hidden="true">
            <span className="memory-metadata-quote">❞</span>
            <svg viewBox="0 0 16 16" fill="none">
              <path d="m3 6 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </summary>
        {section.metadata && <div className="memory-metadata-body"><Markdown>{section.metadata}</Markdown></div>}
      </details>
      {section.after && <Markdown>{section.after}</Markdown>}
    </div>
  );
}

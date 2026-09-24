export interface MetadataSection {
  before: string;
  metadata: string;
  after: string;
  preview: string;
}

/** Isolate a Markdown "Metadata" heading without hiding later sections. */
export function splitMetadataSection(content: string): MetadataSection | null {
  const lines = content.split(/\r?\n/);
  let fence: string | null = null;
  let start = -1;
  let level = 0;
  let end = lines.length;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence) continue;

    const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    if (start === -1) {
      if (heading[2].toLowerCase() === 'metadata') {
        start = index;
        level = heading[1].length;
      }
    } else if (heading[1].length <= level) {
      end = index;
      break;
    }
  }

  if (start === -1) return null;
  const metadata = lines.slice(start + 1, end).join('\n').trim();
  const firstLine = metadata.split('\n').find((line) => line.trim()) ?? '';
  const preview = firstLine.replace(/^\s*[-*+]\s+/, '').replace(/\*\*/g, '').trim();

  return {
    before: lines.slice(0, start).join('\n').trim(),
    metadata,
    after: lines.slice(end).join('\n').trim(),
    preview,
  };
}

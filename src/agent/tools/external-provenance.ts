export interface ExternalToolProvenance {
  source: "mcp" | "plugin";
  origin: string;
  trust: "untrusted" | "installed";
  dataOnly: true;
}

export interface ExternalToolData {
  _provenance: ExternalToolProvenance;
  content: unknown;
}

export function wrapExternalToolData(
  provenance: Omit<ExternalToolProvenance, "dataOnly">,
  content: unknown
): ExternalToolData {
  return {
    _provenance: { ...provenance, dataOnly: true },
    content,
  };
}

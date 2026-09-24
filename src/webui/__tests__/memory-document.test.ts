import { describe, expect, it } from "vitest";
import { splitMetadataSection } from "../../../web/src/lib/memory-document.js";

describe("Memory metadata section", () => {
  it("collapses only Metadata and keeps the following Markdown intact", () => {
    const content = [
      "# Consolidated Session Memories",
      "",
      "## Metadata",
      "- **Period:** March to June",
      "- **Source Files (2):**",
      "  - first.md",
      "  - second.md",
      "### Additional details",
      "Keep this metadata too.",
      "",
      "## Summary",
      "The full memory continues here.",
    ].join("\n");

    const section = splitMetadataSection(content);
    expect(section?.before).toBe("# Consolidated Session Memories");
    expect(section?.preview).toBe("Period: March to June");
    expect(section?.metadata).toContain("### Additional details\nKeep this metadata too.");
    expect(section?.after).toBe("## Summary\nThe full memory continues here.");
  });

  it("ignores a Metadata heading inside a code fence", () => {
    const content = "# Notes\n```md\n## Metadata\nexample\n```\n## Content\nVisible text.";
    expect(splitMetadataSection(content)).toBeNull();
  });
});

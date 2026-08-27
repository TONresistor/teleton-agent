import { describe, expect, it } from "vitest";
import { compileRichMessageMarkdown } from "../outgoing-rich-message.js";

describe("compileRichMessageMarkdown", () => {
  it("compiles advanced blocks in their declared order", () => {
    const compiled = compileRichMessageMarkdown("", {
      attachments: [{ id: "report", type: "document", path: "/workspace/report.pdf" }],
      blocks: [
        { type: "heading", text: "Report", level: 1 },
        { type: "quote", text: "Important", collapsed: true },
        { type: "attachment", id: "report" },
        {
          type: "buttonRow",
          align: "right",
          buttons: [{ label: "Copy", action: { type: "copy", text: "value" } }],
        },
      ],
      rtl: true,
      disableAutoLinks: true,
    });

    expect(compiled.markdown).toBe(
      '# Report\n\n<blockquote expandable>Important</blockquote>\n\n![document](tg://document?id=report)\n\n<tg-button-row align="right">\n<tg-button type="copy_text" text="value">Copy</tg-button>\n</tg-button-row>'
    );
    expect(compiled).toMatchObject({ rtl: true, disableAutoLinks: true });
  });

  it("rejects ambiguous simple and advanced layouts", () => {
    expect(() =>
      compileRichMessageMarkdown("top-level", {
        blocks: [{ type: "paragraph", markdown: "block" }],
      })
    ).toThrow("cannot be combined");
  });

  it("rejects unreferenced attachments in advanced layouts", () => {
    expect(() =>
      compileRichMessageMarkdown("", {
        attachments: [{ id: "photo", type: "photo", path: "/workspace/photo.png" }],
        blocks: [{ type: "paragraph", markdown: "No media" }],
      })
    ).toThrow("not referenced");
  });

  it("rejects model-authored tg media references", () => {
    expect(() => compileRichMessageMarkdown("![Photo](tg://photo?id=manual)", {})).toThrow(
      "attachment blocks"
    );
  });

  it("rejects unsafe button protocols", () => {
    expect(() =>
      compileRichMessageMarkdown("Choose", {
        buttonRows: [
          { buttons: [{ label: "Bad", action: { type: "url", url: "javascript:alert(1)" } }] },
        ],
      })
    ).toThrow("Unsupported");
  });

  it("enforces the 20-column table limit", () => {
    expect(() =>
      compileRichMessageMarkdown("", {
        blocks: [{ type: "table", rows: [Array.from({ length: 21 }, () => "cell")] }],
      })
    ).toThrow("1-20 columns");
  });

  it("counts simple attachments and button rows against the global block limit", () => {
    expect(() =>
      compileRichMessageMarkdown("text", {
        buttonRows: Array.from({ length: 500 }, () => ({
          buttons: [{ label: "Copy", action: { type: "copy" as const, text: "x" } }],
        })),
      })
    ).toThrow("at most 500 blocks");
  });
});

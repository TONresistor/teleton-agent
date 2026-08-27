import { describe, expect, it, vi } from "vitest";
import { Api } from "telegram";
import { toLong } from "../../utils/gramjs-bigint.js";
import {
  classifyTelegramRichMessageMedia,
  renderTelegramMessageText,
  resolveTelegramMessageText,
} from "../rich-message.js";

function message(text: string, richMessage?: Api.TypeRichMessage, id = 1): Api.Message {
  return new Api.Message({
    id,
    peerId: new Api.PeerUser({ userId: toLong(1) }),
    date: 0,
    message: text,
    richMessage,
  } as any);
}

function plain(text: string): Api.TextPlain {
  return new Api.TextPlain({ text });
}

function emptyCaption(): Api.PageCaption {
  return new Api.PageCaption({
    text: new Api.TextEmpty(),
    credit: new Api.TextEmpty(),
  });
}

describe("Rich Message text extraction", () => {
  it("returns classic Telegram text unchanged", () => {
    const text = "Plain _text_ that must stay byte-for-byte identical.";

    expect(renderTelegramMessageText(message(text))).toBe(text);
  });

  it("renders structured Layer 228 content as readable Markdown", () => {
    const rich = new Api.RichMessage({
      blocks: [
        new Api.PageBlockHeading1({ text: plain("Release status") }),
        new Api.PageBlockParagraph({
          text: new Api.TextConcat({
            texts: [
              new Api.TextBold({ text: plain("Build") }),
              plain(" is "),
              new Api.TextItalic({ text: plain("green") }),
              plain(". See "),
              new Api.TextUrl({
                text: plain("report"),
                url: "https://example.com/report",
                webpageId: toLong(0),
              }),
              plain("."),
            ],
          }),
        }),
        new Api.PageBlockList({
          items: [
            new Api.PageListItemText({
              checkbox: true,
              checked: true,
              text: plain("Tests"),
            }),
            new Api.PageListItemText({
              checkbox: true,
              text: plain("Deploy"),
            }),
          ],
        }),
        new Api.PageBlockTable({
          title: plain("Targets"),
          rows: [
            new Api.PageTableRow({
              cells: [
                new Api.PageTableCell({ header: true, text: plain("Target") }),
                new Api.PageTableCell({ header: true, text: plain("State") }),
              ],
            }),
            new Api.PageTableRow({
              cells: [
                new Api.PageTableCell({ text: plain("Agent") }),
                new Api.PageTableCell({ text: plain("Ready") }),
              ],
            }),
          ],
        }),
        new Api.PageBlockPreformatted({
          text: plain("npm test"),
          language: "bash",
        }),
        new Api.PageBlockDetails({
          title: plain("Notes"),
          blocks: [new Api.PageBlockParagraph({ text: plain("No regression.") })],
        }),
        new Api.PageBlockMath({ source: "E = mc^2" }),
      ],
      photos: [],
      documents: [],
    });

    expect(renderTelegramMessageText(message("", rich))).toBe(`# Release status

**Build** is *green*. See [report](https://example.com/report).

- [x] Tests
- [ ] Deploy

**Targets**

| Target | State |
| --- | --- |
| Agent | Ready |

\`\`\`bash
npm test
\`\`\`

<details>
<summary>Notes</summary>

No regression.

</details>

$$
E = mc^2
$$`);
  });

  it("fetches a complete rich message once when the embedded payload is partial", async () => {
    const partial = message(
      "",
      new Api.RichMessage({
        part: true,
        blocks: [new Api.PageBlockParagraph({ text: plain("Partial") })],
        photos: [],
        documents: [],
      }),
      42
    );
    const complete = message(
      "",
      new Api.RichMessage({
        blocks: [new Api.PageBlockParagraph({ text: plain("Complete") })],
        photos: [],
        documents: [],
      }),
      42
    );
    const invoke = vi.fn().mockResolvedValue(
      new Api.messages.Messages({
        messages: [complete],
        topics: [],
        chats: [],
        users: [],
      })
    );

    await expect(resolveTelegramMessageText({ invoke } as any, partial)).resolves.toBe("Complete");
    expect(invoke).toHaveBeenCalledTimes(1);
    const request = invoke.mock.calls[0][0];
    expect(request).toBeInstanceOf(Api.messages.GetRichMessage);
    expect(request).toMatchObject({ id: 42 });
  });

  it("falls back to the embedded partial content when hydration fails", async () => {
    const partial = message(
      "",
      new Api.RichMessage({
        part: true,
        blocks: [new Api.PageBlockParagraph({ text: plain("Partial") })],
        photos: [],
        documents: [],
      })
    );
    const invoke = vi.fn().mockRejectedValue(new Error("RPC failed"));

    await expect(resolveTelegramMessageText({ invoke } as any, partial)).resolves.toBe("Partial");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps media-only rich messages visible and classifiable", () => {
    const rich = new Api.RichMessage({
      blocks: [
        new Api.PageBlockPhoto({
          photoId: toLong(1),
          caption: emptyCaption(),
        }),
      ],
      photos: [],
      documents: [],
    });
    const mediaMessage = message("", rich);

    expect(renderTelegramMessageText(mediaMessage)).toBe("[Photo]");
    expect(classifyTelegramRichMessageMedia(mediaMessage)).toBe("photo");
  });

  it("bounds concurrent hydration requests", async () => {
    let active = 0;
    let maximumActive = 0;
    const invoke = vi.fn(async (request: Api.messages.GetRichMessage) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;

      const complete = message(
        "",
        new Api.RichMessage({
          blocks: [new Api.PageBlockParagraph({ text: plain(`Complete ${request.id}`) })],
          photos: [],
          documents: [],
        }),
        request.id
      );
      return new Api.messages.Messages({
        messages: [complete],
        topics: [],
        chats: [],
        users: [],
      });
    });
    const partials = Array.from({ length: 12 }, (_, index) =>
      message(
        "",
        new Api.RichMessage({
          part: true,
          blocks: [new Api.PageBlockParagraph({ text: plain("Partial") })],
          photos: [],
          documents: [],
        }),
        index + 1
      )
    );

    const rendered = await Promise.all(
      partials.map((partial) => resolveTelegramMessageText({ invoke } as any, partial))
    );

    expect(rendered).toEqual(partials.map((partial) => `Complete ${partial.id}`));
    expect(maximumActive).toBe(4);
  });
});

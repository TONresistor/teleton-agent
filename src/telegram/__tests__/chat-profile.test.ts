import { afterEach, describe, expect, it, vi } from "vitest";
import { GrammyBotBridge } from "../bridges/bot.js";

describe("Bot chat profiles", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the DM name and downloads the small chat photo on the server", async () => {
    const bridge = new GrammyBotBridge({ bot_token: "123:test" });
    vi.spyOn(bridge.getBot().api, "getChat").mockResolvedValue({
      id: 42,
      type: "private",
      first_name: "Ada",
      last_name: "Lovelace",
      photo: { small_file_id: "small" },
    } as never);
    vi.spyOn(bridge.getBot().api, "getFile").mockResolvedValue({
      file_id: "small",
      file_unique_id: "unique",
      file_path: "photos/avatar.jpg",
    } as never);
    const photo = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const fetchPhoto = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(photo),
    });
    vi.stubGlobal("fetch", fetchPhoto);

    expect((await bridge.getChatInfo("42")).title).toBe("Ada Lovelace");
    expect(await bridge.getChatPhoto("42")).toEqual(photo);
    expect(fetchPhoto).toHaveBeenCalledWith(
      "https://api.telegram.org/file/bot123:test/photos/avatar.jpg"
    );
  });
});

import { describe, expect, it } from "vitest";
import { telegramSendVoiceTool } from "../send-voice.js";

describe("telegram_send_voice", () => {
  it("exposes minimax in the ttsProvider enum", () => {
    const params = telegramSendVoiceTool.parameters as {
      properties?: { ttsProvider?: { enum?: string[] } };
    };
    const ttsProvider = params.properties?.ttsProvider;
    expect(ttsProvider?.enum).toContain("minimax");
    expect(ttsProvider?.enum).toEqual(["piper", "edge", "openai", "elevenlabs", "minimax"]);
  });

  it("mentions minimax in the tool description", () => {
    expect(telegramSendVoiceTool.description).toContain("minimax");
  });
});

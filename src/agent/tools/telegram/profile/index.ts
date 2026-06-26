import { telegramUpdateProfileTool, telegramUpdateProfileExecutor } from "./update-profile.js";
import { telegramSetBioTool, telegramSetBioExecutor } from "./set-bio.js";
import { telegramSetUsernameTool, telegramSetUsernameExecutor } from "./set-username.js";
import {
  telegramSetPersonalChannelTool,
  telegramSetPersonalChannelExecutor,
} from "./set-personal-channel.js";
import type { ToolEntry } from "../../types.js";

export const tools: ToolEntry[] = [
  {
    tool: telegramUpdateProfileTool,
    executor: telegramUpdateProfileExecutor,
    scope: "dm-only",
    mode: "user",
    tags: ["social"],
  },
  {
    tool: telegramSetBioTool,
    executor: telegramSetBioExecutor,
    scope: "dm-only",
    mode: "user",
    tags: ["social"],
  },
  {
    tool: telegramSetUsernameTool,
    executor: telegramSetUsernameExecutor,
    scope: "dm-only",
    mode: "user",
    tags: ["social"],
  },
  {
    tool: telegramSetPersonalChannelTool,
    executor: telegramSetPersonalChannelExecutor,
    scope: "dm-only",
    mode: "user",
    tags: ["social"],
  },
];

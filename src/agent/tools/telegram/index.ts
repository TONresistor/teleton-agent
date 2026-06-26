import { tools as messagingTools } from "./messaging/index.js";
import { tools as mediaTools } from "./media/index.js";
import { tools as chatsTools } from "./chats/index.js";
import { tools as groupsTools } from "./groups/index.js";
import { tools as interactiveTools } from "./interactive/index.js";
import { tools as stickersTools } from "./stickers/index.js";
import { tools as foldersTools } from "./folders/index.js";
import { tools as profileTools } from "./profile/index.js";
import { tools as starsTools } from "./stars/index.js";
import { tools as giftsTools } from "./gifts/index.js";
import { tools as contactsTools } from "./contacts/index.js";
import { tools as storiesTools } from "./stories/index.js";
import { tools as memoryTools } from "./memory/index.js";
import { tools as tasksTools } from "./tasks/index.js";
import { sendButtonsEntry } from "./send-buttons.js";
import type { ToolEntry } from "../types.js";

export const tools: ToolEntry[] = [
  ...messagingTools,
  ...mediaTools,
  ...chatsTools,
  ...groupsTools,
  ...interactiveTools,
  ...stickersTools,
  ...foldersTools,
  ...profileTools,
  ...starsTools,
  ...giftsTools,
  ...contactsTools,
  ...storiesTools,
  ...memoryTools,
  ...tasksTools,
  sendButtonsEntry,
];

// Type re-export shim for backward compatibility. (The former
// `GramJSUserBridge as TelegramBridge` value alias was unused and ambiguous with
// ITelegramBridge — removed; import the class from ./bridges/user.js directly.)
export type {
  TelegramMessage,
  InlineButton,
  SendMessageOptions,
  SentMessage,
  SentDiceMessage,
  EditMessageOptions,
  ReplyContext,
  BotInfo,
  ChatInfo,
  ITelegramBridge,
} from "./bridge-interface.js";

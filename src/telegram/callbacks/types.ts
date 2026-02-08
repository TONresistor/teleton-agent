// Callback query types for inline button interactions

export interface CallbackQuery {
  id: string;
  data: string; // Format: "action:param1:param2"
  chatId: string;
  messageId: number;
  userId: number;
}

export interface InlineButton {
  text: string;
  callback_data: string; // Max 64 bytes
}

export type CallbackHandler = (query: CallbackQuery) => Promise<void>;

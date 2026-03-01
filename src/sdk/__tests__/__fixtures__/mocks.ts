import { vi } from "vitest";

/**
 * Shared mock objects for SDK tests.
 *
 * Call `createMocks()` inside `beforeEach` so every test gets fresh vi.fn() instances.
 */
export function createMocks() {
  const mockGramJsClient = {
    invoke: vi.fn(),
    sendMessage: vi.fn(),
    sendFile: vi.fn(),
    getEntity: vi.fn(),
    getInputEntity: vi.fn(),
    getMessages: vi.fn(),
    downloadMedia: vi.fn(),
    uploadFile: vi.fn(),
  };

  const mockBridgeClient = {
    getClient: () => mockGramJsClient,
    getMe: vi.fn(),
    answerCallbackQuery: vi.fn(),
  };

  const mockBridge = {
    isAvailable: vi.fn(() => true),
    getClient: () => mockBridgeClient,
    sendMessage: vi.fn(),
    editMessage: vi.fn(),
    sendReaction: vi.fn(),
    setTyping: vi.fn(),
    getMessages: vi.fn(),
  } as any;

  const mockLog = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return { mockGramJsClient, mockBridgeClient, mockBridge, mockLog };
}

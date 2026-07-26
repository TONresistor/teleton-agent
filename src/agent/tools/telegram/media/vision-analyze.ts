import { Type } from "@sinclair/typebox";
import {
  type Context,
  type UserMessage,
  type ImageContent,
  type TextContent,
} from "@earendil-works/pi-ai/compat";
import { chatWithContext, getProviderModel } from "../../../client.js";
import { getProviderMetadata, type SupportedProvider } from "../../../../config/providers.js";
import { readFileSync, existsSync } from "fs";
import { extname } from "path";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { validateReadPath, WorkspaceSecurityError } from "../../../../workspace/index.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";
import { getClient } from "../../../../sdk/telegram-utils.js";

const log = createLogger("Tools");

/**
 * Parameters for vision_analyze tool
 */
interface VisionAnalyzeParams {
  chatId?: string;
  messageId?: number;
  filePath?: string;
  prompt?: string;
}

/**
 * Tool definition for analyzing images with the configured vision-capable model
 */
export const visionAnalyzeTool: Tool = {
  name: "vision_analyze",
  description:
    "Inspect an image using the configured vision LLM. Provide chatId+messageId for chat images or filePath for local workspace files. Accepts an optional prompt to ask specific questions. Supports JPG, PNG, GIF, WEBP up to 5 MB.",
  category: "data-bearing",
  parameters: Type.Object({
    chatId: Type.Optional(
      Type.String({
        description:
          "The chat ID where the message with the image is located (for Telegram images)",
      })
    ),
    messageId: Type.Optional(
      Type.Number({
        description: "The message ID containing the image to analyze (for Telegram images)",
      })
    ),
    filePath: Type.Optional(
      Type.String({
        description:
          "Path to a local image file in workspace (e.g., 'downloads/image.jpg'). Use this instead of chatId/messageId for workspace files.",
      })
    ),
    prompt: Type.Optional(
      Type.String({
        description:
          "Optional prompt/question about the image. Default: 'Describe this image in detail.'",
      })
    ),
  }),
};

// Supported image MIME types for vision analysis
const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

// Extension to MIME type mapping
const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

// Max image size (5MB)
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

function getVisionProviderFailure(
  provider: string,
  modelId: string,
  errorMessage?: string
): { code: string; error: string } {
  const normalized = errorMessage?.toLowerCase() || "";

  if (
    normalized.includes("401") ||
    normalized.includes("unauthorized") ||
    normalized.includes("authentication") ||
    normalized.includes("api key")
  ) {
    return {
      code: "VISION_AUTH",
      error: `Vision authentication failed for ${provider}. Check the configured credentials.`,
    };
  }

  if (normalized.includes("429") || normalized.includes("rate limit")) {
    return {
      code: "VISION_RATE_LIMIT",
      error: `Vision request was rate-limited by ${provider}. Try again later.`,
    };
  }

  return {
    code: "VISION_PROVIDER",
    error: `Vision request failed for ${provider}/${modelId}. Check the service logs for details.`,
  };
}

type VisionFailureStage = "setup" | "media" | "provider";

function getVisionExceptionFailure(
  provider: string,
  modelId: string,
  stage: VisionFailureStage,
  error: unknown
): { code: string; error: string } {
  const errorMessage = getErrorMessage(error);
  const normalized = errorMessage.toLowerCase();

  if (normalized.includes("no codex credentials found")) {
    return {
      code: "VISION_AUTH",
      error: "No Codex credentials found. Run 'codex' to authenticate.",
    };
  }

  if (normalized.includes("no grok build credentials found")) {
    return {
      code: "VISION_AUTH",
      error: "No Grok Build credentials found. Run 'grok login' to authenticate.",
    };
  }

  if (stage === "provider") {
    return getVisionProviderFailure(provider, modelId, errorMessage);
  }

  if (stage === "media") {
    return {
      code: "VISION_MEDIA",
      error: "Failed to read or download the image for analysis.",
    };
  }

  return {
    code: "VISION_SETUP",
    error: `Vision analysis could not be initialized for ${provider}/${modelId}.`,
  };
}

/**
 * Executor for vision_analyze tool
 */
export const visionAnalyzeExecutor: ToolExecutor<VisionAnalyzeParams> = async (
  params,
  context
): Promise<ToolResult> => {
  let failureStage: VisionFailureStage = "setup";

  try {
    const { chatId, messageId, filePath, prompt } = params;

    // Validate params - need either filePath OR (chatId + messageId)
    const hasFilePath = !!filePath;
    const hasAnyTelegramParam = chatId !== undefined || messageId !== undefined;
    const hasTelegramParams = !!chatId && messageId !== undefined;

    if (
      (!hasFilePath && !hasTelegramParams) ||
      (hasFilePath && hasAnyTelegramParam) ||
      (hasAnyTelegramParam && !hasTelegramParams)
    ) {
      return {
        success: false,
        error:
          "Provide exactly one image source: either 'filePath' OR both 'chatId' and 'messageId'",
      };
    }

    const agentConfig = context.config?.agent;
    if (!agentConfig) {
      return {
        success: false,
        error: "Agent configuration is unavailable for vision analysis",
      };
    }

    const provider = (agentConfig.provider || "anthropic") as SupportedProvider;
    const providerMeta = getProviderMetadata(provider);
    const modelId = agentConfig.model || providerMeta.defaultModel;
    const model = getProviderModel(provider, modelId);

    if (!model.input.includes("image")) {
      return {
        success: false,
        error: `Model ${modelId} (${provider}) does not support image analysis. Use a vision-capable model.`,
      };
    }

    failureStage = "media";

    let data: Buffer;
    let mimeType: string;
    let source: string;

    if (hasFilePath) {
      log.info(`Reading local image: ${filePath}`);

      // Validate workspace path
      let validatedPath;
      try {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- reached only when filePath is provided
        validatedPath = validateReadPath(filePath!);
      } catch (error) {
        if (error instanceof WorkspaceSecurityError) {
          return {
            success: false,
            error: `Security Error: ${error.message}. Can only read files from workspace.`,
          };
        }
        throw error;
      }

      // Check file exists
      if (!existsSync(validatedPath.absolutePath)) {
        return {
          success: false,
          error: `File not found: ${filePath}`,
        };
      }

      // Determine MIME type from extension
      const ext = extname(validatedPath.absolutePath).toLowerCase();
      mimeType = EXT_TO_MIME[ext] || "application/octet-stream";

      if (!SUPPORTED_IMAGE_TYPES.includes(mimeType)) {
        return {
          success: false,
          error: `Unsupported file type: ${ext}. Vision supports: .jpg, .jpeg, .png, .gif, .webp`,
        };
      }

      // Read file
      data = readFileSync(validatedPath.absolutePath);
      source = `file:${filePath}`;
    } else {
      log.info(`Downloading image from message ${messageId}...`);

      // Get underlying GramJS client
      const gramJsClient = getClient(context.bridge);

      // Get the message
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- chatId/messageId guaranteed in this branch
      const messages = await gramJsClient.getMessages(chatId!, {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- messageId guaranteed in this branch
        ids: [messageId!],
      });

      if (!messages || messages.length === 0) {
        return {
          success: false,
          error: `Message ${messageId} not found in chat ${chatId}`,
        };
      }

      const message = messages[0];

      // Check if message has media
      if (!message.media) {
        return {
          success: false,
          error: "Message does not contain any media",
        };
      }

      // Determine MIME type
      mimeType = "image/jpeg";

      if (message.photo) {
        mimeType = "image/jpeg";
      } else if (message.document) {
        const doc = message.document;
        mimeType = ("mimeType" in doc ? doc.mimeType : undefined) || "application/octet-stream";

        if (!SUPPORTED_IMAGE_TYPES.includes(mimeType)) {
          return {
            success: false,
            error: `Unsupported media type: ${mimeType}. Vision only supports: ${SUPPORTED_IMAGE_TYPES.join(", ")}`,
          };
        }
      } else {
        return {
          success: false,
          error: "Message does not contain a photo or image document",
        };
      }

      // Download the media
      const buffer = await gramJsClient.downloadMedia(message, {});

      if (!buffer) {
        return {
          success: false,
          error: "Failed to download image - empty buffer returned",
        };
      }

      data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      source = `telegram:${chatId}/${messageId}`;
    }

    // Check size
    if (data.length > MAX_IMAGE_SIZE) {
      return {
        success: false,
        error: `Image too large: ${(data.length / 1024 / 1024).toFixed(2)}MB exceeds 5MB limit`,
      };
    }

    // Encode as base64
    const base64 = data.toString("base64");
    log.info(`Encoded image: ${(data.length / 1024).toFixed(1)}KB (${mimeType})`);

    // Build multimodal message content
    const imageContent: ImageContent = {
      type: "image",
      data: base64,
      mimeType,
    };

    const textContent: TextContent = {
      type: "text",
      text: prompt || "Describe this image in detail.",
    };

    // Create user message with image + text
    const userMsg: UserMessage = {
      role: "user",
      content: [imageContent, textContent],
      timestamp: Date.now(),
    };

    // Create context for vision call
    const visionContext: Context = {
      systemPrompt:
        "You are analyzing an image. Provide a helpful, detailed description or answer the user's question about the image. Be concise but thorough.",
      messages: [userMsg],
    };

    log.info(`Analyzing image with ${provider}/${modelId} vision...`);

    // Use the shared request path so API-key and CLI-auth providers resolve
    // credentials consistently and can refresh rejected CLI tokens once.
    failureStage = "provider";
    const response = await chatWithContext(agentConfig, {
      context: visionContext,
      maxTokens: 1024,
    });

    if (response.message.stopReason === "error") {
      const failure = getVisionProviderFailure(provider, modelId, response.message.errorMessage);

      log.error(
        {
          provider,
          modelId,
          errorCode: failure.code,
        },
        "Vision model request failed"
      );
      return { success: false, error: failure.error };
    }

    const analysisText = response.text;

    if (!analysisText) {
      return {
        success: false,
        error: "Model did not return any analysis",
      };
    }

    log.info(`Vision analysis complete (${analysisText.length} chars)`);

    return {
      success: true,
      data: {
        analysis: analysisText,
        source,
        imageSize: data.length,
        mimeType,
        usage: response.message.usage,
      },
    };
  } catch (error) {
    const provider = context.config?.agent?.provider || "unknown";
    const modelId = context.config?.agent?.model || "unknown";
    const failure = getVisionExceptionFailure(provider, modelId, failureStage, error);

    log.error(
      {
        provider,
        modelId,
        errorCode: failure.code,
        stage: failureStage,
      },
      "Vision analysis failed"
    );
    return {
      success: false,
      error: failure.error,
    };
  }
};

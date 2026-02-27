import { Type } from "@sinclair/typebox";
import {
  completeSimple,
  type Context,
  type UserMessage,
  type ImageContent,
  type TextContent,
} from "@mariozechner/pi-ai";
import { getProviderModel, getEffectiveApiKey } from "../../../client.js";
import { getProviderMetadata, type SupportedProvider } from "../../../../config/providers.js";
import { readFileSync, existsSync } from "fs";
import { extname } from "path";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { validateReadPath, WorkspaceSecurityError } from "../../../../workspace/index.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

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
 * Tool definition for analyzing images with Claude vision
 */
export const visionAnalyzeTool: Tool = {
  name: "vision_analyze",
  description:
    "Analyze an image using vision LLM. Provide chatId+messageId for Telegram images or filePath for local files.",
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

// Supported image MIME types for Claude vision
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

/**
 * Executor for vision_analyze tool
 */
export const visionAnalyzeExecutor: ToolExecutor<VisionAnalyzeParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chatId, messageId, filePath, prompt } = params;

    // Validate params - need either filePath OR (chatId + messageId)
    const hasFilePath = !!filePath;
    const hasTelegramParams = !!chatId && !!messageId;

    if (!hasFilePath && !hasTelegramParams) {
      return {
        success: false,
        error:
          "Must provide either 'filePath' for local files OR both 'chatId' and 'messageId' for Telegram images",
      };
    }

    // Get API key from context
    const currentProvider = context.config?.agent?.provider;
    const apiKey = context.config?.agent?.api_key;
    if (!apiKey && currentProvider !== "local" && currentProvider !== "cocoon") {
      return {
        success: false,
        error: "No API key configured for vision analysis",
      };
    }

    let data: Buffer;
    let mimeType: string;
    let source: string;

    if (hasFilePath) {
      log.info(`📷 Reading local image: ${filePath}`);

      // Validate workspace path
      let validatedPath;
      try {
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
      log.info(`📷 Downloading image from message ${messageId}...`);

      // Get underlying GramJS client
      const gramJsClient = context.bridge.getClient().getClient();

      // Get the message
      const messages = await gramJsClient.getMessages(chatId!, {
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
    log.info(`📷 Encoded image: ${(data.length / 1024).toFixed(1)}KB (${mimeType})`);

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

    // Get model from configured provider
    const provider = (context.config?.agent?.provider || "anthropic") as SupportedProvider;
    const providerMeta = getProviderMetadata(provider);
    const modelId = context.config?.agent?.model || providerMeta.defaultModel;
    const model = getProviderModel(provider, modelId);

    // Check if model supports vision
    if (!model.input.includes("image")) {
      return {
        success: false,
        error: `Model ${modelId} (${provider}) does not support image analysis. Use a vision-capable model.`,
      };
    }

    log.info(`🔍 Analyzing image with ${provider}/${modelId} vision...`);

    // Call LLM with the image
    const response = await completeSimple(model, visionContext, {
      apiKey: currentProvider ? getEffectiveApiKey(currentProvider, apiKey || "") : apiKey,
      maxTokens: 1024,
    });

    // Extract text response
    const textBlock = response.content.find((block) => block.type === "text");
    const analysisText = textBlock?.type === "text" ? textBlock.text : "";

    if (!analysisText) {
      return {
        success: false,
        error: "Model did not return any analysis",
      };
    }

    log.info(`✅ Vision analysis complete (${analysisText.length} chars)`);

    return {
      success: true,
      data: {
        analysis: analysisText,
        source,
        imageSize: data.length,
        mimeType,
        usage: response.usage,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error analyzing image");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};

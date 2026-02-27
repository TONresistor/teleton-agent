// Mirrored from web/src/components/setup/SetupContext.tsx — keep in sync

export interface WizardData {
  riskAccepted: boolean;
  agentName: string;
  provider: string;
  apiKey: string;
  cocoonPort: number;
  localUrl: string;
  apiId: number;
  apiHash: string;
  phone: string;
  userId: number;
  mode: "quick" | "advanced";
  model: string;
  customModel: string;
  dmPolicy: string;
  groupPolicy: string;
  requireMention: boolean;
  maxIterations: number;
  botToken: string;
  botUsername: string;
  tonapiKey: string;
  tavilyKey: string;
  customizeThresholds: boolean;
  buyMaxFloor: number;
  sellMinFloor: number;
  walletAction: "keep" | "generate" | "import";
  mnemonic: string;
  walletAddress: string;
  mnemonicSaved: boolean;
  authSessionId: string;
  telegramUser: { id: number; firstName: string; username: string } | null;
  skipConnect: boolean;
  webuiEnabled: boolean;
}

export function validateStep(step: number, data: WizardData): boolean {
  switch (step) {
    case 0:
      return data.riskAccepted;
    case 1:
      if (!data.provider) return false;
      if (data.provider === "cocoon") {
        return data.cocoonPort >= 1 && data.cocoonPort <= 65535;
      }
      if (data.provider === "local") {
        try {
          new URL(data.localUrl);
          return true;
        } catch {
          return false;
        }
      }
      if (data.provider === "claude-code") {
        return true; // credentials auto-detected at runtime
      }
      return data.apiKey.length > 0;
    case 2: {
      // Config
      if (data.provider !== "cocoon" && data.provider !== "local") {
        const modelValue = data.model === "__custom__" ? data.customModel : data.model;
        if (!modelValue) return false;
      }
      return data.userId > 0 && data.maxIterations >= 1 && data.maxIterations <= 50;
    }
    case 3:
      // Wallet: if generated/imported, must confirm mnemonic saved
      if (data.walletAction === "keep") return true;
      if (!data.walletAddress) return false;
      return data.mnemonicSaved;
    case 4:
      // Telegram
      return data.apiId > 0 && data.apiHash.length >= 10 && data.phone.startsWith("+");
    case 5:
      return data.telegramUser !== null || data.skipConnect;
    default:
      return false;
  }
}

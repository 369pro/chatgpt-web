export enum Path {
    Home = "/",
    Chat = "/chat",
    Sale = "/sale",
    Market = "/market",
}

export enum GptVersion {
    DEEPSEEK_FLASH = "deepseek-flash",
    DEEPSEEK_V4_PRO = "deepseek-v4-pro",
}

export const DEFAULT_GPT_VERSION = GptVersion.DEEPSEEK_FLASH;

export interface ChatModelOption {
    id: string;
    displayName: string;
    provider: string;
    inputPrice?: string;
    cachedInputPrice?: string;
    outputPrice?: string;
}

export const DEFAULT_CHAT_MODELS: ChatModelOption[] = [
    {
        id: GptVersion.DEEPSEEK_FLASH,
        displayName: "DeepSeek V4.1 Flash",
        provider: "deepseek",
    },
    {
        id: GptVersion.DEEPSEEK_V4_PRO,
        displayName: "DeepSeek V4 Pro",
        provider: "deepseek",
    },
];

/** Normalize only persisted legacy aliases; outbound model IDs stay unchanged. */
export function normalizeGptVersion(model?: string): string {
    switch (model) {
        case "deepseek-chat":
        case "deepseek-v4-flash":
        case "deepseek-reasoner":
            return GptVersion.DEEPSEEK_FLASH;
        default:
            return model || DEFAULT_GPT_VERSION;
    }
}

export const STREAM_ERROR_MARKER = "\n[错误]";

export interface StreamParseResult {
    text: string;
    error?: string;
}

function markerIndex(value: string): {index: number; length: number} | undefined {
    const newlineIndex = value.indexOf(STREAM_ERROR_MARKER);
    if (newlineIndex >= 0) {
        return {index: newlineIndex, length: STREAM_ERROR_MARKER.length};
    }

    const bareIndex = value.indexOf("[错误]");
    if (bareIndex >= 0) {
        return {index: bareIndex, length: "[错误]".length};
    }

    return undefined;
}

function longestMarkerPrefix(value: string): number {
    const markers = [STREAM_ERROR_MARKER, "[错误]"];
    let longest = 0;

    for (const marker of markers) {
        const maxLength = Math.min(value.length, marker.length - 1);
        for (let length = maxLength; length > longest; length -= 1) {
            if (value.endsWith(marker.slice(0, length))) {
                longest = length;
                break;
            }
        }
    }

    return longest;
}

/**
 * Keeps the compatibility error marker out of assistant content, including
 * when the marker is split across ReadableStream chunks.
 */
export class ChatStreamParser {
    private pending = "";
    private errorMessage = "";
    private hasError = false;

    push(chunk: string): StreamParseResult {
        if (!chunk) return {text: ""};

        if (this.hasError) {
            this.errorMessage += chunk;
            return {text: "", error: this.errorMessage};
        }

        const value = this.pending + chunk;
        this.pending = "";
        const error = markerIndex(value);
        if (error) {
            this.hasError = true;
            this.errorMessage = value.slice(error.index + error.length);
            return {
                text: value.slice(0, error.index),
                error: this.errorMessage,
            };
        }

        const pendingLength = longestMarkerPrefix(value);
        if (pendingLength > 0) {
            this.pending = value.slice(value.length - pendingLength);
            return {text: value.slice(0, value.length - pendingLength)};
        }

        return {text: value};
    }

    finish(): StreamParseResult {
        if (this.hasError) {
            return {text: "", error: this.errorMessage.trim() || "请求失败"};
        }

        const tail = this.pending;
        this.pending = "";
        const error = markerIndex(tail);
        if (error) {
            this.hasError = true;
            this.errorMessage = tail.slice(error.index + error.length);
            return {text: tail.slice(0, error.index), error: this.errorMessage.trim() || "请求失败"};
        }

        return {text: tail};
    }

    getErrorMessage(): string | undefined {
        if (!this.hasError) return undefined;
        return this.errorMessage.trim() || "请求失败";
    }
}

export function extractErrorMessage(body: string): string | undefined {
    const error = markerIndex(body);
    if (error) {
        return body.slice(error.index + error.length).trim() || "请求失败";
    }

    const trimmed = body.trim();
    if (!trimmed) return undefined;

    try {
        const parsed = JSON.parse(trimmed) as {message?: string; error?: string; info?: string};
        return parsed.message || parsed.error || parsed.info || trimmed;
    } catch {
        return trimmed;
    }
}

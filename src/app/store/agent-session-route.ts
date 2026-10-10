/** Stable hash-router path shared by links, refreshes, and copied URLs. */
export function agentSessionPath(sessionId: string): string {
    return `/chat/${encodeURIComponent(sessionId)}`;
}

export function agentSessionIdFromPath(pathname: string): string {
    if (!pathname.startsWith("/chat/")) return "";
    try {
        return decodeURIComponent(pathname.slice("/chat/".length));
    } catch {
        return "";
    }
}


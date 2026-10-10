/** Legacy summaries have no trustworthy one-to-one mapping to web sources. */
export function displayAssistantContent(content: string): {content: string; hasSearchSummary: boolean} {
    let hasSearchSummary = false;
    // Preserve literal examples inside fenced blocks and inline code.
    const display = content.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`+[^`\n]*`+)/g).map((part, index) => {
        if (index % 2) return part;
        return part.replace(/[ \t]*\[search_summary\]/gi, () => {
            hasSearchSummary = true;
            return "";
        });
    }).join("");
    return {content: display, hasSearchSummary};
}

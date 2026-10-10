/** Callers pass the history after the session's clear-context boundary. */
export function formatMessages<Role extends string>(messages: readonly {
    content: string;
    role: Role;
    status?: string;
}[]): {content: string; role: Role}[] {
    return messages
        .filter(({status, content}) => !['sending', 'error', 'cancelled'].includes(status ?? '')
            && content.trim().length > 0)
        .map(({content, role}) => ({content, role}));
}

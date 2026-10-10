import {ChatModelOption} from "@/app/constants";
import {useAccessStore} from "@/app/store/access";
import {MessageRole, ChatAttachment, ChatQuote, ChatSource} from "@/types/chat";
export type {ChatAttachment, ChatQuote, ChatSource} from "@/types/chat";

// 构建前把localhost修改为你的公网IP或者域名地址 https://api.gaga.plus http://127.0.0.1:8091
const openAIApiHostUrl = process.env.NEXT_PUBLIC_API_HOST_URL || "http://127.0.0.1:8091";
const bigMarketApiHostUrl = "http://127.0.0.1:8098";

// const openAIApiHostUrl = "https://api.gaga.plus";
// const bigMarketApiHostUrl = "https://api-big-market.gaga.plus";

/**
 * Header 信息
 */
function getHeaders() {
    const accessState = useAccessStore.getState()

    const headers = {
        Authorization: accessState.token,
        'Content-Type': 'application/json;charset=utf-8'
    }

    return headers
}

export const getModelCatalog = async (signal?: AbortSignal): Promise<ChatModelOption[]> => {
    const response = await fetch(`${openAIApiHostUrl}/api/v1/chatgpt/models`, {
        method: "GET",
        headers: getHeaders(),
        signal,
    });
    if (!response.ok) {
        throw new Error(`模型列表请求失败（HTTP ${response.status}）`);
    }

    const result: unknown = await response.json();
    if (!Array.isArray(result)) {
        throw new Error("模型列表格式无效");
    }

    const models = result.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const candidate = item as Partial<ChatModelOption>;
        if (typeof candidate.id !== "string" || !candidate.id) return [];
        return [{
            id: candidate.id,
            displayName: typeof candidate.displayName === "string" && candidate.displayName
                ? candidate.displayName
                : candidate.id,
            provider: typeof candidate.provider === "string" ? candidate.provider : "",
            inputPrice: typeof candidate.inputPrice === "string" ? candidate.inputPrice : undefined,
            cachedInputPrice: typeof candidate.cachedInputPrice === "string" ? candidate.cachedInputPrice : undefined,
            outputPrice: typeof candidate.outputPrice === "string" ? candidate.outputPrice : undefined,
        }];
    });

    if (!models.length) throw new Error("模型列表为空");
    return models;
};

/**
 * 流式应答接口
 * @param data
 */
export const completions = (data: {
    messages: { content: string; role: MessageRole }[],
    model: string,
    requestId?: string,
}, signal?: AbortSignal) => {
    return fetch(`${openAIApiHostUrl}/api/v1/chatgpt/chat/completions`, {
        method: 'post',
        headers: getHeaders(),
        body: JSON.stringify(data),
        signal,
    });
};

export type AgentMode = "chat" | "research";
export type AgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "budget_exhausted" | "interrupted";

export interface AgentSessionSummary {
    session_id: string;
    title: string;
    kind?: "chat" | "knowledge";
    active_run_id?: string | null;
    context_reset_after_seq?: number | null;
    created_at?: string;
    updated_at?: string;
}

export interface AgentMessageRecord {
    message_id: string;
    role: MessageRole;
    content: unknown;
    seq?: number;
    created_at?: string;
    status?: string;
    run_id?: string | null;
    quotes?: ChatQuote[];
    attachments?: ChatAttachment[];
    sources?: ChatSource[];
}

export interface AgentRunRecord {
    run_id: string;
    session_id: string;
    status: AgentRunStatus;
    mode: AgentMode;
    output?: string;
    error?: string | null;
    spent_amount?: number | string | null;
    created_at?: string;
    updated_at?: string;
    started_at?: string | null;
    finished_at?: string | null;
    /** Server-owned FIFO metadata for non-terminal runs. */
    queue_position?: number | null;
    is_queue_head?: boolean;
    web_search?: boolean;
    search_status?: "searching" | "completed" | "failed";
    attachment_ids?: string[];
    attachments?: ChatAttachment[];
    quotes?: ChatQuote[];
    sources?: ChatSource[];
}

export interface AgentSessionDetail {
    session: AgentSessionSummary;
    messages: AgentMessageRecord[];
    runs: AgentRunRecord[];
}

export interface AgentRunEvent {
    seq: number;
    type: string;
    payload?: unknown;
}

export interface AgentCapabilities {
    chat: boolean;
    research: boolean;
    compression?: boolean;
    web_search_available?: boolean;
    web_search_models?: string[];
}

function agentUrl(path: string): string {
    return `${openAIApiHostUrl}/api/v1/agent${path}`;
}

export async function agentRequest(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(agentUrl(path), {
        ...init,
        headers: {
            ...getHeaders(),
            ...(init.headers || {}),
        },
        cache: "no-store",
    });
}

async function chatFileResponse<T>(response: Response): Promise<T> {
    const result = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(typeof result?.detail === "string" ? result.detail : `文件操作失败（HTTP ${response.status}）`);
    }
    return result as T;
}

export async function listChatAttachments(sessionId: string): Promise<ChatAttachment[]> {
    const result = await chatFileResponse<{attachments: ChatAttachment[]}>(await agentRequest(
        `/sessions/${encodeURIComponent(sessionId)}/attachments`, {method: "GET"}));
    return result.attachments;
}

export async function uploadChatAttachment(sessionId: string, file: File): Promise<ChatAttachment> {
    if (!/\.(md|txt|pdf|docx)$/i.test(file.name)) throw new Error("支持 Markdown、TXT、PDF 和 DOCX");
    if (file.size > 10 * 1024 * 1024) throw new Error("单个文件不能超过 10 MiB");
    const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
        reader.onerror = () => reject(new Error("文件读取失败，请重试"));
        reader.readAsDataURL(file);
    });
    return chatFileResponse<ChatAttachment>(await agentRequest(`/sessions/${encodeURIComponent(sessionId)}/attachments`, {
        method: "POST", body: JSON.stringify({filename: file.name, content_base64: base64}),
    }));
}

export async function promoteChatAttachment(sessionId: string, attachmentId: string): Promise<{path: string}> {
    return chatFileResponse<{path: string}>(await agentRequest(
        `/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}/knowledge`,
        {method: "POST", body: "{}"}));
}

export async function deleteChatAttachment(sessionId: string, attachmentId: string): Promise<void> {
    await chatFileResponse(await agentRequest(
        `/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}`, {method: "DELETE"}));
}

export async function getAgentCapabilities(signal?: AbortSignal): Promise<AgentCapabilities> {
    const response = await agentRequest("/capabilities", {method: "GET", signal});
    if (!response.ok) throw new Error(`能力查询失败（HTTP ${response.status}）`);
    const result = await response.json() as AgentCapabilities;
    return {chat: Boolean(result.chat), research: Boolean(result.research), compression: Boolean(result.compression),
        web_search_available: Boolean(result.web_search_available),
        web_search_models: Array.isArray(result.web_search_models) ? result.web_search_models : []};
}

export async function listAgentSessions(signal?: AbortSignal): Promise<AgentSessionSummary[]> {
    const response = await agentRequest("/sessions", {method: "GET", signal});
    if (!response.ok) throw new Error(`会话列表请求失败（HTTP ${response.status}）`);
    const result = await response.json() as {sessions?: AgentSessionSummary[]};
    if (!Array.isArray(result.sessions)) throw new Error("会话列表格式无效");
    return result.sessions;
}

export async function createAgentSession(title?: string): Promise<AgentSessionSummary> {
    const response = await agentRequest("/sessions", {
        method: "POST",
        body: JSON.stringify(title ? {title} : {}),
    });
    if (!response.ok) throw new Error(`创建会话失败（HTTP ${response.status}）`);
    return unwrapAgentSession(await response.json());
}

export async function getAgentSession(sessionId: string, signal?: AbortSignal): Promise<AgentSessionDetail> {
    const response = await agentRequest(`/sessions/${encodeURIComponent(sessionId)}`, {method: "GET", signal});
    if (!response.ok) throw new Error(`读取会话失败（HTTP ${response.status}）`);
    return unwrapAgentSessionDetail(await response.json());
}

export async function renameAgentSession(sessionId: string, title: string): Promise<AgentSessionSummary> {
    const response = await agentRequest(`/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        body: JSON.stringify({title}),
    });
    if (!response.ok) throw new Error(`重命名会话失败（HTTP ${response.status}）`);
    return unwrapAgentSession(await response.json());
}

export async function deleteAgentSession(sessionId: string): Promise<void> {
    const response = await agentRequest(`/sessions/${encodeURIComponent(sessionId)}`, {method: "DELETE"});
    if (!response.ok) throw new Error(`删除会话失败（HTTP ${response.status}）`);
}

export async function deleteAgentMessage(sessionId: string, messageId: string): Promise<AgentSessionDetail> {
    const response = await agentRequest(`/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}`, {
        method: "DELETE",
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(body || `删除消息失败（HTTP ${response.status}）`);
    }
    return unwrapAgentSessionDetail(await response.json());
}

export async function resetAgentSessionContext(sessionId: string): Promise<AgentSessionDetail> {
    const response = await agentRequest(`/sessions/${encodeURIComponent(sessionId)}/reset-context`, {
        method: "POST",
        body: JSON.stringify({}),
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(body || `重置上下文失败（HTTP ${response.status}）`);
    }
    return unwrapAgentSessionDetail(await response.json());
}

export async function createAgentRun(sessionId: string, payload: {
    content: string;
    model: string;
    mode: AgentMode;
    request_id: string;
    budget_limit?: number;
    thinking?: boolean;
    web_search?: boolean;
    attachment_ids?: string[];
    quotes?: ChatQuote[];
}): Promise<AgentRunRecord> {
    const response = await agentRequest(`/sessions/${encodeURIComponent(sessionId)}/runs`, {
        method: "POST",
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(body || `启动运行失败（HTTP ${response.status}）`);
    }
    return unwrapAgentRun(await response.json());
}

export async function getAgentRun(runId: string, signal?: AbortSignal): Promise<AgentRunRecord> {
    const response = await agentRequest(`/runs/${encodeURIComponent(runId)}`, {method: "GET", signal});
    if (!response.ok) throw new Error(`读取运行失败（HTTP ${response.status}）`);
    return unwrapAgentRun(await response.json());
}

export async function getAgentRunEvents(runId: string, after = 0, signal?: AbortSignal): Promise<{events: AgentRunEvent[]; run: AgentRunRecord}> {
    const query = new URLSearchParams({after: String(after)});
    const response = await agentRequest(`/runs/${encodeURIComponent(runId)}/events?${query}`, {method: "GET", signal});
    if (!response.ok) throw new Error(`读取运行事件失败（HTTP ${response.status}）`);
    const result = await response.json() as {events?: AgentRunEvent[]; run?: AgentRunRecord};
    if (!Array.isArray(result.events) || !result.run?.run_id) throw new Error("运行事件响应格式无效");
    return {events: result.events, run: result.run};
}

export async function cancelAgentRun(runId: string): Promise<AgentRunRecord | null> {
    const response = await agentRequest(`/runs/${encodeURIComponent(runId)}/cancel`, {method: "POST"});
    if (!response.ok) throw new Error(`停止运行失败（HTTP ${response.status}）`);
    if (response.status === 204) return null;
    const result = await response.json() as unknown;
    if (result && typeof result === "object" && "run" in result) {
        const wrapped = (result as {run?: unknown}).run;
        return wrapped ? unwrapAgentRun(wrapped) : null;
    }
    return unwrapAgentRun(result);
}

function unwrapAgentRun(value: unknown): AgentRunRecord {
    if (!value || typeof value !== "object") throw new Error("运行响应格式无效");
    const candidate = value as Partial<AgentRunRecord>;
    if (!candidate.run_id || !candidate.session_id || !candidate.status || !candidate.mode) {
        throw new Error("运行响应格式无效");
    }
    return candidate as AgentRunRecord;
}

function unwrapAgentSessionDetail(value: unknown): AgentSessionDetail {
    if (!value || typeof value !== "object") throw new Error("会话响应格式无效");
    const result = value as Partial<AgentSessionDetail>;
    if (!result.session || typeof result.session !== "object" || !result.session.session_id
        || !Array.isArray(result.messages) || !Array.isArray(result.runs)) {
        throw new Error("会话响应格式无效");
    }
    return result as AgentSessionDetail;
}

function unwrapAgentSession(value: unknown): AgentSessionSummary {
    if (!value || typeof value !== "object") throw new Error("会话响应格式无效");
    const candidate = "session" in value ? (value as {session?: unknown}).session : value;
    if (!candidate || typeof candidate !== "object") throw new Error("会话响应格式无效");
    const session = candidate as Partial<AgentSessionSummary>;
    if (!session.session_id) throw new Error("会话响应格式无效");
    return session as AgentSessionSummary;
}

/**
 * 登录鉴权接口
 * @param token
 */
export const login = (username: string, password: string, register = false) => {
    return fetch(`${openAIApiHostUrl}/api/v1/auth/${register ? 'register' : 'password/login'}`, {
        method: 'post',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({username, password}),
        signal: AbortSignal.timeout(15000),
    });
};

export const logout = () => fetch(`${openAIApiHostUrl}/api/v1/auth/logout`, {
    method: 'POST', headers: getHeaders(), signal: AbortSignal.timeout(10000),
});

/**
 * 商品列表查询
 */
export const queryProductList = () => {
    return fetch(`${openAIApiHostUrl}/api/v1/sale/query_product_list`, {
        method: "get",
        headers: getHeaders(),
    });
}

/**
 * 用户商品下单，获得支付地址 url
 */
export const createPayOrder = (productId: number) => {
    return fetch(`${openAIApiHostUrl}/api/v1/sale/create_pay_order`, {
        method: "post",
        headers: {
            ...getHeaders(),
            "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
        },
        body: new URLSearchParams({productId: String(productId), channel: 'ALIPAY_SANDBOX'}),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
    });
}

export const queryPayOrder = (orderId: string) => fetch(
    `${openAIApiHostUrl}/api/v1/sale/query_pay_order?orderId=${encodeURIComponent(orderId)}`,
    {method: "GET", headers: getHeaders(), cache: "no-store", signal: AbortSignal.timeout(15000)},
);

/**
 * 日历签到返利接口
 */
export const calendarSignRebate = () => {
    try {
        return fetch(`${bigMarketApiHostUrl}/api/v1/raffle/activity/calendar_sign_rebate_by_token`, {
            method: 'POST',
            headers: {
                ...getHeaders(),
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        })
    } catch (error) {
        return fetch("{\n" +
            "    \"code\": \"0001\",\n" +
            "    \"info\": \"调用失败\",\n" +
            "    \"data\": [\n" +
            "}");
    }
}

/** 按月查询当前用户的签到日期（YYYY-MM-DD）。 */
export const queryCalendarSignRecords = (month: string, signal?: AbortSignal) => {
    return fetch(`${bigMarketApiHostUrl}/api/v1/raffle/activity/query_calendar_sign_records_by_token?${new URLSearchParams({month})}`, {
        method: "POST",
        headers: getHeaders(),
        signal,
    });
};

/**
 * 判断是否签到接口
 */
export const isCalendarSignRebate = () => {
    try {
        return fetch(`${bigMarketApiHostUrl}/api/v1/raffle/activity/is_calendar_sign_rebate_by_token`, {
            method: 'POST',
            headers: {
                ...getHeaders(),
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        })
    } catch (error) {
        return fetch("{\n" +
            "    \"code\": \"0001\",\n" +
            "    \"info\": \"调用失败\",\n" +
            "    \"data\": [\n" +
            "}");
    }
}

/**
 * 查询账户额度
 * @param activityId    活动ID
 */
export const queryUserActivityAccount = (activityId?: number) => {
    try {
        return fetch(`${bigMarketApiHostUrl}/api/v1/raffle/activity/query_user_activity_account_by_token`, {
            method: 'POST',
            headers: {
                ...getHeaders(),
                'Content-Type': 'application/json;charset=utf-8'
            },
            body: JSON.stringify({
                activityId: activityId
            })
        })
    } catch (error) {
        return fetch("{\n" +
            "    \"code\": \"0001\",\n" +
            "    \"info\": \"调用失败\",\n" +
            "    \"data\": [\n" +
            "}");
    }
}

export const queryUserCreditAccount = ()=>{
    try {
        return fetch(`${bigMarketApiHostUrl}/api/v1/raffle/activity/query_user_credit_account_by_token`, {
            method: 'POST',
            headers: {
                ...getHeaders(),
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        })
    } catch (error) {
        return fetch("{\n" +
            "    \"code\": \"0001\",\n" +
            "    \"info\": \"调用失败\",\n" +
            "    \"data\": [\n" +
            "}");
    }
}

/**
 * 抽奖接口
 * @param activityId 用户ID
 */
export const draw = (activityId?: number, requestId?: string) => {
    try {
        return fetch(`${bigMarketApiHostUrl}/api/v1/raffle/activity/draw_by_token`, {
            method: 'POST',
            headers: {
                ...getHeaders(),
                'Content-Type': 'application/json;charset=utf-8'
            },
            body: JSON.stringify({
                activityId: activityId,
                ...(requestId ? {requestId} : {})
            })
        })
    } catch (error) {
        return fetch("{\n" +
            "    \"code\": \"0001\",\n" +
            "    \"info\": \"调用失败\",\n" +
            "    \"data\": [\n" +
            "}");
    }
}


/**
 * 查询抽奖奖品列表
 * @param activityId 用户ID
 */
export const queryRaffleAwardList = (activityId?: number) => {
    try {
        return fetch(`${bigMarketApiHostUrl}/api/v1/raffle/strategy/query_raffle_award_list_by_token`, {
            method: 'POST',
            headers: {
                ...getHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                activityId: activityId
            })
        });
    } catch (error) {
        return fetch("{\n" +
            "    \"code\": \"0001\",\n" +
            "    \"info\": \"调用失败\",\n" +
            "    \"data\": [\n" +
            "}");
    }
}


export const querySkuProductListByActivityId = (activityId?: number)=>{
    try {
        return fetch(`${bigMarketApiHostUrl}/api/v1/raffle/activity/query_sku_product_list_by_activity_id?activityId=${activityId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        })
    } catch (error) {
        return fetch("{\n" +
            "    \"code\": \"0001\",\n" +
            "    \"info\": \"调用失败\",\n" +
            "    \"data\": [\n" +
            "}");
    }
}

export const creditPayExchangeSku = (sku?: number, requestId?: string) => {
    try {
        return fetch(`${bigMarketApiHostUrl}/api/v1/raffle/activity/credit_pay_exchange_sku_by_token`, {
            method: 'POST',
            headers: {
                ...getHeaders(),
                'Content-Type': 'application/json;charset=utf-8'
            },
            body: JSON.stringify({
                sku: sku,
                ...(requestId ? {requestId} : {})
            })
        })
    } catch (error) {
        return fetch("{\n" +
            "    \"code\": \"0001\",\n" +
            "    \"info\": \"调用失败\",\n" +
            "    \"data\": [\n" +
            "}");
    }
}

export const queryStageActivityId = () => {
    return fetch(`${bigMarketApiHostUrl}/api/v1/raffle/activity/query_stage_activity_id?channel=c01&source=s01`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    })
}






/** 查询当前活动的中奖展示和最新播报。 */
export const queryAwardFeed = (activityId: number, pageNo = 1, pageSize = 5, signal?: AbortSignal) => {
    const query = new URLSearchParams({activityId: String(activityId), pageNo: String(pageNo), pageSize: String(pageSize)});
    return fetch(`${bigMarketApiHostUrl}/api/v1/raffle/activity/query_award_feed?${query}`, {
        method: "POST", headers: getHeaders(), signal,
    });
};

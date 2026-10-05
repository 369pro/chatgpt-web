import {ChatModelOption} from "@/app/constants";
import {useAccessStore} from "@/app/store/access";
import {MessageRole} from "@/types/chat";

// 构建前把localhost修改为你的公网IP或者域名地址 https://api.gaga.plus http://127.0.0.1:8091
const openAIApiHostUrl = process.env.NEXT_PUBLIC_API_HOST_URL || "http://127.0.0.1:8093";
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

/**
 * Role 角色获取接口
 */
export const getRoleList = () => {
    // 从本地 json 文件获取
    return fetch(`/prompts.json`).then((res) => res.json());
};

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

export const queryAccountQuota = () => {
    return fetch(`${openAIApiHostUrl}/api/v1/account/query_account_quota`, {
        method: "post",
        headers: {
            ...getHeaders(),
            "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
    });
}

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

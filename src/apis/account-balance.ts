import {useAccessStore} from "@/app/store/access";

export interface AccountBalance {
    currency: "CNY";
    availableAmount: string;
    totalAmount: string;
    legacyQuota?: number;
    billingMode?: "TOKEN";
}

export function queryAccountBalance() {
    const host = process.env.NEXT_PUBLIC_API_HOST_URL || "http://127.0.0.1:8093";
    return fetch(`${host}/api/v1/account/query_account_balance`, {
        method: "POST",
        headers: {Authorization: useAccessStore.getState().token},
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
    });
}

export function formatBalance(amount: string): string {
    // Preserve every fractional digit from the server without binary floating-point rounding.
    if (!/^\d+(\.\d{1,8})?$/.test(amount)) return "—";
    const [whole, fraction = ""] = amount.split(".");
    return `¥${whole}.${fraction.replace(/0+$/, "").padEnd(2, "0")}`;
}

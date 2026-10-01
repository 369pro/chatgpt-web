import {useAccessStore} from "@/app/store/access";

export async function readMarketResult<T>(request: Promise<Response>): Promise<T> {
    let response: Response;
    try { response = await request; }
    catch { throw new Error("网络连接失败，请稍后重试"); }
    if (!response.ok) throw new Error("服务暂不可用，请稍后重试");
    const result = await response.json();
    if (result.code === "0003") {
        useAccessStore.getState().goToLogin();
        throw new Error("登录已过期，请重新登录");
    }
    if (result.code !== "0000") throw new Error(result.info || "操作未完成，请稍后重试");
    return result.data;
}

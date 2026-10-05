import {create} from "zustand";
import {persist} from "zustand/middleware";
import {login} from "@/apis";

interface AccessControlStore {
    token: string;
    username: string;
    updateToken: (token: string) => void;
    isAuthorized: () => boolean;
    login: (username: string, password: string, register?: boolean) => Promise<void>;
    goToLogin: () => void;
}

export const useAccessStore = create<AccessControlStore>()(persist<AccessControlStore, [], [], Pick<AccessControlStore, "token" | "username">>((set, get) => ({
    token: "",
    username: "",
    updateToken: token => set({token}),
    isAuthorized: () => Boolean(get().token),
    goToLogin: () => set({token: "", username: ""}),
    async login(username, password, register = false) {
        let response: Response;
        try { response = await login(username, password, register); }
        catch { throw new Error("无法连接登录服务，请稍后重试"); }
        if (!response.ok) throw new Error("登录服务暂不可用，请稍后重试");
        const result = await response.json();
        if (result.code !== "0000" || !result.data?.token) {
            throw new Error(result.info || "账号或密码错误");
        }
        set({token: result.data.token, username: result.data.username});
    },
}), {
    name: "chat-access",
    version: 2,
    // Persist merges these fields with the current store, retaining its actions.
    migrate: () => ({token: "", username: ""} as AccessControlStore),
    partialize: state => ({token: state.token, username: state.username}),
}));

"use client";

import {ConfigProvider} from "antd";
import {AppstoreFilled, MessageOutlined, GiftOutlined, RobotOutlined} from "@ant-design/icons";
import {HashRouter as Router, Routes, Route, NavLink, Navigate, useLocation} from "react-router-dom";
import dynamic from "next/dynamic";
import {SideBar} from "../../components/sidebar/sidebar";
import {DialogMessage} from "@/app/components/dialog/dialog-message";
import {useAccessStore} from "@/app/store/access";
import {AppLoading} from "@/app/components/app-loading";
import styles from "./home.module.scss";

const loading = () => <AppLoading/>;
const Chat = dynamic(async () => (await import("../chat/chat")).Chat, {loading});
const Auth = dynamic(async () => (await import("../auth/auth")).Auth, {loading});
const Sale = dynamic(async () => (await import("../sale/sale")).Sale, {loading});
const Market = dynamic(async () => (await import("../market/market")).Market, {loading});
const Assistant = dynamic(async () => (await import("../assistant/assistant")).Assistant, {loading});

function Screen() {
    const {token, username} = useAccessStore();
    const {pathname} = useLocation();
    const isChat = pathname === "/chat" || pathname.startsWith("/chat/");
    if (!token) return <Auth/>;
    return <div className={`${styles.shell} ${isChat ? styles.chatShell : ""}`}>
        <header className={styles.topbar}>
            <div className={styles.topbarInner}>
                <NavLink to="/market" className={styles.brand}><AppstoreFilled/><span>LLM Market</span></NavLink>
                <nav className={styles.topnav} aria-label="主导航">
                    <NavLink to="/market"><GiftOutlined/>福利中心</NavLink>
                    <NavLink to="/chat"><MessageOutlined/>智能对话</NavLink>
                    <NavLink to="/assistant"><RobotOutlined/>个人助理</NavLink>
                </nav>
                <span className={styles.account}><span className={styles.avatar}>{username.slice(0, 1).toUpperCase()}</span>{username}</span>
            </div>
        </header>
        <div className={styles.workspace}>
            <SideBar/>
            <main className={styles.content}>
                <Routes>
                    <Route path="/chat" element={<Chat/>}><Route path=":id" element={<DialogMessage/>}/></Route>
                    <Route path="/market" element={<Market/>}/>
                    <Route path="/sale" element={<Sale/>}/>
                    <Route path="/assistant" element={<Assistant/>}/>
                    <Route path="/assistant/:id" element={<Assistant/>}/>
                    <Route path="*" element={<Navigate to="/market" replace/>}/>
                </Routes>
            </main>
        </div>
    </div>;
}

export function Home() {
    return <ConfigProvider theme={{token: {colorPrimary: "#2878ff", borderRadius: 6, fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif'}}}>
        <Router><Screen/></Router>
    </ConfigProvider>;
}

import {NavLink, useNavigate} from "react-router-dom";
import {GiftOutlined, MessageOutlined, RobotOutlined, ShoppingOutlined, LogoutOutlined} from "@ant-design/icons";
import {Button, message} from "antd";
import {useAccessStore} from "@/app/store/access";
import {logout} from "@/apis";
import {useState} from "react";
import styles from "./sidebar.module.scss";

export function SideBar() {
    const access = useAccessStore();
    const navigate = useNavigate();
    const [pending, setPending] = useState(false);
    const [notice, holder] = message.useMessage();
    async function signOut() {
        setPending(true);
        try {
            const response = await logout();
            const result = await response.json();
            if (!response.ok || result.code !== "0000") throw new Error();
            access.goToLogin();
            navigate("/auth", {replace: true});
        } catch { notice.error("退出失败，请重试"); }
        finally { setPending(false); }
    }
    return <aside className={styles.sidebar}>
        {holder}
        <div className={styles.profile}>
            <span className={styles.avatar}>{access.username.slice(0, 1).toUpperCase()}</span>
            <strong>{access.username}</strong><span className={styles.caption}>个人中心</span>
        </div>
        <nav className={styles.nav} aria-label="个人中心导航">
            <NavLink to="/market"><GiftOutlined/>幸运抽奖</NavLink>
            <NavLink to="/chat"><MessageOutlined/>我的对话</NavLink>
            <NavLink to="/assistant"><RobotOutlined/>个人助理</NavLink>
            <NavLink to="/sale"><ShoppingOutlined/>余额充值</NavLink>
        </nav>
        <div className={styles.footer}><Button type="text" aria-label="退出登录" title="退出登录" icon={<LogoutOutlined/>} loading={pending} onClick={signOut}>退出登录</Button></div>
    </aside>;
}

import {FormEvent, useState} from "react";
import {Button, Input} from "antd";
import {LockOutlined, UserOutlined, AppstoreFilled} from "@ant-design/icons";
import {useNavigate} from "react-router-dom";
import {useAccessStore} from "../../store/access";
import styles from "./auth.module.scss";

export function Auth() {
    const access = useAccessStore();
    const navigate = useNavigate();
    const [register, setRegister] = useState(false);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");

    async function submit(event: FormEvent) {
        event.preventDefault();
        if (pending) return;
        if (register && password !== confirm) { setError("两次输入的密码不一致"); return; }
        setPending(true);
        setError("");
        try {
            await access.login(username, password, register);
            setPassword("");
            setConfirm("");
            navigate("/market", {replace: true});
        } catch (e) {
            setError(e instanceof Error ? e.message : "登录失败，请重试");
        } finally { setPending(false); }
    }

    return <div className={styles.page}>
        <header className={styles.header}><AppstoreFilled aria-hidden/><span>LLM Market</span></header>
        <main className={styles.main}>
            <form className={styles.form} onSubmit={submit}>
                <div className={styles.mark}><AppstoreFilled aria-hidden/></div>
                <h1>{register ? "创建账号" : "欢迎回来"}</h1>
                <p className={styles.subtitle}>LLM Market 个人中心</p>
                <label htmlFor="username">账号</label>
                <Input id="username" name="username" prefix={<UserOutlined/>} placeholder="输入账号"
                    autoComplete="username" value={username} required pattern="[A-Za-z0-9_]{4,32}"
                    minLength={4} maxLength={32} disabled={pending}
                    title="4-32位字母、数字或下划线" onChange={e => {setUsername(e.target.value); setError("");}}/>
                {register && <span className={styles.hint}>4-32 位字母、数字或下划线</span>}
                <label htmlFor="password">密码</label>
                <Input.Password id="password" name="password" prefix={<LockOutlined/>} placeholder="输入密码"
                    autoComplete={register ? "new-password" : "current-password"} value={password}
                    minLength={8} maxLength={64} required disabled={pending}
                    onChange={e => {setPassword(e.target.value); setError("");}}/>
                {register && <>
                    <span className={styles.hint}>8-64 位字符，不超过 72 字节</span>
                    <label htmlFor="confirm">确认密码</label>
                    <Input.Password id="confirm" name="confirm" prefix={<LockOutlined/>} placeholder="再次输入密码"
                        autoComplete="new-password" value={confirm} required minLength={8} maxLength={64}
                        disabled={pending} onChange={e => {setConfirm(e.target.value); setError("");}}/>
                </>}
                <div className={styles.error} role="alert" aria-live="polite">{error}</div>
                <Button type="primary" htmlType="submit" block loading={pending} className={styles.submit}>
                    {register ? "创建账号并登录" : "登录"}
                </Button>
                <div className={styles.switch}>
                    {register ? "已有账号？" : "还没有账号？"}
                    <button type="button" disabled={pending} onClick={() => {
                        setRegister(!register); setError(""); setPassword(""); setConfirm("");
                    }}>{register ? "返回登录" : "注册账号"}</button>
                </div>
            </form>
        </main>
        <footer className={styles.footer}>LLM Market</footer>
    </div>;
}

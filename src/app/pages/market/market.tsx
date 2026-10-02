import {useCallback, useEffect, useRef, useState} from "react";
import {Alert, Button, Modal, Spin, Tooltip, message} from "antd";
import {GiftOutlined, ReloadOutlined, CalendarOutlined, CheckCircleFilled, WalletOutlined, MessageOutlined} from "@ant-design/icons";
import {queryStageActivityId, queryUserActivityAccount, queryUserCreditAccount, isCalendarSignRebate, calendarSignRebate, querySkuProductListByActivityId, creditPayExchangeSku} from "@/apis";
import {AccountBalance, formatBalance, queryAccountBalance} from "@/apis/account-balance";
import {useAccessStore} from "@/app/store/access";
import {LuckyGridPage} from "./element/lucky-grid-page";
import {SignCalendar} from "./element/sign-calendar";
import {AwardFeedPanel} from "./element/award-feed";
import {readMarketResult} from "./result";
import {SkuProductResponseDTO} from "@/types/SkuProductResponseDTO";
import styles from "./market.module.scss";

export function Market() {
    const [activityId, setActivityId] = useState(0);
    const [refresh, setRefresh] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [signed, setSigned] = useState(false);
    const [busy, setBusy] = useState<string | number>("");
    const [credit, setCredit] = useState<number | null>(null);
    const [draws, setDraws] = useState<number | null>(null);
    const [balance, setBalance] = useState<string | null>(null);
    const [products, setProducts] = useState<SkuProductResponseDTO[]>([]);
    const [rules, setRules] = useState(false);
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [notice, holder] = message.useMessage();
    const username = useAccessStore(state => state.username);
    const exchangeRequest = useRef<{sku: number; requestId: string}>();
    const reload = useCallback(() => setRefresh(value => value + 1), []);
    const refreshTimer = useRef<ReturnType<typeof setTimeout>>();
    useEffect(() => () => clearTimeout(refreshTimer.current), []);
    const refreshAfterReward = useCallback(() => {
        reload();
        clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(reload, 1500);
    }, [reload]);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError("");
        (async () => {
            const id = await readMarketResult<number>(queryStageActivityId());
            if (!id) throw new Error("当前暂无上架活动");
            if (!active) return;
            setActivityId(id);
            const failures: string[] = [];
            async function load<T>(label: string, request: Promise<T>, update: (value: T) => void) {
                try { const value = await request; if (active) update(value); }
                catch (e) { failures.push(label + "：" + (e instanceof Error ? e.message : "加载失败")); }
            }
            await Promise.all([
                load("抽奖次数", readMarketResult<{dayCountSurplus: number}>(queryUserActivityAccount(id)), value => setDraws(value.dayCountSurplus)),
                load("积分", readMarketResult<number>(queryUserCreditAccount()), setCredit),
                load("对话余额", readMarketResult<AccountBalance>(queryAccountBalance()), value => setBalance(value.availableAmount)),
                load("签到状态", readMarketResult<boolean>(isCalendarSignRebate()), setSigned),
                load("兑换商品", readMarketResult<SkuProductResponseDTO[]>(querySkuProductListByActivityId(id)), setProducts),
            ]);
            if (active && failures.length) setError(failures.join("；"));
        })().catch(e => {if (active) setError(e.message || "账户数据加载失败");})
            .finally(() => {if (active) setLoading(false);});
        return () => {active = false;};
    }, [refresh]);

    async function signIn() {
        if (signed || busy) return;
        setBusy("sign");
        try {
            await readMarketResult(calendarSignRebate());
            setSigned(true);
            notice.success("签到成功");
            refreshAfterReward();
        } catch (e) { notice.error(e instanceof Error ? e.message : "签到失败，请重试"); }
        finally { setBusy(""); }
    }

    async function exchange(sku: number) {
        if (busy) return;
        if (exchangeRequest.current?.sku !== sku) {
            exchangeRequest.current = {sku, requestId: crypto.randomUUID()};
        }
        const pendingRequest = exchangeRequest.current;
        if (!pendingRequest) return;
        const requestId = pendingRequest.requestId;
        setBusy(sku);
        try {
            await readMarketResult(creditPayExchangeSku(sku, requestId));
            exchangeRequest.current = undefined;
            notice.success("兑换成功");
            refreshAfterReward();
        } catch (e) { notice.error(e instanceof Error ? e.message : "兑换失败，请重试"); }
        finally { setBusy(""); }
    }

    return <div className={styles.market}>
        {holder}
        {calendarOpen && <SignCalendar refresh={refresh} onClose={() => setCalendarOpen(false)}/>}
        <header className={styles.heading}>
            <div><p>福利中心</p><h1>幸运抽奖</h1></div>
            <Button type="text" onClick={() => setRules(true)}>活动规则</Button>
        </header>
        <div className={styles.accountBand}>
            <div><WalletOutlined/><span>我的积分<strong>{credit ?? "—"}</strong></span></div>
            <div><GiftOutlined/><span>今日剩余次数<strong>{draws ?? "—"}</strong></span></div>
            <div><MessageOutlined/><span>对话余额<strong>{balance === null ? "—" : formatBalance(balance)}</strong></span></div>
            <Tooltip title="刷新账户"><Button type="text" icon={<ReloadOutlined spin={loading}/>} aria-label="刷新账户" onClick={reload} disabled={loading}/></Tooltip>
        </div>
        {error && <Alert className={styles.error} type="warning" showIcon message={error} action={<Button size="small" onClick={reload}>重试</Button>}/>}
        <div className={styles.activity}>
            <section className={styles.drawSection} aria-label="幸运抽奖盘">
                <div className={styles.sectionTitle}><h2><GiftOutlined/>幸运九宫格</h2><span>{activityId ? "活动 " + activityId : "加载中"}</span></div>
                {activityId ? <LuckyGridPage activityId={activityId} refresh={refresh} onWin={refreshAfterReward}/> : <div className={styles.boardPlaceholder}>{loading ? <Spin/> : "暂无可参与的活动"}</div>}
            </section>
            <aside className={styles.activityAside}>
                <section className={styles.signSection}>
                    <div className={styles.sectionTitle}><h2>每日签到</h2><Button type="text" size="small" className={styles.calendarButton} icon={<CalendarOutlined/>} onClick={() => setCalendarOpen(true)}>查看日历</Button></div>
                    <p className={styles.date}>{new Date().toLocaleDateString("zh-CN", {timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "long"})}</p>
                    <div className={styles.signStatus}><span className={styles.signIcon}><CalendarOutlined/></span><div><strong>{signed ? "今天也有新收获" : "新一天，来签到"}</strong><p>{username}</p></div></div>
                    <Button type={signed ? "default" : "primary"} block disabled={signed || Boolean(busy)} loading={busy === "sign"} onClick={signIn} icon={signed ? <CheckCircleFilled/> : undefined}>{signed ? "今日已签到" : "立即签到"}</Button>
                </section>
                {activityId > 0 && <AwardFeedPanel key={activityId} activityId={activityId} refresh={refresh}/>}
            </aside>
        </div>
        <section className={styles.exchangeSection}>
            <div className={styles.sectionTitle}><h2>积分兑换</h2><span>抽奖机会</span></div>
            <div className={styles.products}>
                {products.map(product => <article className={styles.product} key={product.sku}>
                    <div className={styles.productIcon}><GiftOutlined/></div>
                    <div><h3>{product.activityCount.totalCount} 次抽奖</h3><p>每日上限 {product.activityCount.dayCount} 次</p><strong>{product.productAmount} <span>积分</span></strong></div>
                    <Button loading={busy === product.sku} disabled={Boolean(busy) || product.stockCountSurplus <= 0 || credit === null || credit < product.productAmount} onClick={() => exchange(product.sku)}>
                        {product.stockCountSurplus <= 0 ? "已兑完" : credit !== null && credit < product.productAmount ? "积分不足" : "兑换"}
                    </Button>
                </article>)}
                {!loading && !products.length && <p className={styles.muted}>暂无可兑换的商品</p>}
            </div>
        </section>
        <Modal title="活动规则" open={rules} onCancel={() => setRules(false)} footer={<Button type="primary" onClick={() => setRules(false)}>知道了</Button>}>
            <ol className={styles.rules}><li>每次抽奖消耗 1 次活动机会，次数以账户当前额度为准。</li><li>签到奖励由当前活动配置决定，到账后可刷新账户查看。</li><li>积分可兑换抽奖机会，兑换受剩余库存及账户积分限制。</li><li>部分奖品在达到参与次数后解锁，具体条件见奖品状态。</li><li>抽奖结果以服务端返回为准，奖励异步发放。</li></ol>
        </Modal>
    </div>;
}

import {useEffect, useState} from "react";
import {Alert, Button, Pagination, Spin} from "antd";
import {GiftOutlined, SoundOutlined, TrophyOutlined, ReloadOutlined} from "@ant-design/icons";
import {queryAwardFeed, queryRaffleAwardList} from "@/apis";
import {AwardFeed, AwardFeedItem} from "@/types/AwardFeed";
import {RaffleAwardVO} from "@/types/RaffleAwardVO";
import {readMarketResult} from "../result";
import styles from "./award-feed.module.scss";

const pageSize = 5;
const awardImages = ["00", "01", "02", "12", "22", "21", "20", "10"];

function awardDate(value: string, withTime = false) {
    const date = new Date(value);
    const yearFormat = new Intl.DateTimeFormat("en", {timeZone: "Asia/Shanghai", year: "numeric"});
    return date.toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit",
        ...(yearFormat.format(date) !== yearFormat.format(new Date()) ? {year: "numeric" as const} : {}),
        ...(withTime ? {hour: "2-digit" as const, minute: "2-digit" as const} : {}),
    });
}

export function AwardFeedPanel({activityId, refresh}: {activityId: number; refresh: number}) {
    const [page, setPage] = useState(1);
    const [retry, setRetry] = useState(0);
    const [data, setData] = useState<AwardFeed | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [images, setImages] = useState<Record<number, string>>({});

    useEffect(() => {
        let active = true;
        readMarketResult<RaffleAwardVO[]>(queryRaffleAwardList(activityId)).then(awards => {
            const next: Record<number, string> = {};
            [...awards].sort((a, b) => a.sort - b.sort).forEach((award, index) => {
                if (awardImages[index]) next[award.awardId] = `/raffle-award-${awardImages[index]}.png`;
            });
            if (active) setImages(next);
        }).catch(() => { /* Award records remain readable with the gift fallback. */ });
        return () => {active = false;};
    }, [activityId]);

    useEffect(() => {
        let active = true;
        let pending = false;
        let controller: AbortController | undefined;
        async function load() {
            if (pending) return;
            pending = true;
            controller = new AbortController();
            const timeout = setTimeout(() => controller?.abort(), 12000);
            setLoading(true);
            try {
                const result = await readMarketResult<AwardFeed>(queryAwardFeed(activityId, page, pageSize, controller.signal));
                if (!Array.isArray(result?.records) || !Array.isArray(result.broadcasts) || !Number.isInteger(result.total)) {
                    throw new Error("中奖记录格式异常，请重试");
                }
                if (!active) return;
                const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
                if (page > lastPage) {setPage(lastPage); return;}
                setData(result);
                setError("");
            } catch (reason) {
                if (active) setError(reason instanceof Error ? reason.message : "中奖记录加载失败");
            } finally {
                clearTimeout(timeout);
                pending = false;
                if (active) setLoading(false);
            }
        }
        void load();
        const timer = setInterval(() => {if (!document.hidden) void load();}, 15000);
        const onVisible = () => {if (!document.hidden) void load();};
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            active = false;
            controller?.abort();
            clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [activityId, page, refresh, retry]);

    const currentData = data?.pageNo === page ? data : null;
    function awardImage(item: AwardFeedItem) {
        return <span className={styles.awardImage}>{images[item.awardId]
            // Local illustrations match the same activity's raffle grid.
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={images[item.awardId]} alt=""/> : <GiftOutlined/>}</span>;
    }

    return <div className={styles.feed}>
        <section aria-label="围观大奖">
            <div className={styles.heading}>
                <h2><TrophyOutlined/>围观大奖</h2>
                <Button type="text" size="small" aria-label="刷新中奖记录" icon={<ReloadOutlined spin={loading}/>} disabled={loading} onClick={() => setRetry(value => value + 1)}/>
            </div>
            {error && <Alert className={styles.error} type="warning" showIcon message={data ? "更新失败，当前显示上次记录" : error} action={<Button size="small" onClick={() => setRetry(value => value + 1)}>重试</Button>}/>}
            {!currentData ? <div className={styles.placeholder}>{loading ? <Spin/> : "中奖记录暂不可用"}</div> : currentData.records.length === 0 ?
                <div className={styles.empty}><GiftOutlined/><p>暂无中奖记录</p><span>本活动产生中奖后会展示在这里</span></div> : <>
                    <ul className={styles.winners} aria-label="中奖用户列表" aria-busy={loading}>
                        {currentData.records.map(item => <li key={item.recordId}>
                            {awardImage(item)}
                            <div className={styles.winner}><p>恭喜 <strong>{item.winnerName}</strong></p><span title={item.awardTitle}>抽中 <b>{item.awardTitle}</b></span></div>
                            <time dateTime={item.awardTime} title={new Date(item.awardTime).toLocaleString("zh-CN", {timeZone: "Asia/Shanghai"})}>{awardDate(item.awardTime)}</time>
                        </li>)}
                    </ul>
                    <nav className={styles.pagination} aria-label="中奖记录分页"><Pagination size="small" current={page} pageSize={pageSize} total={currentData.total} showSizeChanger={false} showLessItems onChange={setPage}/></nav>
                    <p className={styles.caption}>本活动最近 {currentData.total} 条中奖记录</p>
                </>}
        </section>
        <section className={styles.broadcasts} aria-label="中奖播报">
            <div className={styles.heading}><h2><SoundOutlined/>中奖播报</h2><span>最新动态</span></div>
            {!data ? <div className={styles.broadcastEmpty}>{loading ? "正在加载中奖动态…" : "中奖动态暂不可用"}</div> : data.broadcasts.length === 0 ?
                <p className={styles.broadcastEmpty}>暂无中奖动态</p> : <ul className={styles.ticker} aria-label="最新中奖动态" tabIndex={0}>
                    {data.broadcasts.map(item => <li key={item.recordId}>
                        <GiftOutlined/>
                        <div><span>恭喜 <strong>{item.winnerName}</strong></span><p title={item.awardTitle}>抽中 {item.awardTitle}</p></div>
                        <time dateTime={item.awardTime} title={new Date(item.awardTime).toLocaleString("zh-CN", {timeZone: "Asia/Shanghai"})}>{awardDate(item.awardTime, true)}</time>
                    </li>)}
                </ul>}
        </section>
    </div>;
}

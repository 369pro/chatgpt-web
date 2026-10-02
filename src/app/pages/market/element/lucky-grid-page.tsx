"use client";

import {useState, useRef, useEffect, useMemo} from "react";
import {LuckyGrid} from "@lucky-canvas/react";
import {Alert, Button, Modal, Spin} from "antd";
import {GiftOutlined, ReloadOutlined, LockFilled} from "@ant-design/icons";
import {draw, queryRaffleAwardList} from "@/apis";
import {RaffleAwardVO} from "@/types/RaffleAwardVO";
import {readMarketResult} from "../result";
import styles from "./lucky-grid.module.scss";

const positions = [[0,0],[1,0],[2,0],[2,1],[2,2],[1,2],[0,2],[0,1]];
const images = ["00","01","02","12","22","21","20","10"];
const blocks = [{padding: "8px", background: "#e5e7eb", borderRadius: 8}];
interface Props {activityId: number; refresh: number; onWin: (title: string) => void;}

export function LuckyGridPage({activityId, refresh, onWin}: Props) {
    const [awards, setAwards] = useState<RaffleAwardVO[]>([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [retry, setRetry] = useState(0);
    const [winner, setWinner] = useState("");
    const [size, setSize] = useState(300);
    const lucky = useRef<any>(null);
    const wrapper = useRef<HTMLDivElement>(null);
    const locked = useRef(false);
    const pendingWinner = useRef("");
    const timeout = useRef<ReturnType<typeof setTimeout>>();
    const active = useRef(true);
    const eligibleAwards = useMemo(() => awards.filter(award => award.isAwardUnlock !== false), [awards]);
    const drawRequestId = useRef<string>();

    useEffect(() => {
        active.current = true;
        const observer = new ResizeObserver(entries => setSize(Math.floor(Math.min(440, entries[0].contentRect.width))));
        if (wrapper.current) observer.observe(wrapper.current);
        return () => {active.current = false; observer.disconnect(); clearTimeout(timeout.current);};
    }, []);

    useEffect(() => {
        let mounted = true;
        setLoading(true);
        readMarketResult<RaffleAwardVO[]>(queryRaffleAwardList(activityId))
            .then(data => {
                if (!mounted || locked.current) return;
                if (data.length !== 8) throw new Error("当前活动奖品配置不完整");
                setAwards([...data].sort((a, b) => a.sort - b.sort)); setError("");
            }).catch(e => {if (mounted) setError(e.message || "奖品加载失败");})
            .finally(() => {if (mounted) setLoading(false);});
        return () => {mounted = false;};
    }, [activityId, refresh, retry]);

    useEffect(() => {
        drawRequestId.current = undefined;
    }, [activityId]);

    async function start() {
        if (locked.current || loading || awards.length !== 8 || !eligibleAwards.length) return;
        locked.current = true; setBusy(true); setError("");
        try {
            drawRequestId.current ??= crypto.randomUUID();
            const result = await readMarketResult<{awardId: number; awardIndex: number; awardTitle: string}>(
                draw(activityId, drawRequestId.current));
            if (!active.current) return;
            const award = awards.find(item => item.awardId === result.awardId);
            if (!award) throw new Error("抽奖已完成，结果不在当前奖品列表中，请刷新查看");
            const index = eligibleAwards.findIndex(item => item.awardId === result.awardId);
            pendingWinner.current = result.awardTitle || award.awardTitle;
            // This draw may itself reach an unlock threshold. Never animate into a tile still shown as locked.
            if (index < 0) {
                setWinner(pendingWinner.current);
                setBusy(false); locked.current = false;
                drawRequestId.current = undefined;
                setRetry(value => value + 1);
                onWin(pendingWinner.current);
                return;
            }
            lucky.current.play();
            timeout.current = setTimeout(() => lucky.current?.stop(index), 900);
        } catch (e) {
            if (active.current) {setError(e instanceof Error ? e.message : "抽奖失败，请重试"); setBusy(false);}
            locked.current = false;
        }
    }

    const prizes = useMemo(() => awards.flatMap((award, index) => award.isAwardUnlock === false ? [] : [{
        x: positions[index][0], y: positions[index][1],
        background: "#ffffff",
        borderRadius: 5,
        imgs: [{src: "/raffle-award-" + images[index] + ".png", width: "48%", height: "48%", top: "12%"}],
        fonts: [{text: award.awardTitle,
            top: "74%", fontSize: size < 340 ? "10px" : "12px", fontColor: "#1d1d1f", lengthLimit: "95%"}],
    }]), [awards, size]);
    const buttons = useMemo(() => [{x: 1, y: 1, background: "#0071e3", borderRadius: 5,
        fonts: [{text: busy ? "抽奖中" : "幸运抽奖", top: "35%", fontColor: "#fff", fontSize: size < 340 ? "14px" : "18px"}]}], [busy, size]);

    return <div ref={wrapper} className={styles.wrapper}>
        <div className={styles.board} style={{width: size, height: size}} aria-label="抽奖奖品展示">
            {awards.length === 8 ? <LuckyGrid ref={lucky} width={size + "px"} height={size + "px"} rows={3} cols={3}
                prizes={prizes} blocks={blocks}
                defaultConfig={{gutter: 6}}
                defaultStyle={{background: "#ffffff", borderRadius: 5}}
                activeStyle={{background: "#e4f0ff", shadow: "0 0 8 #0071e3"}}
                buttons={buttons}
                onStart={start} onEnd={() => {
                    setBusy(false); locked.current = false;
                    drawRequestId.current = undefined;
                    setWinner(pendingWinner.current);
                    onWin(pendingWinner.current);
                }}/> : loading ? <Spin/> : <Button icon={<ReloadOutlined/>} onClick={() => setRetry(value => value + 1)}>重新加载</Button>}
            <div className={styles.lockedOverlay}>
                {awards.map((award, index) => award.isAwardUnlock === false && <div
                    key={award.awardId} className={styles.lockedPrize} data-locked-award={award.awardId}
                    style={{gridColumn: positions[index][0] + 1, gridRow: positions[index][1] + 1}}
                    aria-label={award.awardTitle + "，未解锁"}>
                    <img src={"/raffle-award-" + images[index] + ".png"} alt=""/>
                    <LockFilled className={styles.lockIcon} aria-label="未解锁"/>
                    <span>{award.waitUnLockCount > 0 ? "再抽" + award.waitUnLockCount + "次解锁" : "未解锁"}</span>
                </div>)}
            </div>
        </div>
        <Button className={styles.drawButton} type="primary" icon={<GiftOutlined/>} loading={busy}
            disabled={loading || awards.length !== 8 || !eligibleAwards.length} onClick={start}>抽奖一次</Button>
        <p className={styles.cost}>消耗 1 次活动机会</p>
        {error && <Alert type="warning" showIcon message={error}/>}
        <ul className={styles.accessiblePrizes} aria-label="奖品列表">{awards.map(award => <li key={award.awardId}>{award.awardTitle}{award.isAwardUnlock === false && award.waitUnLockCount > 0 ? "，再抽" + award.waitUnLockCount + "次解锁" : ""}</li>)}</ul>
        <Modal title="抽奖结果" open={Boolean(winner)} onCancel={() => setWinner("")} footer={<Button type="primary" onClick={() => setWinner("")}>收下奖励</Button>}>
            <div className={styles.winner}><GiftOutlined/><h3>{winner}</h3><p>奖励正在发放，稍后可刷新账户查看</p></div>
        </Modal>
    </div>;
}

import {useEffect, useState} from "react";
import {Alert, Button, Modal, Spin} from "antd";
import {CheckCircleFilled, LeftOutlined, RightOutlined} from "@ant-design/icons";
import {queryCalendarSignRecords} from "@/apis";
import {readMarketResult} from "../result";
import styles from "./sign-calendar.module.scss";

// Match the market service's business timezone, regardless of browser timezone.
function currentSignDate() {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}

export function SignCalendar({refresh, onClose}: {refresh: number; onClose: () => void}) {
    const today = currentSignDate();
    const currentMonth = today.slice(0, 7);
    const [month, setMonth] = useState(currentMonth);
    const [retry, setRetry] = useState(0);
    const [result, setResult] = useState<{month: string; dates: string[]; error: string} | null>(null);
    const [loading, setLoading] = useState(true);
    const [year, monthNumber] = month.split("-").map(Number);
    const days = new Date(year, monthNumber, 0).getDate();
    const offset = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7;
    const cells = Array.from({length: Math.ceil((offset + days) / 7) * 7}, (_, index) => {
        const day = index - offset + 1;
        return day > 0 && day <= days ? day : null;
    });
    const ready = !loading && result?.month === month;
    const error = ready ? result?.error : "";
    const signedDates = new Set(ready && !error ? result?.dates : []);

    useEffect(() => {
        let active = true;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        setLoading(true);
        readMarketResult<string[]>(queryCalendarSignRecords(month, controller.signal))
            .then(dates => {
                if (!Array.isArray(dates) || dates.some(date => typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !date.startsWith(month + "-"))) {
                    throw new Error("签到记录格式异常，请重试");
                }
                if (active) setResult({month, dates, error: ""});
            })
            .catch(reason => {
                if (active) setResult({month, dates: [], error: reason instanceof Error ? reason.message : "签到记录加载失败"});
            })
            .finally(() => {clearTimeout(timeout); if (active) setLoading(false);});
        return () => {active = false; clearTimeout(timeout); controller.abort();};
    }, [month, refresh, retry]);

    function changeMonth(step: number) {
        const next = new Date(year, monthNumber - 1 + step, 1);
        setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
    }

    return <Modal title="签到日历" open onCancel={onClose} footer={null} width={520}>
        <div className={styles.toolbar}>
            <Button type="text" icon={<LeftOutlined/>} aria-label="上个月" onClick={() => changeMonth(-1)}/>
            <h3 aria-live="polite">{year}年{monthNumber}月</h3>
            <Button type="text" icon={<RightOutlined/>} aria-label="下个月" disabled={month >= currentMonth} onClick={() => changeMonth(1)}/>
            <Button size="small" disabled={month === currentMonth} onClick={() => setMonth(currentMonth)}>本月</Button>
        </div>
        <div className={styles.summary} aria-live="polite">
            {!ready ? "正在加载签到记录…" : error ? "签到记录暂不可用" : <>本月已签到 <strong>{signedDates.size}</strong> 天</>}
        </div>
        {error ? <Alert type="warning" showIcon message={error} action={<Button size="small" onClick={() => setRetry(value => value + 1)}>重试</Button>}/> :
            !ready ? <div className={styles.loading}><Spin tip="加载中"/></div> : <>
                <table className={styles.calendar} aria-label={`${year}年${monthNumber}月签到记录`}>
                    <thead><tr>{["一", "二", "三", "四", "五", "六", "日"].map(day => <th scope="col" key={day}>{day}</th>)}</tr></thead>
                    <tbody>{Array.from({length: cells.length / 7}, (_, row) => <tr key={row}>
                        {cells.slice(row * 7, row * 7 + 7).map((day, column) => {
                            if (day === null) return <td key={column}/>;
                            const date = `${month}-${String(day).padStart(2, "0")}`;
                            const signed = signedDates.has(date);
                            const isToday = date === today;
                            const status = signed ? "已签到" : date > today ? "未到日期" : "未签到";
                            return <td key={column} aria-label={`${date}${isToday ? " 今天" : ""} ${status}`} aria-current={isToday ? "date" : undefined}>
                                <div className={[styles.day, signed ? styles.signed : "", isToday ? styles.today : "", date > today ? styles.future : ""].join(" ")}>
                                    <span>{day}</span>
                                    <small>{signed ? <><CheckCircleFilled/>已签到</> : isToday ? "今天" : ""}</small>
                                </div>
                            </td>;
                        })}
                    </tr>)}</tbody>
                </table>
                <p className={styles.hint}>{signedDates.size === 0 ? "本月暂无签到记录" : <><CheckCircleFilled/>已签到</>}<span>按北京时间记录</span></p>
            </>}
    </Modal>;
}

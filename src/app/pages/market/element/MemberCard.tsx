import {
    calendarSignRebate,
    isCalendarSignRebate,
    queryUserActivityAccount,
    queryUserCreditAccount,
    queryAccountQuota
} from "@/apis";
import React, {useEffect, useState} from "react";
import {UserActivityAccountVO} from "@/types/UserActivityAccountVO";

import styles from "./MemberCard.module.scss";
import {SaleProductEnum} from "@/types/sale_product";
import {useAccessStore} from "@/app/store/access";
import {AccountQuotaResponseDTO} from "@/types/AccountQuotaResponseDTO";

// @ts-ignore
export function MemberCard({allRefresh, activityId}) {
    const [refresh, setRefresh] = useState(0);

    const [dayCount, setDayCount] = useState(0)
    const [creditAmount, setCreditAmount] = useState(0)
    const [sign, setSign] = useState(false);

    const [surplusQuota, setSurplusQuota] = useState(0);

    const handleRefresh = () => {
        setRefresh(refresh + 1)
    };

    // 获取当前日期
    const currentDate = new Date();
    // 格式化日期为 YYYY年MM月DD日
    const formattedDate = currentDate.getFullYear() + '年'
        + ('0' + (currentDate.getMonth() + 1)).slice(-2) + '月'
        + ('0' + currentDate.getDate()).slice(-2) + '日';

    const queryUserActivityAccountHandle = async () => {
        const result = await queryUserActivityAccount(activityId);
        // 查询账户数据
        const {code, info, data}: { code: string; info: string; data: UserActivityAccountVO } = await result.json();

        // 登录拦截
        if (code === SaleProductEnum.NeedLogin) {
            useAccessStore.getState().goToLogin();
        }

        if (code != "0000") {
            window.alert("查询活动账户额度，接口调用失败 code:" + code + " info:" + info)
            return;
        }

        // 日可抽奖额度
        setDayCount(data.dayCountSurplus)
    }

    const queryUserCreditAccountHandle = async () => {
        const result = await queryUserCreditAccount();
        const {code, info, data}: { code: string; info: string; data: number } = await result.json();

        // 登录拦截
        if (code === SaleProductEnum.NeedLogin) {
            useAccessStore.getState().goToLogin();
        }

        if (code != "0000") {
            window.alert("查询活动账户额度，接口调用失败 code:" + code + " info:" + info)
            return;
        }

        // 用户积分
        setCreditAmount(data)
    }

    const calendarSignRebateHandle = async () => {
        if (sign) {
            window.alert("今日已签到！")
            return;
        }
        const queryParams = new URLSearchParams(window.location.search);
        const result = await calendarSignRebate();
        const {code, info}: { code: string; info: string; } = await result.json();

        // 登录拦截
        if (code === SaleProductEnum.NeedLogin) {
            useAccessStore.getState().goToLogin();
        }

        if (code != "0000" && code != "0003") {
            window.alert("日历签到返利接口，接口调用失败 code:" + code + " info:" + info)
            return;
        }

        setSign(true);

        // 设置一个3秒后执行的定时器
        const timer = setTimeout(() => {
            handleRefresh()
        }, 550);

        // 清除定时器，以防组件在执行前被卸载
        return () => clearTimeout(timer);
    }

    const isCalendarSignRebateHandle = async () => {
        const result = await isCalendarSignRebate();
        const {code, info, data}: { code: string; info: string; data: boolean } = await result.json();

        // 登录拦截
        if (code === SaleProductEnum.NeedLogin) {
            useAccessStore.getState().goToLogin();
        }

        if (code != "0000") {
            window.alert("判断是否签到接口，接口调用失败 code:" + code + " info:" + info)
            return;
        }

        setSign(data);
    }

    const queryAccountQuotaHandle = async () => {
        const result = await queryAccountQuota();
        const {code, info, data}: { code: string; info: string; data: AccountQuotaResponseDTO } = await result.json();

        // 登录拦截
        if (code === SaleProductEnum.NeedLogin) {
            useAccessStore.getState().goToLogin();
        }
        // 设置结果
        setSurplusQuota(data.surplusQuota);
    }

    useEffect(() => {

        queryUserActivityAccountHandle().then(r => {
        });

        queryUserCreditAccountHandle().then(r => {
        });

        isCalendarSignRebateHandle().then(r => {
        });

        queryAccountQuotaHandle().then(r => {
        });

    }, [refresh, allRefresh])

    return (
        <>
            <div className={styles["card-container"]}>
                <div className={styles["card"]}>
                    <div className={styles["card-content"]}>
                        <a href="#" className={styles["card-title"]}>我的会员卡</a>
                        <div className={styles["card-details"]}>
                            <p className={styles["card-item"]}>
                                <span className={styles["card-icon"]}>💰</span>
                                <span>我的积分：</span>
                                <span className={styles["card-highlight"]}>{creditAmount ? creditAmount : 0}￥</span>
                            </p>
                            <p className={styles["card-item"]}>
                                <span className="icon">🪅</span>
                                <span>抽奖次数：</span>
                                <span className={styles["card-highlight"]}>{dayCount ? dayCount : 0}</span>
                            </p>
                        </div>
                    </div>
                    <div className={styles["card-actions"]}>
                        <button onClick={calendarSignRebateHandle} className={styles["sign-button"]}>
                            {sign ? "已签" : "签到"}
                        </button>
                        <div className={styles["current-date"]}>{formattedDate}</div>
                    </div>
                </div>
                <button onClick={handleRefresh} className={styles["refresh-button"]}>
                    刷新⌛️
                </button>

                <div
                    style={{
                        position: 'absolute',
                        top: '1rem',
                        right: '1rem',
                        backgroundColor: 'rgba(255, 255, 255, 0.2)',
                        color: 'white',
                        fontWeight: 'bold',
                        padding: '0.25rem 0.75rem',
                        borderRadius: '9999px',
                        boxShadow: '0px 4px 6px rgba(0, 0, 0, 0.1)',
                    }}
                >
                    对话额度: {surplusQuota ? surplusQuota : 0} 次
                </div>
            </div>


        </>
    )

}
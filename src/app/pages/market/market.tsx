import {useEffect, useState} from "react";
import dynamic from "next/dynamic";
import styles from "./market.module.scss";

import {LuckyGridPage} from "@/app/pages/market/element/lucky-grid-page";
import {queryStageActivityId} from "@/apis";
import {SaleProductEnum} from "@/types/sale_product";
import {useAccessStore} from "@/app/store/access";

const MemberCardButton = dynamic(async () => (await import("./element/MemberCard")).MemberCard)
const SkuProductButton = dynamic(async () => (await import("./element/SkuProduct")).SkuProduct)

export function Market() {

    const [refresh, setRefresh] = useState(0);
    const [activityId, setActivityId] = useState(0);
    const [loading, setLoading] = useState(true);

    const handleRefresh = () => {
        setRefresh(refresh + 1)
    };

    const queryStageActivityIdHandle = async () => {
        try {
            const result = await queryStageActivityId();
            const {code, info, data} = await result.json();

            // 登录拦截
            if (code === SaleProductEnum.NeedLogin) {
                useAccessStore.getState().goToLogin();
            }

            if (code != "0000") {
                window.alert("查询上架活动失败 code:" + code + " info:" + info)
                return;
            }

            setActivityId(data);

            handleRefresh();
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        queryStageActivityIdHandle().then(r => {
        });
    }, [])

    if (loading) {
        return <div>Loading...</div>;
    }

    return (
        <div className={styles["container"]} style={{backgroundImage: "url('/background.svg')"}}>
            {/* 会员卡 */}
            <MemberCardButton allRefresh={refresh} activityId={activityId}/>

            {/*/!* 中间的两个div元素 *!/*/}
            <div className={styles["lucky-container"]}>
                <div className={styles["lucky-card"]}>
                    <div className={styles["lucky-text-gray"]}>
                        <LuckyGridPage handleRefresh={handleRefresh} activityId={activityId}/>
                    </div>
                </div>
            </div>

            {/* 商品 */}
            <SkuProductButton handleRefresh={handleRefresh} activityId={activityId}/>

        </div>
    );
}
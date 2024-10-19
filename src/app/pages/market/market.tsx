import {useState} from "react";
import dynamic from "next/dynamic";
import styles from "./market.module.scss";

import {LuckyGridPage} from "@/app/pages/market/element/lucky-grid-page";

const MemberCardButton = dynamic(async () => (await import("./element/MemberCard")).MemberCard)
const SkuProductButton = dynamic(async () => (await import("./element/SkuProduct")).SkuProduct)

export function Market() {

    const [refresh, setRefresh] = useState(0);

    const handleRefresh = () => {
        setRefresh(refresh + 1)
    };

    return (
        <div className={styles["container"]} style={{backgroundImage: "url('/background.svg')"}}>
            {/* 会员卡 */}
            <MemberCardButton allRefresh={refresh}/>

            {/*/!* 中间的两个div元素 *!/*/}
            <div className={styles["lucky-container"]}>
                <div className={styles["lucky-card"]}>
                    <div className={styles["lucky-text-gray"]}>
                        <LuckyGridPage handleRefresh={handleRefresh}/>
                    </div>
                </div>
            </div>

            {/* 商品 */}
            <SkuProductButton handleRefresh={handleRefresh}/>

        </div>
    );
}
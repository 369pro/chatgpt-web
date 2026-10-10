'use client';

import {useEffect, useState} from 'react';
import styles from './return.module.scss';
import {paymentOrderIdFromSearch, saleHashUrlForPaymentReturn} from '../return-url';

export default function PaymentReturnPage() {
    const [invalid, setInvalid] = useState(false);

    useEffect(() => {
        const orderId = paymentOrderIdFromSearch(window.location.search);
        if (orderId) {
            window.location.replace(saleHashUrlForPaymentReturn(orderId));
            return;
        }
        setInvalid(true);
    }, []);

    return <main className={styles.page} aria-live="polite">
        <section className={styles.card}>
            {invalid ? <>
                <h1>无法确认支付订单</h1>
                <p>支付宝返回的订单号缺失或格式无效，暂未查询支付结果。请返回充值页查看待支付订单。</p>
                <a className={styles.back} href="/#/sale">返回充值页</a>
            </> : <p className={styles.loading}>正在返回充值页，请稍候…</p>}
        </section>
    </main>;
}

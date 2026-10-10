'use client';

import {useEffect, useRef} from 'react';
import {useAccessStore} from '@/app/store/access';
import {
    normalizePaymentOrderId,
    paymentOrderIdFromHash,
    paymentReturnOrderKey,
    isPaymentResumeTarget,
    saleHashUrlForPaymentReturn,
} from '../return-url';

function readPendingOrderId(): string | null {
    try { return normalizePaymentOrderId(sessionStorage.getItem(paymentReturnOrderKey)); }
    catch { return null; }
}

function rememberHashOrder() {
    const orderId = paymentOrderIdFromHash(window.location.hash);
    if (!orderId) return;
    try { sessionStorage.setItem(paymentReturnOrderKey, orderId); } catch { /* storage unavailable */ }
}

function resumePaymentOrder(): boolean {
    const orderId = readPendingOrderId();
    if (!orderId) return false;
    if (!isPaymentResumeTarget(window.location.hash)) return false;
    window.location.replace(saleHashUrlForPaymentReturn(orderId));
    return true;
}

export function PaymentReturnResume() {
    const token = useAccessStore(state => state.token);
    const wasAuthorized = useRef(Boolean(token));

    useEffect(() => {
        rememberHashOrder();
        if (!token) {
            wasAuthorized.current = false;
            return;
        }
        if (wasAuthorized.current) return;
        wasAuthorized.current = true;

        let timer: number | null = null;
        let timeout: number | null = null;
        const stop = () => {
            if (timer !== null) window.clearInterval(timer);
            timer = null;
            if (timeout !== null) window.clearTimeout(timeout);
            timeout = null;
        };
        let resumed = false;
        const attempt = () => {
            if (!readPendingOrderId()) { stop(); return; }
            if (resumePaymentOrder()) { resumed = true; stop(); }
        };
        attempt();
        if (!resumed && readPendingOrderId()) {
            timer = window.setInterval(attempt, 100);
            timeout = window.setTimeout(stop, 5000);
        }
        return stop;
    }, [token]);

    return null;
}

const paymentOrderPattern = /^\d{12}$/;

export const paymentReturnOrderKey = 'llm-market-pending-payment-return-order';

export function normalizePaymentOrderId(value: unknown): string | null {
    if (typeof value !== 'string' || !paymentOrderPattern.test(value)) return null;
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? value : null;
}

export function paymentOrderIdFromSearch(search: string): string | null {
    const params = new URLSearchParams(search);
    const values = params.getAll('out_trade_no');
    return values.length === 1 ? normalizePaymentOrderId(values[0]) : null;
}

export function paymentOrderIdFromHash(hash: string): string | null {
    const queryStart = hash.indexOf('?');
    return queryStart < 0 ? null : paymentOrderIdFromSearch(hash.slice(queryStart));
}

export function hasPaymentOrderQuery(search: string): boolean {
    return new URLSearchParams(search).has('out_trade_no');
}

export function isPaymentResumeTarget(hash: string): boolean {
    const hashPath = hash.slice(1).split('?')[0] || '/';
    return hashPath === '/market' || hashPath === '/';
}

export function saleHashUrlForPaymentReturn(orderId: string): string {
    const normalized = normalizePaymentOrderId(orderId);
    if (!normalized) throw new Error('支付订单号格式无效');
    return `/#/sale?out_trade_no=${normalized}`;
}

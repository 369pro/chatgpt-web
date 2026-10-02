import styles from './sale.module.scss';
import {createPayOrder, queryPayOrder, queryProductList} from "@/apis";
import {AccountBalance, formatBalance, queryAccountBalance} from "@/apis/account-balance";
import {useEffect, useRef, useState} from "react";
import {SaleProduct, SaleProductEnum} from "@/types/sale_product";
import {useAccessStore} from "@/app/store/access";
import {useLocation, useNavigate} from "react-router-dom";
import {Alert, Button, Empty, Modal, Radio, Spin} from "antd";
import {AlipayCircleOutlined, CheckCircleFilled, CreditCardOutlined, ReloadOutlined, WechatOutlined} from "@ant-design/icons";

type PaymentStatus = 'CREATE' | 'WAIT' | 'COMPLETED' | 'CLOSE';

type Payment = {
    orderId: string; status: PaymentStatus;
    payUrl?: string; amount: number; creditAmount: string | null; quota: number | null;
    productName: string; expiresAt: number;
};

type ApiResult<T> = {code?: string; info?: string; data?: T};

const pendingPaymentKey = 'llm-market-pending-payment';
const pendingPaymentUrlKey = `${pendingPaymentKey}-url`;
const returnOrderKey = `${pendingPaymentKey}-return-order`;
const paymentStatuses: readonly PaymentStatus[] = ['CREATE', 'WAIT', 'COMPLETED', 'CLOSE'];

function isPaymentStatus(value: unknown): value is PaymentStatus {
    return typeof value === 'string' && paymentStatuses.includes(value as PaymentStatus);
}

function parseMoney(value: unknown): string | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value >= 0 ? String(value) : null;
    }
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return /^\d+(\.\d{1,8})?$/.test(normalized) ? normalized : null;
}

function formatCny(value: string | number | null): string {
    return value === null ? '—' : formatBalance(String(value));
}

function parsePayment(value: unknown): Payment | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Record<string, unknown>;
    const orderId = candidate.orderId;
    const status = candidate.status;
    const productName = candidate.productName;
    const amount = Number(candidate.amount);
    const rawCreditAmount = candidate.creditAmount;
    const creditAmount = rawCreditAmount === null || rawCreditAmount === undefined
        ? null
        : parseMoney(rawCreditAmount);
    const rawQuota = candidate.quota;
    const quota = rawQuota === null || rawQuota === undefined || rawQuota === '' ? null : Number(rawQuota);
    const expiresAt = Number(candidate.expiresAt);
    if (typeof orderId !== 'string' || !orderId || !isPaymentStatus(status) ||
        typeof productName !== 'string' || !productName ||
        !Number.isFinite(amount) ||
        (creditAmount === null && rawCreditAmount !== null && rawCreditAmount !== undefined) ||
        (quota !== null && !Number.isFinite(quota)) || (creditAmount === null && quota === null) ||
        !Number.isFinite(expiresAt)) return null;
    const payUrl = typeof candidate.payUrl === 'string' && candidate.payUrl.trim() ? candidate.payUrl : undefined;
    return {
        orderId, status, amount, creditAmount, quota, productName, expiresAt,
        ...(payUrl ? {payUrl} : {}),
    };
}

function validateCheckoutUrl(url?: string): {href?: string; error?: string} {
    if (!url?.trim()) return {error: '支付地址尚未生成，请重新查询订单'};
    let target: URL;
    try {
        target = new URL(url.trim());
    } catch {
        return {error: '支付地址格式异常，已阻止跳转'};
    }
    if (target.protocol !== 'https:' || target.hostname !== 'openapi-sandbox.dl.alipaydev.com') {
        return {error: '支付地址异常，已阻止跳转'};
    }
    return {href: target.toString()};
}

function mergePayment(previous: Payment | null, snapshot: Payment): Payment {
    if (previous?.orderId !== snapshot.orderId) return snapshot;
    return {...previous, ...snapshot, payUrl: snapshot.payUrl ?? previous.payUrl};
}

function normalizeOrderId(value: string | null): string | null {
    if (!value || !/^\d{12}$/.test(value)) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) && Number.isSafeInteger(numeric) ? value : null;
}

function returnOrderIdFromSearch(search: string): string | null {
    return normalizeOrderId(new URLSearchParams(search).get('out_trade_no'));
}

function persistPendingPayment(payment: Payment): boolean {
    try {
        const {payUrl, ...safePayment} = payment;
        localStorage.setItem(pendingPaymentKey, JSON.stringify(safePayment));
        if (payUrl) sessionStorage.setItem(pendingPaymentUrlKey, payUrl);
        else sessionStorage.removeItem(pendingPaymentUrlKey);
        return true;
    } catch {
        return false;
    }
}

function readPendingPayment(): Payment | null {
    const saved = localStorage.getItem(pendingPaymentKey);
    if (!saved) return null;
    const stored = JSON.parse(saved) as Record<string, unknown>;
    const payUrl = sessionStorage.getItem(pendingPaymentUrlKey);
    return parsePayment(payUrl ? {...stored, payUrl} : stored);
}

function clearPendingPayment() {
    try { localStorage.removeItem(pendingPaymentKey); } catch { /* storage unavailable */ }
    try { sessionStorage.removeItem(pendingPaymentUrlKey); } catch { /* storage unavailable */ }
}

function clearCompletedPayment(orderId: string) {
    try {
        if (readPendingPayment()?.orderId === orderId) clearPendingPayment();
    } catch { clearPendingPayment(); }
    try {
        if (sessionStorage.getItem(returnOrderKey) === orderId) sessionStorage.removeItem(returnOrderKey);
    } catch { /* storage unavailable */ }
}

async function readApiResult<T>(request: Promise<Response>, fallback: string): Promise<ApiResult<T>> {
    let response: Response;
    try {
        response = await request;
    } catch (error) {
        if (error instanceof DOMException && error.name === 'TimeoutError') {
            throw new Error('请求超时，请稍后重试');
        }
        throw new Error('网络连接失败，请稍后重试');
    }
    if (!response.ok) throw new Error(`服务暂不可用（HTTP ${response.status}）`);
    try {
        return await response.json() as ApiResult<T>;
    } catch {
        throw new Error(`${fallback}：服务返回格式无效`);
    }
}

export function Sale() {
    const [products, setProducts] = useState<SaleProduct[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<number | null>(null);
    const [error, setError] = useState('');
    const [payment, setPayment] = useState<Payment | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [checking, setChecking] = useState(false);
    const [checkError, setCheckError] = useState('');
    const [checkoutError, setCheckoutError] = useState('');
    const [walletBalance, setWalletBalance] = useState<string | null>(null);
    const [legacyQuota, setLegacyQuota] = useState<number | null>(null);
    const [balanceRefreshing, setBalanceRefreshing] = useState(false);
    const pollBusy = useRef(false);
    const balanceRequestBusy = useRef(false);
    const recoveryAttemptedOrder = useRef<string | null>(null);
    const dismissedOrder = useRef<string | null>(null);
    const location = useLocation();
    const navigate = useNavigate();

    const loadProducts = async () => {
        setLoading(true);
        setError('');
        try {
            const result = await readApiResult<SaleProduct[]>(queryProductList(), '套餐加载失败');
            if (result.code === SaleProductEnum.NeedLogin) { useAccessStore.getState().goToLogin(); return; }
            if (result.code !== SaleProductEnum.SUCCESS) throw new Error(result.info || '套餐加载失败');
            if (!Array.isArray(result.data)) throw new Error('套餐数据格式无效');
            setProducts(result.data);
        } catch (e) { setError(e instanceof Error ? e.message : '套餐加载失败'); }
        finally { setLoading(false); }
    };

    const refreshBalance = async () => {
        if (balanceRequestBusy.current) return;
        balanceRequestBusy.current = true;
        setBalanceRefreshing(true);
        try {
            const result = await readApiResult<AccountBalance>(queryAccountBalance(), '余额刷新失败');
            if (result.code === SaleProductEnum.NeedLogin) {
                useAccessStore.getState().goToLogin();
                return;
            }
            if (result.code !== SaleProductEnum.SUCCESS) throw new Error(result.info || '余额刷新失败');
            const availableAmount = result.data?.availableAmount;
            if (typeof availableAmount !== 'string' || formatCny(availableAmount) === '—') {
                throw new Error('余额数据格式无效');
            }
            const returnedLegacyQuota = result.data?.legacyQuota;
            if (returnedLegacyQuota !== undefined && returnedLegacyQuota !== null &&
                (!Number.isInteger(returnedLegacyQuota) || returnedLegacyQuota < 0)) {
                throw new Error('历史额度数据格式无效');
            }
            setWalletBalance(availableAmount);
            setLegacyQuota(returnedLegacyQuota ?? null);
        } finally {
            balanceRequestBusy.current = false;
            setBalanceRefreshing(false);
        }
    };

    const recoverReturnOrder = async (orderId: string) => {
        try {
            const result = await readApiResult<unknown>(queryPayOrder(orderId), '支付结果确认中');
            if (result.code === SaleProductEnum.NeedLogin) { useAccessStore.getState().goToLogin(); return; }
            if (result.code !== SaleProductEnum.SUCCESS) throw new Error(result.info || '支付结果确认中');
            const snapshot = parsePayment(result.data);
            if (!snapshot || snapshot.orderId !== orderId) throw new Error('支付结果格式无效，请稍后重试');
            if (dismissedOrder.current === orderId) return;
            let previous: Payment | null = null;
            try { previous = readPendingPayment(); } catch { /* ignore stale storage */ }
            const recovered = mergePayment(previous, snapshot);
            setPayment(recovered);
            setShowModal(true);
            setError('');
            setCheckError('');
            if (snapshot.status === 'CLOSE' || snapshot.status === 'COMPLETED') {
                clearCompletedPayment(orderId);
            } else {
                persistPendingPayment(recovered);
            }
            if (snapshot.status === 'COMPLETED') await refreshBalance();
        } catch (e) {
            const message = e instanceof Error ? e.message : '网络异常，请稍后确认，不要重复付款';
            setError(message);
            setCheckError(message);
        }
    };

    const checkPayment = async (id: string) => {
        if (pollBusy.current) return;
        pollBusy.current = true;
        setChecking(true);
        try {
            const result = await readApiResult<unknown>(queryPayOrder(id), '支付结果确认中');
            if (result.code === SaleProductEnum.NeedLogin) { useAccessStore.getState().goToLogin(); return; }
            if (result.code !== SaleProductEnum.SUCCESS) throw new Error(result.info || '支付结果确认中');
            const snapshot = parsePayment(result.data);
            if (!snapshot || snapshot.orderId !== id) throw new Error('支付结果格式无效，请稍后重试');
            setPayment(previous => mergePayment(previous, snapshot));
            setCheckError('');
            if (snapshot.status === 'COMPLETED' || snapshot.status === 'CLOSE') {
                clearCompletedPayment(id);
            }
            if (snapshot.status === 'COMPLETED') {
                await refreshBalance();
            }
        } catch (e) { setCheckError(e instanceof Error ? e.message : '网络异常，请稍后确认，不要重复付款'); }
        finally { pollBusy.current = false; setChecking(false); }
    };

    const payOrder = async (productId: number) => {
        if (busy !== null) return;
        setBusy(productId);
        setError('');
        try {
            const result = await readApiResult<unknown>(createPayOrder(productId), '下单失败');
            if (result.code === SaleProductEnum.NeedLogin) { useAccessStore.getState().goToLogin(); return; }
            if (result.code !== SaleProductEnum.SUCCESS) throw new Error(result.info || '下单失败');
            const createdPayment = parsePayment(result.data);
            if (!createdPayment) throw new Error('下单响应格式无效，请稍后重试');
            setPayment(createdPayment);
            const saved = persistPendingPayment(createdPayment);
            setCheckoutError('');
            if (createdPayment.payUrl && saved) setCheckError('');
            else if (createdPayment.payUrl) setCheckError('订单已创建，但无法保存待支付记录，请保留订单号并避免重复下单');
            else setCheckError('订单已创建，但支付地址暂未生成，请稍后重试');
            setShowModal(true);
        } catch (e) { setError(e instanceof Error ? e.message : '下单失败'); }
        finally { setBusy(null); }
    };

    useEffect(() => {
        void loadProducts();
        void refreshBalance().catch(e => setError(e instanceof Error ? e.message : '余额加载失败'));
        try {
            if (localStorage.getItem(pendingPaymentKey)) {
                const storedPayment = readPendingPayment();
                if (storedPayment) { setPayment(storedPayment); setShowModal(true); }
                else { clearPendingPayment(); setError('待支付订单信息已失效，请重新下单'); }
            }
        } catch { clearPendingPayment(); setError('待支付订单信息读取失败，请重新下单'); }
    }, []);

    useEffect(() => {
        const capturedOrderId = returnOrderIdFromSearch(location.search);
        if (location.search && !capturedOrderId) {
            setError('支付宝订单号格式无效，未恢复订单');
            navigate({pathname: location.pathname, search: ''}, {replace: true});
            return;
        }
        let orderId = capturedOrderId;
        if (!orderId) {
            try { orderId = normalizeOrderId(sessionStorage.getItem(returnOrderKey)); } catch { orderId = null; }
        }
        if (!orderId || recoveryAttemptedOrder.current === orderId) return;
        recoveryAttemptedOrder.current = orderId;
        try { sessionStorage.setItem(returnOrderKey, orderId); } catch { /* storage unavailable */ }
        if (capturedOrderId) navigate({pathname: location.pathname, search: ''}, {replace: true});
        void recoverReturnOrder(orderId);
    }, [location.pathname, location.search]);

    useEffect(() => {
        if (!showModal || !payment || ['COMPLETED', 'CLOSE'].includes(payment.status)) return;
        const id = payment.orderId;
        void checkPayment(id);
        const interval = window.setInterval(() => { void checkPayment(id); }, 4000);
        return () => window.clearInterval(interval);
    }, [showModal, payment?.orderId, payment?.status]);

    useEffect(() => {
        if (payment?.status !== 'COMPLETED') return;
        void refreshBalance().catch(e => setCheckError(e instanceof Error ? e.message : '余额刷新失败'));
    }, [payment?.orderId, payment?.status]);

    const complete = payment?.status === 'COMPLETED';
    const closed = payment?.status === 'CLOSE';
    const expired = !!payment && Date.now() >= payment.expiresAt;
    const checkout = payment && !complete && !closed ? validateCheckoutUrl(payment.payUrl) : null;

    const dismissPayment = () => {
        setShowModal(false);
        if (!payment) return;
        dismissedOrder.current = payment.orderId;
        if (complete || closed) {
            clearCompletedPayment(payment.orderId);
            setPayment(null);
        }
    };

    return <section className={styles.sale}>
        <header className={styles.heading}>
            <div><span className={styles.eyebrow}>个人中心</span><h1>余额充值</h1></div>
            <span className={styles.sandbox}>沙箱测试 · 不涉及真实扣款</span>
        </header>
        <div className={styles.channels}>
            <Radio.Group value="alipay" aria-label="支付方式">
                <Radio.Button value="alipay"><AlipayCircleOutlined /> 支付宝沙箱</Radio.Button>
                <Radio.Button value="wechat" disabled><WechatOutlined /> 微信支付 · 暂未开通</Radio.Button>
            </Radio.Group>
            <Button type="text" icon={<ReloadOutlined />} title="刷新套餐" aria-label="刷新套餐" onClick={loadProducts}/>
        </div>
        {error && <Alert type="error" showIcon message={error} className={styles.notice}/>}
        <div className={styles.balanceSummary} aria-label="账户余额">
            <div><span>钱包余额</span><strong>{walletBalance === null ? '—' : formatCny(walletBalance)}</strong></div>
            <div><span>历史剩余额度</span><strong>{legacyQuota === null ? '—' : `${legacyQuota} 次`}</strong></div>
            <Button type="text" icon={<ReloadOutlined spin={balanceRefreshing}/>} title="刷新余额" aria-label="刷新余额"
                    onClick={() => void refreshBalance().catch(e => setError(e instanceof Error ? e.message : '余额加载失败'))}
                    disabled={balanceRefreshing}/>
        </div>
        {loading ? <div className={styles.loading}><Spin/></div> :
            products.length === 0 ? <Empty description="暂无可购买套餐"/> :
                <div className={styles.products}>{products.map(product =>
                    <article key={product.productId} className={styles.product}>
                        <CreditCardOutlined className={styles.productIcon}/>
                        <h2>{product.productName}</h2>
                        <div className={styles.creditAmount}>到账余额 <strong>{formatCny(product.creditAmount)}</strong></div>
                        <p>{product.productDesc}</p>
                        <div className={styles.price}>支付 {formatCny(product.price)}</div>
                        <Button type="primary" block icon={<AlipayCircleOutlined/>}
                                loading={busy === product.productId} disabled={busy !== null && busy !== product.productId}
                                onClick={() => payOrder(product.productId)}>支付 {formatCny(product.price)}</Button>
                    </article>
                )}</div>}
        {payment && !showModal && !complete && !closed &&
            <Button className={styles.pending} onClick={() => setShowModal(true)}>查看待支付订单 {payment.orderId}</Button>}
        <Modal title={complete ? (payment?.creditAmount === null ? '历史额度已到账' : '余额已到账') : closed ? '订单已关闭' : '支付宝沙箱支付'}
               open={showModal} onCancel={dismissPayment} footer={null} width={460}>
            {payment && <div className={styles.checkout}>
                {complete && <CheckCircleFilled className={styles.success}/>}
                <h2>{payment.productName}</h2>
                <div className={styles.checkoutAmount}>支付 {formatCny(payment.amount)}</div>
                <dl><dt>订单编号</dt><dd>{payment.orderId}</dd>
                    <dt>{payment.creditAmount === null ? '历史对话额度' : '到账余额'}</dt>
                    <dd>{payment.creditAmount === null ? `${payment.quota} 次` : formatCny(payment.creditAmount)}</dd>
                    {complete && <><dt>钱包余额</dt><dd>{walletBalance === null ? '刷新中…' : formatCny(walletBalance)}</dd></>}
                    <dt>当前状态</dt><dd>{complete ? '已支付 · 已到账' : closed ? '已关闭' : payment.status === 'WAIT' ? '已支付 · 到账处理中' : '等待付款'}</dd></dl>
                {checkError && <Alert showIcon type="warning" message={checkError}/>}
                {checkoutError && <Alert showIcon type="warning" message={checkoutError}/>}
                {complete ? <>
                    <Button type="primary" block onClick={() => { dismissPayment(); navigate('/chat'); }}>开始对话</Button>
                    <Button block onClick={dismissPayment}>返回商城</Button>
                    {walletBalance === null && <Button block icon={<ReloadOutlined/>} loading={balanceRefreshing}
                                                       onClick={() => void refreshBalance().catch(e => setCheckError(e instanceof Error ? e.message : '余额刷新失败'))}>刷新余额</Button>}
                </> :
                    closed ? <Button block onClick={dismissPayment}>返回商城</Button> : <>
                        {expired ? <Alert type="info" message="订单已过支付期限，正在确认最终状态"/> :
                            <Button type="primary" size="large" block icon={<AlipayCircleOutlined/>}
                                    href={checkout?.href} target={checkout?.href ? '_blank' : undefined}
                                    rel={checkout?.href ? 'noopener noreferrer' : undefined}
                                    onClick={event => {
                                        if (!checkout?.href) {
                                            event.preventDefault();
                                            setCheckoutError(checkout?.error || '支付地址异常，已阻止跳转');
                                        } else setCheckoutError('');
                                    }}>前往支付宝沙箱收银台</Button>}
                        <Button block icon={<ReloadOutlined/>} loading={checking}
                                onClick={() => checkPayment(payment.orderId)}>查询支付结果</Button>
                        <p className={styles.hint}>仅限沙箱买家账号，订单有效期 30 分钟。</p>
                    </>}
            </div>}
        </Modal>
    </section>;
}

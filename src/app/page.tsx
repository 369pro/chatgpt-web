import { NextPage } from 'next';
import dynamic from 'next/dynamic';
import {redirect} from 'next/navigation';
import {normalizePaymentOrderId} from './payment/return-url';
import {AppLoading} from './components/app-loading';

const AdminApp = dynamic(() => import('@/app/components/admin/AdminApp'), {
    ssr: false,
    loading: () => <AppLoading/>,
});

type RootPageProps = {
    searchParams?: {out_trade_no?: string | string[]};
};

const Admin: NextPage<RootPageProps> = ({searchParams}) => {
    const rawOrderId = searchParams?.out_trade_no;
    if (rawOrderId !== undefined) {
        const orderId = typeof rawOrderId === 'string' ? normalizePaymentOrderId(rawOrderId) : null;
        redirect(orderId ? `/payment/return?out_trade_no=${orderId}` : '/payment/return');
    }
    return <AdminApp />;
};

export default Admin;

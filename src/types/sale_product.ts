export interface SaleProduct {
    productId: number,
    productName: string,
    productDesc: string,
    creditAmount: string | number,
    price: string | number,
    feeRate?: string | number | null,
    feeAmount?: string | number | null,
    quota?: number | null,
}

export enum SaleProductEnum {
    SUCCESS = "0000",
    NeedLogin = "0003",
}

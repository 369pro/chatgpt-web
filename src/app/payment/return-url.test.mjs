import assert from 'node:assert/strict';
import test from 'node:test';
import {
    hasPaymentOrderQuery,
    isPaymentResumeTarget,
    normalizePaymentOrderId,
    paymentOrderIdFromHash,
    paymentOrderIdFromSearch,
    saleHashUrlForPaymentReturn,
} from './return-url.ts';

test('accepts an exact twelve digit payment order number', () => {
    assert.equal(normalizePaymentOrderId('425761194335'), '425761194335');
    assert.equal(paymentOrderIdFromSearch('?out_trade_no=425761194335'), '425761194335');
});

test('rejects missing, malformed, and ambiguous payment order numbers', () => {
    assert.equal(normalizePaymentOrderId(null), null);
    assert.equal(normalizePaymentOrderId('42576119433'), null);
    assert.equal(normalizePaymentOrderId('425761194335x'), null);
    assert.equal(paymentOrderIdFromSearch(''), null);
    assert.equal(paymentOrderIdFromHash('#/sale?out_trade_no=425761194335'), '425761194335');
    assert.equal(isPaymentResumeTarget('#/market'), true);
    assert.equal(isPaymentResumeTarget('#/sale?out_trade_no=425761194335'), false);
    assert.equal(paymentOrderIdFromSearch('?out_trade_no=425761194335&out_trade_no=425761194336'), null);
    assert.equal(hasPaymentOrderQuery('?out_trade_no='), true);
});

test('builds the hash route consumed by the sale page', () => {
    assert.equal(saleHashUrlForPaymentReturn('425761194335'), '/#/sale?out_trade_no=425761194335');
});

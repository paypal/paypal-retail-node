var assert = require('assert'),
    paypal = require('../');

describe('', function () {

    it('should fail with a bad config', function () {
        try {
            paypal.configure(paypal.LIVE, {});
            assert.fail('Expected exception.');
        } catch (x) { }
        try {
            paypal.configure(paypal.LIVE, {clientId:'foo'});
            assert.fail('Expected exception.');
        } catch (x) { }
        try {
            paypal.configure(paypal.LIVE, {clientId:'foo', secret: 'bar'});
            assert.fail('Expected exception.');
        } catch (x) { }
        try {
            paypal.configure(paypal.LIVE, {clientId:'foo', secret: 'bar', returnUrl: 'baz'});
            assert.fail('Expected exception.');
        } catch (x) { console.log(x); }
    });

    it('should not fail with a good config', function () {
        paypal.configure(paypal.LIVE, {clientId: 'foo', secret: 'bar', returnUrl: 'baz', refreshUrl: 'boo'});
    });
});

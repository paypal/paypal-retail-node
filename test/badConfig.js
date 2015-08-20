var assert = require('assert'),
    paypal = require('../');

describe('', function () {

    it('should fail with a bad config', function () {
        try {
            paypal.configure(paypal.LIVE, {});
            assert.fail('Expected exception.');
        } catch (x) {
        }
        try {
            paypal.configure(paypal.LIVE, {clientId: 'foo'});
            assert.fail('Expected exception.');
        } catch (x) {
        }
        try {
            paypal.configure(paypal.LIVE, {clientId: 'foo', secret: 'bar'});
            assert.fail('Expected exception.');
        } catch (x) {
        }
        try {
            paypal.configure(paypal.LIVE, {clientId: 'foo', secret: 'bar', returnUrl: 'baz'});
            assert.fail('Expected exception.');
        } catch (x) {
            console.log(x);
        }
    });

    it('should not fail with a good config', function () {
        paypal.configure(paypal.LIVE, {clientId: 'foo', secret: 'bar', returnUrl: 'baz', refreshUrl: 'boo'});
    });

    it('should not fail with a dynamic config', function () {
        // This is mostly here to show you how to make a custom env token
        var config = {
            name: 'stage2d0020',
            clientId: 'HereSDKPOS',
            secret: 'HereSDKPOS',
            returnUrl: 'http://localhost:8080/returnFromPayPal',
            refreshUrl: 'http://localhost:8080/refresh'
        };
        var ppCustomToken = new Buffer(JSON.stringify(config)).toString('base64');
        console.log(ppCustomToken);
        paypal.configure(config.name, config);
    });
});

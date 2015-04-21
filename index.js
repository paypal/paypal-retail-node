var wreck = require('wreck'),
    util = require('util'),
    crypto = require('crypto');

var configs = {};

module.exports = {
    configure: function configure(environment, options) {
        if (!options.clientId) {
            throw new Error('Missing clientId for PayPal environment "'+environment+'"');
        }
        if (!options.secret) {
            throw new Error('Missing secret for PayPal environment "'+environment+'"');
        }
        if (!options.returnUrl) {
            throw new Error('Missing returnUrl for PayPal environment "'+environment+'"');
        }
        if (!options.refreshUrl) {
            throw new Error('Missing refreshUrl for PayPal environment "'+environment+'"');
        }
        if (!options.scopes) {
            options.scopes = 'openid https://uri.paypal.com/services/paypalhere https://api.paypal.com/v1/payments/.* https://uri.paypal.com/services/paypalattributes/business';
        }
        configs[environment] = options;
    },
    redirect: function (env, finalUrl) {
        var cfg = configs[env];
        if (!cfg) {
            throw new Error('Invalid environment ' + encodeURIComponent(env));
        }
        if (env == module.exports.SANDBOX) {
            return util.format('https://www.sandbox.paypal.com/webapps/auth/protocol/openidconnect/v1/authorize?response_type=code&client_id=%s&scope=%s&redirect_uri=%s&state=%s',
                encodeURIComponent(cfg.clientId), encodeURIComponent(cfg.scopes), encodeURIComponent(cfg.returnUrl),
                encodeURIComponent(JSON.stringify([env,finalUrl])));
        } else if (env.indexOf('stage2') === 0) {
            return util.format('https://www.%s.paypal.com/webapps/auth/protocol/openidconnect/v1/authorize?response_type=code&client_id=%s&scope=%s&redirect_uri=%s&state=%s',
                env, encodeURIComponent(cfg.clientId), encodeURIComponent(cfg.scopes), encodeURIComponent(cfg.returnUrl),
                encodeURIComponent(JSON.stringify([env,finalUrl])));
        } else {
            return util.format('https://www.paypal.com/webapps/auth/protocol/openidconnect/v1/authorize?response_type=code&client_id=%s&scope=%s&redirect_uri=%s&state=%s',
                encodeURIComponent(cfg.clientId), encodeURIComponent(cfg.scopes), encodeURIComponent(cfg.returnUrl),
                encodeURIComponent(JSON.stringify([env,finalUrl])));
        }
    },
    refresh: function (query, app_secure_identifier, callback) {
        if (!query.token) {
            throw new Error('Refresh token is missing from request.');
        }
        decrypt(query.token, app_secure_identifier, function (e, plain) {
            if (e) {
                console.error(e.message, e.stack);
                return callback(new Error('Invalid refresh token presented.'));
            }
            try {
                // [0] = environment, [1] = raw refresh token
                var info = JSON.parse(plain);
                var url = tsUrl(info[0]);
                var cfg = configs[info[0]];
                if (!cfg) {
                    return callback(new Error('Invalid environment ' + encodeURIComponent(info[0])));
                }
                wreck.post(url, {
                    payload: util.format('grant_type&refresh_token&refresh_token=%s', encodeURIComponent(info[1])),
                    json: 'force',
                    headers: {
                        'Authorization': 'Basic ' + new Buffer(cfg.clientId + ':' + cfg.secret).toString('base64'),
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }, function (err, rz, payload) {
                    console.log(payload);
                    callback(null, 'foo');
                });
            } catch (x) {
                return callback(new Error('Invalid refresh token presented.'));
            }
        });
    },
    completeAuthentication: function (query, app_secure_identifier, callback) {
        if (!app_secure_identifier) {
            throw new Error('app_secure_identifier parameter is required to complete authentication.');
        }
        if (!callback || typeof(callback) !== 'function') {
            throw new Error('completeAuthentication requires a callback parameter that is a function.');
        }
        var state = JSON.parse(query.state);
        if (!state || state.length < 2) {
            throw new Error('The "state" parameter is invalid when trying to complete PayPal authentication.');
        }
        var env = state[0];
        var url = tsUrl(env);
        var cfg = configs[env];
        wreck.post(url, {
            payload: util.format('grant_type=authorization_code&code=%s&redirect_uri=%s', encodeURIComponent(query.code), encodeURIComponent(cfg.returnUrl)),
            json: 'force',
            headers: {
                'Authorization': 'Basic ' + new Buffer(cfg.clientId + ':' + cfg.secret).toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }, function (err, rz, payload) {
            if (err) {
                return callback(err);
            }
            if (payload.error) {
                return callback(new Error(payload.error + ' ' + payload.error_description));
            }
            var returnUrl = state[1] + (state[1].indexOf('?')>=0 ? '&':'?') + "sdk_token=";
            var refreshUrl = cfg.refreshUrl + (cfg.refreshUrl.indexOf('?')>=0 ? '&':'?');
            encrypt(JSON.stringify([env, payload.refresh_token]), app_secure_identifier, function encryptionDone (e,v) {
                if (e) {
                    return callback(e);
                }
                var tokenInformation = [
                    env,
                    payload.access_token,
                    payload.expires_in,
                    refreshUrl + '&token=' + encodeURIComponent(v)
                ];

                returnUrl += new Buffer(JSON.stringify(tokenInformation)).toString('base64');
                console.log('ReturnUrl', returnUrl);
                callback(null, returnUrl);
            });
        });
    },
    /* Predefined environments. You can also pass values given to you by PayPal folks for our stage servers. */
    LIVE: 'live',
    SANDBOX: 'sandbox'
};

function tsUrl(env) {
    var url = 'https://api.paypal.com/v1/identity/openidconnect/tokenservice';
    if (env == module.exports.SANDBOX) {
        url = 'https://api.sandbox.paypal.com/v1/identity/openidconnect/tokenservice';
    } else if (env.indexOf('stage2') === 0) {
        url = util.format('https://www.%s.stage.paypal.com:12714/v1/identity/openidconnect/tokenservice', env);
    }
    return url;
}


function encrypt(plainText, password, cb) {
    var salt = new Buffer(crypto.randomBytes(16), 'binary');
    var iv = new Buffer(crypto.randomBytes(16), 'binary');

    crypto.pbkdf2(password, salt, 1000, 32, function (err, key) {
        if (err) {
            logger.error('Failed to generate key.', err);
            cb(err, null);
            return;
        }

        var cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        var buffer = new Buffer(cipher.update(plainText, 'utf8', 'binary'), 'binary');
        buffer = Buffer.concat([buffer, new Buffer(cipher.final('binary'), 'binary')]);

        var hashKey = crypto.createHash('sha1').update(key).digest('binary');
        var hmac = new Buffer(crypto.createHmac('sha1', hashKey).update(buffer).digest('binary'), 'binary');

        buffer = Buffer.concat([salt, iv, hmac, buffer]);
        cb(null, buffer.toString('base64'));
    });
}

function decrypt(cipherText, password, cb) {
    var cipher = new Buffer(cipherText, 'base64');

    var salt = cipher.slice(0, 16);
    var iv = cipher.slice(16, 32);
    var hmac = cipher.slice(32, 52);
    cipherText = cipher.slice(52);

    crypto.pbkdf2(password, salt, 1000, 32, function (err, key) {
        if (err) {
            logger.error('Failed to generate key.', err);
            cb(err, null);
            return;
        }
        var cipher = crypto.createDecipheriv('aes-256-cbc', key, iv);

        // Verify the HMAC first
        var hashKey = crypto.createHash('sha1').update(key).digest('binary');
        var hmacgen = new Buffer(crypto.createHmac('sha1', hashKey).update(cipherText).digest('binary'), 'binary');
        if (hmacgen.toString('base64') !== hmac.toString('base64')) {
            cb(new Error('HMAC Mismatch!'), null);
            return;
        }
        var buffer = new Buffer(cipher.update(cipherText), 'binary');
        buffer = Buffer.concat([buffer, new Buffer(cipher.final('binary'))]);
        cb(null, buffer.toString('utf8'), key);
    });
}
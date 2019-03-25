var wreck = require('wreck'),
    util = require('util'),
    crypto = require('crypto');

var configs = {};

module.exports = {
    /**
     * Create a new environment with the given configuration
     * @param environment The name of the PayPal environment
     * @param options An object with clientId, secret, [returnUrl], [refreshUrl], [scopes] keys (braced values are optional)
     */
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
            options.scopes = 'openid email profile address https://uri.paypal.com/services/paypalhere https://uri.paypal.com/services/paypalattributes/business';
        }
        configs[environment] = options;
    },
    /**
     * Retrieve the scopes enabled for this application from the PayPal servers.
     * @param env The name of the previously-configured PayPal environment
     * @param callback (error, scopeArray)
     */
    queryAvailableScopes: function (env, callback) {
        var cfg = configs[env];
        if (!cfg) {
            throw new Error('Invalid environment ' + encodeURIComponent(env));
        }
        wreck.post(oauthUrl(env), {
            payload: 'grant_type=client_credentials&return_client_metadata=true',
            json: 'force',
            headers: {
                'Authorization': 'Basic ' + new Buffer(cfg.clientId + ':').toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-IDENTITY-ROUTE-TO': 'APS'
            }
        }, function (err, rz, payload) {
            if (!err && payload && payload.client_metadata) {
                payload = payload.client_metadata.scopes;
                // As a bonus, we'll return an error if one of the scopes you are configured to request is
                // not available.
                if (!payload) {
                    err = new Error('PayPal services did not return scopes for your application.');
                }
                var requiredScopes = cfg.scopes.split(' '), missing = [];
                for (var si = 0; si < requiredScopes.length; si++) {
                    if (payload.indexOf(requiredScopes[si]) < 0) {
                        missing.push(requiredScopes[si]);
                    }
                }
                if (missing.length) {
                    err = new Error('Your application is missing the following required scopes: ' + missing.join(' '));
                    err.missing = missing;
                    err.required = requiredScopes;
                }
            } else if (!err) {
                err = new Error('Invalid response received from PayPal services.');
            }
            if (err) {
                err.response = payload;
            }
            callback(err, payload);
        });
    },
    /**
     * Build the URL to which the customer browser should be sent to login to PayPal and provide consent to your
     * application.
     * @param env The name of the previously-configured PayPal environment
     * @param finalUrl The URL the customer browser should be sent to when auth/consent is complete
     * @param returnTokenOnQueryString true if you want raw token information on the query string rather than an "SDK token"
     * @returns url to send the browser
     */
    redirect: function (env, finalUrl, returnTokenOnQueryString) {
        var cfg = configs[env];
        if (!cfg) {
            throw new Error('Invalid environment ' + encodeURIComponent(env));
        }
        if (env == module.exports.SANDBOX) {
            return util.format('https://www.sandbox.paypal.com/signin/authorize?response_type=code&client_id=%s&scope=%s&redirect_uri=%s&state=%s',
                encodeURIComponent(cfg.clientId), encodeURIComponent(cfg.scopes), encodeURIComponent(cfg.returnUrl),
                encodeURIComponent(JSON.stringify([env,finalUrl,!!returnTokenOnQueryString])));
        } else if (env.indexOf('stage2') === 0) {
            return util.format('https://www.%s.stage.paypal.com/signin/authorize?response_type=code&client_id=%s&scope=%s&redirect_uri=%s&state=%s',
                env, encodeURIComponent(cfg.clientId), encodeURIComponent(cfg.scopes), encodeURIComponent(cfg.returnUrl),
                encodeURIComponent(JSON.stringify([env,finalUrl,!!returnTokenOnQueryString])));
        } else {
            return util.format('https://www.paypal.com/signin/authorize?response_type=code&client_id=%s&scope=%s&redirect_uri=%s&state=%s',
                encodeURIComponent(cfg.clientId), encodeURIComponent(cfg.scopes), encodeURIComponent(cfg.returnUrl),
                encodeURIComponent(JSON.stringify([env,finalUrl,!!returnTokenOnQueryString])));
        }
    },
    /**
     * Retrieve a new access token for the customer that was originally given a 'refresh url' that had an
     * encrypted version of their refresh token on it (encrypted using the app_secure_identifier)
     * @param query The query string arguments (usually straight from Express.JS)
     * @param app_secure_identifier Your server encryption secret
     * @param callback (error,newToken) called when refresh completes
     */
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
                    payload: util.format('grant_type=refresh_token&refresh_token=%s', encodeURIComponent(info[1])),
                    json: 'force',
                    headers: {
                        'Authorization': 'Basic ' + new Buffer(cfg.clientId + ':' + cfg.secret).toString('base64'),
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }, function (err, rz, payload) {
                    callback(err, payload);
                });
            } catch (x) {
                return callback(new Error('Invalid refresh token presented.'));
            }
        });
    },
    /**
     * After the customer returns from the URL specified in redirect(), this method will complete the process
     * and generate an access token and refresh URL
     * @param query The query string arguments (usually straight from Express.JS)
     * @param app_secure_identifier Your server encryption secret
     * @param callback (error, tokenInfo) Called with the access token and refresh url in the tokenInfo object
     */
    completeAuthentication: function (query, app_secure_identifier, callback) {
        if (!app_secure_identifier) {
            throw new Error('app_secure_identifier parameter is required to complete authentication.');
        }
        if (!callback || typeof(callback) !== 'function') {
            throw new Error('completeAuthentication requires a callback parameter that is a function.');
        }
        if (query.error) {
            return callback(new Error(util.format('Login with PayPal Error! %s: %s', query.error, query.error_description)));
        }
        var state = JSON.parse(query.state);
        if (!state || state.length < 2) {
            throw new Error('The "state" parameter is invalid when trying to complete PayPal authentication.');
        }
        var env = state[0];
        var returnTokenOnQueryString = state.length > 2 ? (!!state[2]) : false;
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
                err.env = env;
                return callback(err);
            }
            if (payload.error) {
                var appError = new Error(payload.error + ' ' + payload.error_description);
                appError.env = env;
                return callback(appError);
            }
            var returnUrl = state[1] + (state[1].indexOf('?')>=0 ? '&':'?');
            if (!returnTokenOnQueryString) {
                returnUrl += "sdk_token=";
            }
            var refreshUrl = cfg.refreshUrl + (cfg.refreshUrl.indexOf('?')>=0 ? '&':'?');
            encrypt(JSON.stringify([env, payload.refresh_token]), app_secure_identifier, function encryptionDone (e,v) {
                if (e) {
                    e.env = env;
                    return callback(e);
                }
                var tokenInformation = [
                    payload.access_token,
                    payload.expires_in,
                    refreshUrl + '&token=' + encodeURIComponent(v)
                ];

                if (returnTokenOnQueryString) {
                    returnUrl += 'access_token=' + encodeURIComponent(tokenInformation[0]) +
                            '&expires_in=' + encodeURIComponent(tokenInformation[1]) +
                            '&refresh_url=' + encodeURIComponent(tokenInformation[2]) +
                            '&env=' + encodeURIComponent(env);
                } else {
                    returnUrl += env + ':' + encodeURIComponent(new Buffer(JSON.stringify(tokenInformation)).toString('base64'));
                }
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

function oauthUrl(env) {
    var url = 'https://api.paypal.com/v1/oauth2/token';
    if (env == module.exports.SANDBOX) {
        url = 'https://api.sandbox.paypal.com/v1/oauth2/token';
    } else if (env.indexOf('stage2') === 0) {
        url = util.format('https://www.%s.stage.paypal.com:11888/v1/oauth2/token', env);
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

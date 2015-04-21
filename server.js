var express = require('express'),
    app = express(),
    paypal = require('./');

/**
 * These are the variables we will look for in the environment, from "most important" to least
 */
// A random value used to provide additional control to disable compromised versions of your app
var APP_SECURE_IDENTIFIER = process.env.APP_SECURE_IDENTIFIER;
var PAYPAL_LIVE_CLIENTID = process.env.PAYPAL_LIVE_CLIENTID;
var PAYPAL_LIVE_SECRET = process.env.PAYPAL_LIVE_SECRET;
var PAYPAL_SANDBOX_CLIENTID = process.env.PAYPAL_SANDBOX_CLIENTID;
var PAYPAL_SANDBOX_SECRET = process.env.PAYPAL_SANDBOX_SECRET;
// The base URL by which this server can be reached on the Internet (e.g. for token refresh)
var ROOT_URL = process.env.ROOT_URL;
// For third-party use, you will want this site to redirect to your app after the login flow completes.
// This URL will receive the access_token, refresh_url, and expires_in values as query arguments.
// If you don't set this value, this server essentially becomes "first party use only" as all it can do
// is refresh tokens generated with /firstParty
var APP_REDIRECT_URL = process.env.APP_REDIRECT_URL;

var errors, warnings, hasLive, hasSandbox;

validateEnvironment();

if (!errors) {
    showStartupMessage();
}

// Pick it up from the request if it's not set, and wait to configure PayPal until we have it.
if (!ROOT_URL) {
    app.use(function (req, res, next) {
        if (!ROOT_URL) {
            ROOT_URL = req.protocol + '://' + req.get('host');
            showStartupMessage();
            configurePayPal();
        }
        next();
    });
} else {
    configurePayPal();
}

/******************************** Express Routes and Server ********************************/

if (isSetupEnabled()) {
    // Allow
    app.get('/setup/:env', allErrorsAreBelongToUs, function (req, res) {
        res.redirect(paypal.redirect(req.params.env, '/setup'));
    });
    app.get('/setup', function (req, res) {
        res.send('<html><body><H1>InitializeMerchant Token</H1><p>This token requires this server to be running so it can ' +
        'be refreshed automatically. It will work for about 8 hours before a refresh is required.</p><br/><textarea id="key" cols="100" rows="10">' +
        req.query.sdk_token +
        '</textarea><script type="text/javascript">document.getElementById("key").select();</script></body>');
    });
}

if (APP_REDIRECT_URL) {
    app.get('/toPayPal/:env', allErrorsAreBelongToUs, function (req, res) {
        res.redirect(paypal.redirect(req.params.env, APP_REDIRECT_URL));
    });
}

app.get('/returnFromPayPal', function (req, res) {
    paypal.completeAuthentication(req.query, APP_SECURE_IDENTIFIER, function (error, destinationUrl) {
        if (error) {
            console.error(util.format('Failed to handle returnFromPayPal: %s\n%s', error.message, error.stack));
            return res.status(500).send(error.message);
        }
        res.redirect(destinationUrl);
    });
});

app.get('/refresh', function (req, res) {
    paypal.refresh(req.query, APP_SECURE_IDENTIFIER, function (error, token) {
        if (error) {
            return res.status(500).send(error.message);
        }
        res.json(token);
    });
});

app.get('/', allErrorsAreBelongToUs, function (req, res) {
    var ret = '<html><body><h1>Server is Ready</h1>';
    if (isSetupEnabled()) {
        if (hasLive) {
            ret += '<a href="/setup/live">Setup a Live Account</a><br/>';
        }
        if (hasSandbox) {
            ret += '<a href="/setup/sandbox">Setup a Sandbox Account</a><br/>';
        }
    }
    ret += '</body></html>';
    res.send(ret);
});

var server = app.listen(process.env.PORT || 3000, function () {
    var host = server.address().address;
    var port = server.address().port;
    console.log('PayPal Retail SDK Service listening at http://%s:%s', host, port);
});


/******************************** The rest is just boring helpers ********************************/
function configurePayPal() {
    if (hasLive) {
        // This line adds the live configuration to the PayPal module.
        // If you're going to write your own server, this is the money line
        paypal.configure(paypal.LIVE, {
            clientId: PAYPAL_LIVE_CLIENTID,
            secret: PAYPAL_LIVE_SECRET,
            returnUrl: combineUrl(ROOT_URL, 'returnFromPayPal'),
            refreshUrl: combineUrl(ROOT_URL, 'refresh'),
            scopes: process.env.SCOPES // This is optional, we have defaults in paypal-retail-node
        });
    }
    if (hasSandbox) {
        // This line adds the sandbox configuration to the PayPal module
        paypal.configure(paypal.SANDBOX, {
            clientId: PAYPAL_SANDBOX_CLIENTID,
            secret: PAYPAL_SANDBOX_SECRET,
            returnUrl: combineUrl(ROOT_URL, 'returnFromPayPal'),
            refreshUrl: combineUrl(ROOT_URL, 'refresh'),
            scopes: process.env.SCOPES // This is optional, we have defaults in paypal-retail-node
        });
    }
}

/**
 * Environment validation and usage display
 */
function validateEnvironment() {

    /**
     * Analyze the environment and make sure things are setup properly
     */
    if (!APP_SECURE_IDENTIFIER) {
        error('The APP_SECURE_IDENTIFIER value is missing from the environment. It should be set to a reasonably long set of random characters (e.g. 32)');
    }
    if (!APP_REDIRECT_URL && !process.env.SETUP_ENABLED) {
        error('Either APP_REDIRECT_URL (for third party merchant login) or SETUP_ENABLED (for first party token generation) must be set in the environment.');
    }
    if (!PAYPAL_LIVE_CLIENTID && !PAYPAL_SANDBOX_CLIENTID) {
        error('The server must be configured for sandbox, live, or both. Neither PAYPAL_LIVE_CLIENTID or PAYPAL_SANDBOX_CLIENTID is set in the environment.');
    } else {
        if (!PAYPAL_LIVE_CLIENTID) {
            warn('The server is only configured for Sandbox.');
        } else {
            if (!PAYPAL_LIVE_SECRET) {
                error('PAYPAL_LIVE_CLIENTID is set, but PAYPAL_LIVE_SECRET is not. The app needs the client id and secret to function.');
            } else {
                hasLive = true;
            }
        }
        if (!PAYPAL_SANDBOX_CLIENTID) {
            warn('The server is only configured for live.');
        } else {
            if (!PAYPAL_SANDBOX_SECRET) {
                error('PAYPAL_SANDBOX_CLIENTID is set, but PAYPAL_SANDBOX_SECRET is not. The app needs the client id and secret to function.');
            } else {
                hasSandbox = true;
            }
        }
    }
    if (!APP_REDIRECT_URL) {
        warn('The APP_REDIRECT_URL value is missing from the environment. You will only be able to use this service to authenticate via /setup.');
    }
    if (!ROOT_URL) {
        warn('The environment variable ROOT_URL should be set to the root URL of this server, such as http://paypalservice.mybossapp.com');
    }
}

function allErrorsAreBelongToUs(req, res, next) {
    if (errors && errors.length) {
        res.send('<html><body><h1>Configuration Errors</h1><ul><li>' + errors.join('</li><li>') + '</li></pre></body>');
    } else {
        next();
    }
}

function showStartupMessage() {
    console.log('/*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-');
    if (!ROOT_URL) {
        console.log(' *\n * ROOT_URL is not set, will be set on first request.');
    } else {
        if (isSetupEnabled()) {
            console.log(' * To generate a token for your account, open the following URL in a browser:\n *');
            console.log(' *     LIVE:    ' + combineUrl(ROOT_URL || '/', 'setup/live'));
            console.log(' *     SANDBOX: ' + combineUrl(ROOT_URL || '/', 'setup/sandbox'));
        }
        if (APP_REDIRECT_URL) {
            console.log(' *\n * To begin the authentication flow in your app, open a browser or webview on the target device to:\n *');
            if (PAYPAL_LIVE_CLIENTID) {
                console.log(' *     LIVE:    ' + combineUrl(ROOT_URL || '/', 'toPayPal/live'));
            }
            if (PAYPAL_SANDBOX_CLIENTID || true) {
                console.log(' *     SANDBOX: ' + combineUrl(ROOT_URL || '/', 'toPayPal/sandbox'));
            }
            console.log(' * \n * When the flow is complete, this site will redirect to:\n * ');
            console.log(' *     ' + APP_REDIRECT_URL + (APP_REDIRECT_URL.indexOf('?') >= 0 ? '&' : '?') + 'sdk_token=[what you give to InitializeMerchant]');
            console.log(' *\n * Your return url on developer.paypal.com must be set to:\n *');
            console.log(' *     ' + combineUrl(ROOT_URL, 'returnFromPayPal') + '\n *');
        }
    }
    console.log(' *\n *-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*/');
}

function isSetupEnabled() {
    return (process.env.SETUP_ENABLED || 'false').toLowerCase() === 'true';
}

function warn(msg) {
    warnings = warnings || [];
    warnings.push(msg);
    console.log('WARNING', msg);
}

function error(msg) {
    errors = errors || [];
    errors.push(msg);
    console.error('ERROR', msg);
}

function combineUrl(base, path) {
    if (base[base.length - 1] === '/') {
        return base + path;
    }
    return base + '/' + path;
}
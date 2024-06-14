import { createHmac } from 'crypto';
import { EventEmitter } from 'events';
import { Socket } from 'net';
import { hostname } from 'os';
import { connect, createSecureContext, TLSSocket } from 'tls';
import { SMTPError, SMTPErrorStates } from './error.js';
import { SMTPResponseMonitor } from './response.js';
export const AUTH_METHODS = {
    PLAIN: 'PLAIN',
    'CRAM-MD5': 'CRAM-MD5',
    LOGIN: 'LOGIN',
    XOAUTH2: 'XOAUTH2',
};
export const SMTPState = {
    NOTCONNECTED: 0,
    CONNECTING: 1,
    CONNECTED: 2,
};
export const DEFAULT_TIMEOUT = 5000;
const SMTP_PORT = 25;
const SMTP_SSL_PORT = 465;
const SMTP_TLS_PORT = 587;
const CRLF = '\r\n';
const GREYLIST_DELAY = 300;
let DEBUG = 0;
const log = (...args) => {
    if (DEBUG === 1) {
        args.forEach((d) => console.log(typeof d === 'object'
            ? d instanceof Error
                ? d.message
                : JSON.stringify(d)
            : d));
    }
};
const caller = (callback, ...args) => {
    if (typeof callback === 'function') {
        callback(...args);
    }
};
export class SMTPConnection extends EventEmitter {
    constructor({ timeout, host, user, password, domain, port, ssl, tls, logger, authentication, } = {}) {
        var _a;
        super();
        this.timeout = DEFAULT_TIMEOUT;
        this.log = log;
        this.authentication = [
            AUTH_METHODS['CRAM-MD5'],
            AUTH_METHODS.LOGIN,
            AUTH_METHODS.PLAIN,
            AUTH_METHODS.XOAUTH2,
        ];
        this._state = SMTPState.NOTCONNECTED;
        this._secure = false;
        this.loggedin = false;
        this.sock = null;
        this.features = null;
        this.monitor = null;
        this.domain = hostname();
        this.host = 'localhost';
        this.ssl = false;
        this.tls = false;
        this.greylistResponseTracker = new WeakSet();
        if (Array.isArray(authentication)) {
            this.authentication = authentication;
        }
        if (typeof timeout === 'number') {
            this.timeout = timeout;
        }
        if (typeof domain === 'string') {
            this.domain = domain;
        }
        if (typeof host === 'string') {
            this.host = host;
        }
        if (ssl != null &&
            (typeof ssl === 'boolean' ||
                (typeof ssl === 'object' && Array.isArray(ssl) === false))) {
            this.ssl = ssl;
        }
        if (tls != null &&
            (typeof tls === 'boolean' ||
                (typeof tls === 'object' && Array.isArray(tls) === false))) {
            this.tls = tls;
        }
        this.port = port || (ssl ? SMTP_SSL_PORT : tls ? SMTP_TLS_PORT : SMTP_PORT);
        this.loggedin = user && password ? false : true;
        if (!user && ((_a = password === null || password === void 0 ? void 0 : password.length) !== null && _a !== void 0 ? _a : 0) > 0) {
            throw new Error('`password` cannot be set without `user`');
        }
        this.user = () => user;
        this.password = () => password;
        if (typeof logger === 'function') {
            this.log = logger;
        }
    }
    debug(level) {
        DEBUG = level;
    }
    state() {
        return this._state;
    }
    authorized() {
        return this.loggedin;
    }
    connect(callback, port = this.port, host = this.host, options = {}) {
        this.port = port;
        this.host = host;
        this.ssl = options.ssl || this.ssl;
        if (this._state !== SMTPState.NOTCONNECTED) {
            this.quit(() => this.connect(callback, port, host, options));
        }
        const connected = () => {
            this.log(`connected: ${this.host}:${this.port}`);
            if (this.ssl && !this.tls) {
                if (typeof this.ssl !== 'boolean' &&
                    this.sock instanceof TLSSocket &&
                    !this.sock.authorized) {
                    this.close(true);
                    caller(callback, SMTPError.create('could not establish an ssl connection', SMTPErrorStates.CONNECTIONAUTH));
                }
                else {
                    this._secure = true;
                }
            }
        };
        const connectedErrBack = (err) => {
            if (!err) {
                connected();
            }
            else {
                this.close(true);
                this.log(err);
                caller(callback, SMTPError.create('could not connect', SMTPErrorStates.COULDNOTCONNECT, err));
            }
        };
        const response = (err, msg) => {
            if (err) {
                if (this._state === SMTPState.NOTCONNECTED && !this.sock) {
                    return;
                }
                this.close(true);
                caller(callback, err);
            }
            else if (msg.code == '220') {
                this.log(msg.data);
                this._state = SMTPState.CONNECTED;
                caller(callback, null, msg.data);
            }
            else {
                this.log(`response (data): ${msg.data}`);
                this.quit(() => {
                    caller(callback, SMTPError.create('bad response on connection', SMTPErrorStates.BADRESPONSE, err, msg.data));
                });
            }
        };
        this._state = SMTPState.CONNECTING;
        this.log(`connecting: ${this.host}:${this.port}`);
        if (this.ssl) {
            this.sock = connect(this.port, this.host.trim(), typeof this.ssl === 'object' ? this.ssl : {}, connected);
        }
        else {
            this.sock = new Socket();
            this.sock.connect(this.port, this.host.trim(), connectedErrBack);
        }
        this.monitor = new SMTPResponseMonitor(this.sock, this.timeout, () => this.close(true));
        this.sock.once('response', response);
        this.sock.once('error', response);
    }
    send(str, callback) {
        if (this.sock != null && this._state === SMTPState.CONNECTED) {
            this.log(str);
            this.sock.once('response', (err, msg) => {
                if (err) {
                    caller(callback, err);
                }
                else {
                    this.log(msg.data);
                    caller(callback, null, msg);
                }
            });
            if (this.sock.writable) {
                this.sock.write(str);
            }
        }
        else {
            this.close(true);
            caller(callback, SMTPError.create('no connection has been established', SMTPErrorStates.NOCONNECTION));
        }
    }
    command(cmd, callback, codes = [250]) {
        const codesArray = Array.isArray(codes)
            ? codes
            : typeof codes === 'number'
                ? [codes]
                : [250];
        const response = (err, msg) => {
            if (err) {
                caller(callback, err);
            }
            else {
                const code = Number(msg.code);
                if (codesArray.indexOf(code) !== -1) {
                    caller(callback, err, msg.data, msg.message);
                }
                else if ((code === 450 || code === 451) &&
                    msg.message.toLowerCase().includes('greylist') &&
                    this.greylistResponseTracker.has(response) === false) {
                    this.greylistResponseTracker.add(response);
                    setTimeout(() => {
                        this.send(cmd + CRLF, response);
                    }, GREYLIST_DELAY);
                }
                else {
                    const suffix = msg.message ? `: ${msg.message}` : '';
                    const errorMessage = `bad response on command '${cmd.split(' ')[0]}'${suffix}`;
                    caller(callback, SMTPError.create(errorMessage, SMTPErrorStates.BADRESPONSE, null, msg.data));
                }
            }
        };
        this.greylistResponseTracker.delete(response);
        this.send(cmd + CRLF, response);
    }
    helo(callback, domain) {
        this.command(`helo ${domain || this.domain}`, (err, data) => {
            if (err) {
                caller(callback, err);
            }
            else {
                this.parse_smtp_features(data);
                caller(callback, err, data);
            }
        });
    }
    starttls(callback) {
        const response = (err, msg) => {
            if (this.sock == null) {
                throw new Error('null socket');
            }
            if (err) {
                err.message += ' while establishing a starttls session';
                caller(callback, err);
            }
            else {
                const secureContext = createSecureContext(typeof this.tls === 'object' ? this.tls : {});
                const secureSocket = new TLSSocket(this.sock, { secureContext });
                secureSocket.on('error', (err) => {
                    this.close(true);
                    caller(callback, err);
                });
                this._secure = true;
                this.sock = secureSocket;
                new SMTPResponseMonitor(this.sock, this.timeout, () => this.close(true));
                caller(callback, msg.data);
            }
        };
        this.command('starttls', response, [220]);
    }
    parse_smtp_features(data) {
        data.split('\n').forEach((ext) => {
            const parse = ext.match(/^(?:\d+[-=]?)\s*?([^\s]+)(?:\s+(.*)\s*?)?$/);
            if (parse != null && this.features != null) {
                this.features[parse[1].toLowerCase()] = parse[2] || true;
            }
        });
    }
    ehlo(callback, domain) {
        this.features = {};
        this.command(`ehlo ${domain || this.domain}`, (err, data) => {
            if (err) {
                caller(callback, err);
            }
            else {
                this.parse_smtp_features(data);
                if (this.tls && !this._secure) {
                    this.starttls(() => this.ehlo(callback, domain));
                }
                else {
                    caller(callback, err, data);
                }
            }
        });
    }
    has_extn(opt) {
        var _a;
        return ((_a = this.features) !== null && _a !== void 0 ? _a : {})[opt.toLowerCase()] === undefined;
    }
    help(callback, domain) {
        this.command(domain ? `help ${domain}` : 'help', callback, [211, 214]);
    }
    rset(callback) {
        this.command('rset', callback);
    }
    noop(callback) {
        this.send('noop', callback);
    }
    mail(callback, from) {
        this.command(`mail FROM:${from}`, callback);
    }
    rcpt(callback, to) {
        this.command(`RCPT TO:${to}`, callback, [250, 251]);
    }
    data(callback) {
        this.command('data', callback, [354]);
    }
    data_end(callback) {
        this.command(`${CRLF}.`, callback);
    }
    message(data) {
        var _a, _b;
        this.log(data);
        (_b = (_a = this.sock) === null || _a === void 0 ? void 0 : _a.write(data)) !== null && _b !== void 0 ? _b : this.log('no socket to write to');
    }
    verify(address, callback) {
        this.command(`vrfy ${address}`, callback, [250, 251, 252]);
    }
    expn(address, callback) {
        this.command(`expn ${address}`, callback);
    }
    ehlo_or_helo_if_needed(callback, domain) {
        if (!this.features) {
            const response = (err, data) => caller(callback, err, data);
            this.ehlo((err, data) => {
                if (err) {
                    this.helo(response, domain);
                }
                else {
                    caller(callback, err, data);
                }
            }, domain);
        }
    }
    login(callback, user, password, options = {}) {
        var _a, _b;
        const login = {
            user: user ? () => user : this.user,
            password: password ? () => password : this.password,
            method: (_b = (_a = options === null || options === void 0 ? void 0 : options.method) === null || _a === void 0 ? void 0 : _a.toUpperCase()) !== null && _b !== void 0 ? _b : '',
        };
        const domain = (options === null || options === void 0 ? void 0 : options.domain) || this.domain;
        const initiate = (err, data) => {
            var _a;
            if (err) {
                caller(callback, err);
                return;
            }
            let method = null;
            const encodeCramMd5 = (challenge) => {
                const hmac = createHmac('md5', login.password());
                hmac.update(Buffer.from(challenge, 'base64').toString('ascii'));
                return Buffer.from(`${login.user()} ${hmac.digest('hex')}`).toString('base64');
            };
            const encodePlain = () => Buffer.from(`\u0000${login.user()}\u0000${login.password()}`).toString('base64');
            const encodeXoauth2 = () => Buffer.from(`user=${login.user()}\u0001auth=Bearer ${login.password()}\u0001\u0001`).toString('base64');
            if (!method) {
                const preferred = this.authentication;
                let auth = '';
                if (typeof ((_a = this.features) === null || _a === void 0 ? void 0 : _a['auth']) === 'string') {
                    auth = this.features['auth'];
                }
                for (let i = 0; i < preferred.length; i++) {
                    if (auth.includes(preferred[i])) {
                        method = preferred[i];
                        break;
                    }
                }
            }
            const failed = (err, data) => {
                this.loggedin = false;
                this.close();
                err.message = err.message.replace(this.password(), 'REDACTED');
                caller(callback, SMTPError.create('authorization.failed', SMTPErrorStates.AUTHFAILED, err, data));
            };
            const response = (err, data) => {
                if (err) {
                    failed(err, data);
                }
                else {
                    this.loggedin = true;
                    caller(callback, err, data);
                }
            };
            const attempt = (err, data, msg) => {
                if (err) {
                    failed(err, data);
                }
                else {
                    if (method === AUTH_METHODS['CRAM-MD5']) {
                        this.command(encodeCramMd5(msg), response, [235, 503]);
                    }
                    else if (method === AUTH_METHODS.LOGIN) {
                        this.command(Buffer.from(login.password()).toString('base64'), response, [235, 503]);
                    }
                }
            };
            const attemptUser = (err, data) => {
                if (err) {
                    failed(err, data);
                }
                else {
                    if (method === AUTH_METHODS.LOGIN) {
                        this.command(Buffer.from(login.user()).toString('base64'), attempt, [334]);
                    }
                }
            };
            switch (method) {
                case AUTH_METHODS['CRAM-MD5']:
                    this.command(`AUTH  ${AUTH_METHODS['CRAM-MD5']}`, attempt, [334]);
                    break;
                case AUTH_METHODS.LOGIN:
                    this.command(`AUTH ${AUTH_METHODS.LOGIN}`, attemptUser, [334]);
                    break;
                case AUTH_METHODS.PLAIN:
                    this.command(`AUTH ${AUTH_METHODS.PLAIN} ${encodePlain()}`, response, [235, 503]);
                    break;
                case AUTH_METHODS.XOAUTH2:
                    this.command(`AUTH ${AUTH_METHODS.XOAUTH2} ${encodeXoauth2()}`, response, [235, 503]);
                    break;
                default:
                    caller(callback, SMTPError.create('no form of authorization supported', SMTPErrorStates.AUTHNOTSUPPORTED, null, data));
                    break;
            }
        };
        this.ehlo_or_helo_if_needed(initiate, domain);
    }
    close(force = false) {
        if (this.sock) {
            if (force) {
                this.log('smtp connection destroyed!');
                this.sock.destroy();
            }
            else {
                this.log('smtp connection closed.');
                this.sock.end();
            }
        }
        if (this.monitor) {
            this.monitor.stop();
            this.monitor = null;
        }
        this._state = SMTPState.NOTCONNECTED;
        this._secure = false;
        this.sock = null;
        this.features = null;
        this.loggedin = !(this.user() && this.password());
    }
    quit(callback) {
        this.command('quit', (err, data) => {
            caller(callback, err, data);
            this.close();
        }, [221, 250]);
    }
}
//# sourceMappingURL=connection.js.map
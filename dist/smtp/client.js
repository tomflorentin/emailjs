import { addressparser } from './address.js';
import { Message } from './message.js';
import { SMTPConnection, SMTPState } from './connection.js';
export class SMTPClient {
    constructor(server) {
        this.queue = [];
        this.sending = false;
        this.ready = false;
        this.timer = null;
        this.smtp = new SMTPConnection(server);
    }
    send(msg, callback) {
        const message = msg instanceof Message
            ? msg
            : this._canMakeMessage(msg)
                ? new Message(msg)
                : null;
        if (message == null) {
            callback(new Error('message is not a valid Message instance'), msg);
            return;
        }
        const { isValid, validationError } = message.checkValidity();
        if (isValid) {
            const stack = this.createMessageStack(message, callback);
            if (stack.to.length === 0) {
                return callback(new Error('No recipients found in message'), msg);
            }
            this.queue.push(stack);
            this._poll();
        }
        else {
            callback(new Error(validationError), msg);
        }
    }
    sendAsync(msg) {
        return new Promise((resolve, reject) => {
            this.send(msg, (err, message) => {
                if (err != null) {
                    reject(err);
                }
                else {
                    resolve(message);
                }
            });
        });
    }
    createMessageStack(message, callback = function () {
    }) {
        const [{ address: from }] = addressparser(message.header.from);
        const stack = {
            message,
            to: [],
            from,
            callback: callback.bind(this),
        };
        const { header: { to, cc, bcc, 'return-path': returnPath }, } = message;
        if ((typeof to === 'string' || Array.isArray(to)) && to.length > 0) {
            stack.to = addressparser(to);
        }
        if ((typeof cc === 'string' || Array.isArray(cc)) && cc.length > 0) {
            stack.to = stack.to.concat(addressparser(cc).filter((x) => stack.to.some((y) => y.address === x.address) === false));
        }
        if ((typeof bcc === 'string' || Array.isArray(bcc)) && bcc.length > 0) {
            stack.to = stack.to.concat(addressparser(bcc).filter((x) => stack.to.some((y) => y.address === x.address) === false));
        }
        if (typeof returnPath === 'string' && returnPath.length > 0) {
            const parsedReturnPath = addressparser(returnPath);
            if (parsedReturnPath.length > 0) {
                const [{ address: returnPathAddress }] = parsedReturnPath;
                stack.returnPath = returnPathAddress;
            }
        }
        return stack;
    }
    _poll() {
        if (this.timer != null) {
            clearTimeout(this.timer);
        }
        if (this.queue.length) {
            if (this.smtp.state() == SMTPState.NOTCONNECTED) {
                this._connect(this.queue[0]);
            }
            else if (this.smtp.state() == SMTPState.CONNECTED &&
                !this.sending &&
                this.ready) {
                this._sendmail(this.queue.shift());
            }
        }
        else if (this.smtp.state() == SMTPState.CONNECTED) {
            this.timer = setTimeout(() => this.smtp.quit(), 1000);
        }
    }
    _connect(stack) {
        const connect = (err) => {
            if (!err) {
                const begin = (err) => {
                    if (!err) {
                        this.ready = true;
                        this._poll();
                    }
                    else {
                        stack.callback(err, stack.message);
                        this.queue.shift();
                        this._poll();
                    }
                };
                if (!this.smtp.authorized()) {
                    this.smtp.login(begin);
                }
                else {
                    this.smtp.ehlo_or_helo_if_needed(begin);
                }
            }
            else {
                stack.callback(err, stack.message);
                this.queue.shift();
                this._poll();
            }
        };
        this.ready = false;
        this.smtp.connect(connect);
    }
    _canMakeMessage(msg) {
        return (msg.from &&
            (msg.to || msg.cc || msg.bcc) &&
            (msg.text !== undefined || this._containsInlinedHtml(msg.attachment)));
    }
    _containsInlinedHtml(attachment) {
        if (Array.isArray(attachment)) {
            return attachment.some((att) => {
                return this._isAttachmentInlinedHtml(att);
            });
        }
        else {
            return this._isAttachmentInlinedHtml(attachment);
        }
    }
    _isAttachmentInlinedHtml(attachment) {
        return (attachment &&
            (attachment.data || attachment.path) &&
            attachment.alternative === true);
    }
    _sendsmtp(stack, next) {
        return (err) => {
            if (!err && next) {
                next.apply(this, [stack]);
            }
            else {
                this.smtp.rset(() => this._senddone(err, stack));
            }
        };
    }
    _sendmail(stack) {
        const from = stack.returnPath || stack.from;
        this.sending = true;
        this.smtp.mail(this._sendsmtp(stack, this._sendrcpt), '<' + from + '>');
    }
    _sendrcpt(stack) {
        var _a;
        if (stack.to == null || typeof stack.to === 'string') {
            throw new TypeError('stack.to must be array');
        }
        const to = (_a = stack.to.shift()) === null || _a === void 0 ? void 0 : _a.address;
        this.smtp.rcpt(this._sendsmtp(stack, stack.to.length ? this._sendrcpt : this._senddata), `<${to}>`);
    }
    _senddata(stack) {
        this.smtp.data(this._sendsmtp(stack, this._sendmessage));
    }
    _sendmessage(stack) {
        const stream = stack.message.stream();
        stream.on('data', (data) => this.smtp.message(data));
        stream.on('end', () => {
            this.smtp.data_end(this._sendsmtp(stack, () => this._senddone(null, stack)));
        });
        stream.on('error', (err) => {
            this.smtp.close();
            this._senddone(err, stack);
        });
    }
    _senddone(err, stack) {
        this.sending = false;
        stack.callback(err, stack.message);
        this._poll();
    }
}
//# sourceMappingURL=client.js.map
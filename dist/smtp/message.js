import { existsSync, open as openFile, close as closeFile, closeSync as closeFileSync, read as readFile, } from 'fs';
import { hostname } from 'os';
import { Stream } from 'stream';
import { addressparser } from './address.js';
import { getRFC2822Date } from './date.js';
import { mimeWordEncode } from './mime.js';
const CRLF = '\r\n';
export const MIMECHUNK = 76;
export const MIME64CHUNK = (MIMECHUNK * 6);
export const BUFFERSIZE = (MIMECHUNK * 24 * 7);
let counter = 0;
function generateBoundary() {
    let text = '';
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'()+_,-./:=?";
    for (let i = 0; i < 69; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
function convertPersonToAddress(person) {
    return addressparser(person)
        .map(({ name, address }) => {
        return name
            ? `${mimeWordEncode(name).replace(/,/g, '=2C')} <${address}>`
            : address;
    })
        .join(', ');
}
function convertDashDelimitedTextToSnakeCase(text) {
    return text
        .toLowerCase()
        .replace(/^(.)|-(.)/g, (match) => match.toUpperCase());
}
export class Message {
    constructor(headers) {
        this.attachments = [];
        this.header = {
            'message-id': `<${new Date().getTime()}.${counter++}.${process.pid}@${hostname()}>`,
            date: getRFC2822Date(),
        };
        this.content = 'text/plain; charset=utf-8';
        this.alternative = null;
        for (const header in headers) {
            if (/^content-type$/i.test(header)) {
                this.content = headers[header];
            }
            else if (header === 'text') {
                this.text = headers[header];
            }
            else if (header === 'attachment' &&
                typeof headers[header] === 'object') {
                const attachment = headers[header];
                if (Array.isArray(attachment)) {
                    for (let i = 0; i < attachment.length; i++) {
                        this.attach(attachment[i]);
                    }
                }
                else if (attachment != null) {
                    this.attach(attachment);
                }
            }
            else if (header === 'subject') {
                this.header.subject = mimeWordEncode(headers.subject);
            }
            else if (/^(cc|bcc|to|from)/i.test(header)) {
                this.header[header.toLowerCase()] = convertPersonToAddress(headers[header]);
            }
            else {
                this.header[header.toLowerCase()] = headers[header];
            }
        }
    }
    attach(options) {
        if (options.alternative) {
            this.alternative = options;
            this.alternative.charset = options.charset || 'utf-8';
            this.alternative.type = options.type || 'text/html';
            this.alternative.inline = true;
        }
        else {
            this.attachments.push(options);
        }
        return this;
    }
    checkValidity() {
        if (typeof this.header.from !== 'string' &&
            Array.isArray(this.header.from) === false) {
            return {
                isValid: false,
                validationError: 'Message must have a `from` header',
            };
        }
        if (typeof this.header.to !== 'string' &&
            Array.isArray(this.header.to) === false &&
            typeof this.header.cc !== 'string' &&
            Array.isArray(this.header.cc) === false &&
            typeof this.header.bcc !== 'string' &&
            Array.isArray(this.header.bcc) === false) {
            return {
                isValid: false,
                validationError: 'Message must have at least one `to`, `cc`, or `bcc` header',
            };
        }
        if (this.attachments.length > 0) {
            const failed = [];
            this.attachments.forEach((attachment) => {
                if (attachment.path) {
                    if (existsSync(attachment.path) === false) {
                        failed.push(`${attachment.path} does not exist`);
                    }
                }
                else if (attachment.stream) {
                    if (!attachment.stream.readable) {
                        failed.push('attachment stream is not readable');
                    }
                }
                else if (!attachment.data) {
                    failed.push('attachment has no data associated with it');
                }
            });
            return {
                isValid: failed.length === 0,
                validationError: failed.join(', '),
            };
        }
        return { isValid: true, validationError: undefined };
    }
    valid(callback) {
        const { isValid, validationError } = this.checkValidity();
        callback(isValid, validationError);
    }
    stream() {
        return new MessageStream(this);
    }
    read(callback) {
        let buffer = '';
        const str = this.stream();
        str.on('data', (data) => (buffer += data));
        str.on('end', (err) => callback(err, buffer));
        str.on('error', (err) => callback(err, buffer));
    }
    readAsync() {
        return new Promise((resolve, reject) => {
            this.read((err, buffer) => {
                if (err != null) {
                    reject(err);
                }
                else {
                    resolve(buffer);
                }
            });
        });
    }
}
class MessageStream extends Stream {
    constructor(message) {
        super();
        this.message = message;
        this.readable = true;
        this.paused = false;
        this.buffer = Buffer.alloc(MIMECHUNK * 24 * 7);
        this.bufferIndex = 0;
        const output = (data) => {
            if (this.buffer != null) {
                const bytes = Buffer.byteLength(data);
                if (bytes + this.bufferIndex < this.buffer.length) {
                    this.buffer.write(data, this.bufferIndex);
                    this.bufferIndex += bytes;
                }
                else if (bytes > this.buffer.length) {
                    if (this.bufferIndex) {
                        this.emit('data', this.buffer.toString('utf-8', 0, this.bufferIndex));
                        this.bufferIndex = 0;
                    }
                    const loops = Math.ceil(data.length / this.buffer.length);
                    let loop = 0;
                    while (loop < loops) {
                        this.emit('data', data.substring(this.buffer.length * loop, this.buffer.length * (loop + 1)));
                        loop++;
                    }
                }
                else {
                    if (!this.paused) {
                        this.emit('data', this.buffer.toString('utf-8', 0, this.bufferIndex));
                        this.buffer.write(data, 0);
                        this.bufferIndex = bytes;
                    }
                    else {
                        this.once('resume', () => output(data));
                    }
                }
            }
        };
        const outputAttachmentHeaders = (attachment) => {
            let data = [];
            const headers = {
                'content-type': attachment.type +
                    (attachment.charset ? `; charset=${attachment.charset}` : '') +
                    (attachment.method ? `; method=${attachment.method}` : ''),
                'content-transfer-encoding': 'base64',
                'content-disposition': attachment.inline
                    ? 'inline'
                    : `attachment; filename="${mimeWordEncode(attachment.name)}"`,
            };
            if (attachment.headers != null) {
                for (const header in attachment.headers) {
                    headers[header.toLowerCase()] = attachment.headers[header];
                }
            }
            for (const header in headers) {
                data = data.concat([
                    convertDashDelimitedTextToSnakeCase(header),
                    ': ',
                    headers[header],
                    CRLF,
                ]);
            }
            output(data.concat([CRLF]).join(''));
        };
        const outputBase64 = (data, callback) => {
            const loops = Math.ceil(data.length / MIMECHUNK);
            let loop = 0;
            while (loop < loops) {
                output(data.substring(MIMECHUNK * loop, MIMECHUNK * (loop + 1)) + CRLF);
                loop++;
            }
            if (callback) {
                callback();
            }
        };
        const outputFile = (attachment, next) => {
            var _a;
            const chunk = MIME64CHUNK * 16;
            const buffer = Buffer.alloc(chunk);
            const inputEncoding = ((_a = attachment === null || attachment === void 0 ? void 0 : attachment.headers) === null || _a === void 0 ? void 0 : _a['content-transfer-encoding']) || 'base64';
            const encoding = inputEncoding === '7bit'
                ? 'ascii'
                : inputEncoding === '8bit'
                    ? 'binary'
                    : inputEncoding;
            const opened = (err, fd) => {
                if (err) {
                    this.emit('error', err);
                    return;
                }
                const readBytes = (err, bytes) => {
                    if (err || this.readable === false) {
                        this.emit('error', err || new Error('message stream was interrupted somehow!'));
                        return;
                    }
                    outputBase64(buffer.toString(encoding, 0, bytes), () => {
                        if (bytes == chunk) {
                            readFile(fd, buffer, 0, chunk, null, readBytes);
                        }
                        else {
                            this.removeListener('error', closeFileSync);
                            closeFile(fd, next);
                        }
                    });
                };
                readFile(fd, buffer, 0, chunk, null, readBytes);
                this.once('error', closeFileSync);
            };
            openFile(attachment.path, 'r', opened);
        };
        const outputStream = (attachment, callback) => {
            const { stream } = attachment;
            if (stream === null || stream === void 0 ? void 0 : stream.readable) {
                let previous = Buffer.alloc(0);
                stream.resume();
                stream.on('end', () => {
                    outputBase64(previous.toString('base64'), callback);
                    this.removeListener('pause', stream.pause);
                    this.removeListener('resume', stream.resume);
                    this.removeListener('error', stream.resume);
                });
                stream.on('data', (buff) => {
                    let buffer = Buffer.isBuffer(buff) ? buff : Buffer.from(buff);
                    if (previous.byteLength > 0) {
                        buffer = Buffer.concat([previous, buffer]);
                    }
                    const padded = buffer.length % MIME64CHUNK;
                    previous = Buffer.alloc(padded);
                    if (padded > 0) {
                        buffer.copy(previous, 0, buffer.length - padded);
                    }
                    outputBase64(buffer.toString('base64', 0, buffer.length - padded));
                });
                this.on('pause', stream.pause);
                this.on('resume', stream.resume);
                this.on('error', stream.resume);
            }
            else {
                this.emit('error', { message: 'stream not readable' });
            }
        };
        const outputAttachment = (attachment, callback) => {
            const build = attachment.path
                ? outputFile
                : attachment.stream
                    ? outputStream
                    : outputData;
            outputAttachmentHeaders(attachment);
            build(attachment, callback);
        };
        const outputMessage = (boundary, list, index, callback) => {
            if (index < list.length) {
                output(`--${boundary}${CRLF}`);
                if (list[index].related) {
                    outputRelated(list[index], () => outputMessage(boundary, list, index + 1, callback));
                }
                else {
                    outputAttachment(list[index], () => outputMessage(boundary, list, index + 1, callback));
                }
            }
            else {
                output(`${CRLF}--${boundary}--${CRLF}${CRLF}`);
                callback();
            }
        };
        const outputMixed = () => {
            const boundary = generateBoundary();
            output(`Content-Type: multipart/mixed; boundary="${boundary}"${CRLF}${CRLF}--${boundary}${CRLF}`);
            if (this.message.alternative == null) {
                outputText(this.message);
                outputMessage(boundary, this.message.attachments, 0, close);
            }
            else {
                outputAlternative(this.message, () => outputMessage(boundary, this.message.attachments, 0, close));
            }
        };
        const outputData = (attachment, callback) => {
            var _a, _b;
            outputBase64(attachment.encoded
                ? (_a = attachment.data) !== null && _a !== void 0 ? _a : ''
                : Buffer.from((_b = attachment.data) !== null && _b !== void 0 ? _b : '').toString('base64'), callback);
        };
        const outputText = (message) => {
            let data = [];
            data = data.concat([
                'Content-Type:',
                message.content,
                CRLF,
                'Content-Transfer-Encoding: 7bit',
                CRLF,
            ]);
            data = data.concat(['Content-Disposition: inline', CRLF, CRLF]);
            data = data.concat([message.text || '', CRLF, CRLF]);
            output(data.join(''));
        };
        const outputRelated = (message, callback) => {
            const boundary = generateBoundary();
            output(`Content-Type: multipart/related; boundary="${boundary}"${CRLF}${CRLF}--${boundary}${CRLF}`);
            outputAttachment(message, () => {
                var _a;
                outputMessage(boundary, (_a = message.related) !== null && _a !== void 0 ? _a : [], 0, () => {
                    output(`${CRLF}--${boundary}--${CRLF}${CRLF}`);
                    callback();
                });
            });
        };
        const outputAlternative = (message, callback) => {
            const boundary = generateBoundary();
            output(`Content-Type: multipart/alternative; boundary="${boundary}"${CRLF}${CRLF}--${boundary}${CRLF}`);
            outputText(message);
            output(`--${boundary}${CRLF}`);
            const finish = () => {
                output([CRLF, '--', boundary, '--', CRLF, CRLF].join(''));
                callback();
            };
            if (message.alternative.related) {
                outputRelated(message.alternative, finish);
            }
            else {
                outputAttachment(message.alternative, finish);
            }
        };
        const close = (err) => {
            var _a, _b;
            if (err) {
                this.emit('error', err);
            }
            else {
                this.emit('data', (_b = (_a = this.buffer) === null || _a === void 0 ? void 0 : _a.toString('utf-8', 0, this.bufferIndex)) !== null && _b !== void 0 ? _b : '');
                this.emit('end');
            }
            this.buffer = null;
            this.bufferIndex = 0;
            this.readable = false;
            this.removeAllListeners('resume');
            this.removeAllListeners('pause');
            this.removeAllListeners('error');
            this.removeAllListeners('data');
            this.removeAllListeners('end');
        };
        const outputHeaderData = () => {
            if (this.message.attachments.length || this.message.alternative) {
                output(`MIME-Version: 1.0${CRLF}`);
                outputMixed();
            }
            else {
                outputText(this.message);
                close();
            }
        };
        const outputHeader = () => {
            let data = [];
            for (const header in this.message.header) {
                if (!/bcc/i.test(header) &&
                    Object.prototype.hasOwnProperty.call(this.message.header, header)) {
                    data = data.concat([
                        convertDashDelimitedTextToSnakeCase(header),
                        ': ',
                        this.message.header[header],
                        CRLF,
                    ]);
                }
            }
            output(data.join(''));
            outputHeaderData();
        };
        this.once('destroy', close);
        process.nextTick(outputHeader);
    }
    pause() {
        this.paused = true;
        this.emit('pause');
    }
    resume() {
        this.paused = false;
        this.emit('resume');
    }
    destroy() {
        this.emit('destroy', this.bufferIndex > 0 ? { message: 'message stream destroyed' } : null);
    }
    destroySoon() {
        this.emit('destroy');
    }
}
//# sourceMappingURL=message.js.map
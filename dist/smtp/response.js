import { SMTPError, SMTPErrorStates } from './error.js';
export class SMTPResponseMonitor {
    constructor(stream, timeout, onerror) {
        let buffer = '';
        const notify = () => {
            var _a, _b;
            if (buffer.length) {
                const line = buffer.replace('\r', '');
                if (!((_b = (_a = line
                    .trim()
                    .split(/\n/)
                    .pop()) === null || _a === void 0 ? void 0 : _a.match(/^(\d{3})\s/)) !== null && _b !== void 0 ? _b : false)) {
                    return;
                }
                const match = line ? line.match(/(\d+)\s?(.*)/) : null;
                const data = match !== null
                    ? { code: match[1], message: match[2], data: line }
                    : { code: -1, data: line };
                stream.emit('response', null, data);
                buffer = '';
            }
        };
        const error = (err) => {
            stream.emit('response', SMTPError.create('connection encountered an error', SMTPErrorStates.ERROR, err));
        };
        const timedout = (err) => {
            stream.end();
            stream.emit('response', SMTPError.create('timedout while connecting to smtp server', SMTPErrorStates.TIMEDOUT, err));
        };
        const watch = (data) => {
            if (data !== null) {
                buffer += data.toString();
                notify();
            }
        };
        const close = (err) => {
            stream.emit('response', SMTPError.create('connection has closed', SMTPErrorStates.CONNECTIONCLOSED, err));
        };
        const end = (err) => {
            stream.emit('response', SMTPError.create('connection has ended', SMTPErrorStates.CONNECTIONENDED, err));
        };
        this.stop = (err) => {
            stream.removeAllListeners('response');
            stream.removeListener('data', watch);
            stream.removeListener('end', end);
            stream.removeListener('close', close);
            stream.removeListener('error', error);
            if (err != null && typeof onerror === 'function') {
                onerror(err);
            }
        };
        stream.on('data', watch);
        stream.on('end', end);
        stream.on('close', close);
        stream.on('error', error);
        stream.setTimeout(timeout, timedout);
    }
}
//# sourceMappingURL=response.js.map
export const SMTPErrorStates = {
    COULDNOTCONNECT: 1,
    BADRESPONSE: 2,
    AUTHFAILED: 3,
    TIMEDOUT: 4,
    ERROR: 5,
    NOCONNECTION: 6,
    AUTHNOTSUPPORTED: 7,
    CONNECTIONCLOSED: 8,
    CONNECTIONENDED: 9,
    CONNECTIONAUTH: 10,
};
export class SMTPError extends Error {
    constructor(message) {
        super(message);
        this.code = null;
        this.smtp = null;
        this.previous = null;
    }
    static create(message, code, error, smtp) {
        const msg = (error === null || error === void 0 ? void 0 : error.message) ? `${message} (${error.message})` : message;
        const err = new SMTPError(msg);
        err.code = code;
        err.smtp = smtp;
        if (error) {
            err.previous = error;
        }
        return err;
    }
}
//# sourceMappingURL=error.js.map
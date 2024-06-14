export function getRFC2822Date(date = new Date(), useUtc = false) {
    if (useUtc) {
        return getRFC2822DateUTC(date);
    }
    const dates = date
        .toString()
        .replace('GMT', '')
        .replace(/\s\(.*\)$/, '')
        .split(' ');
    dates[0] = dates[0] + ',';
    const day = dates[1];
    dates[1] = dates[2];
    dates[2] = day;
    return dates.join(' ');
}
export function getRFC2822DateUTC(date = new Date()) {
    const dates = date.toUTCString().split(' ');
    dates.pop();
    dates.push('+0000');
    return dates.join(' ');
}
const rfc2822re = /^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s)?(\d{1,2})\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s(\d{2,4})\s(\d\d):(\d\d)(?::(\d\d))?\s(?:(UT|GMT|[ECMP][SD]T)|([Zz])|([+-]\d{4}))$/;
export function isRFC2822Date(date) {
    return rfc2822re.test(date);
}
//# sourceMappingURL=date.js.map
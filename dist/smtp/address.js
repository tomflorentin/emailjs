const OPERATORS = new Map([
    ['"', '"'],
    ['(', ')'],
    ['<', '>'],
    [',', ''],
    [':', ';'],
    [';', ''],
]);
function tokenizeAddress(address = '') {
    var _a, _b;
    const tokens = [];
    let token = undefined;
    let operator = undefined;
    for (const character of address.toString()) {
        if (((_a = operator === null || operator === void 0 ? void 0 : operator.length) !== null && _a !== void 0 ? _a : 0) > 0 && character === operator) {
            tokens.push({ type: 'operator', value: character });
            token = undefined;
            operator = undefined;
        }
        else if (((_b = operator === null || operator === void 0 ? void 0 : operator.length) !== null && _b !== void 0 ? _b : 0) === 0 && OPERATORS.has(character)) {
            tokens.push({ type: 'operator', value: character });
            token = undefined;
            operator = OPERATORS.get(character);
        }
        else {
            if (token == null) {
                token = { type: 'text', value: character };
                tokens.push(token);
            }
            else {
                token.value += character;
            }
        }
    }
    return tokens
        .map((x) => {
        x.value = x.value.trim();
        return x;
    })
        .filter((x) => x.value.length > 0);
}
function convertAddressTokens(tokens) {
    const addressObjects = [];
    const groups = [];
    let addresses = [];
    let comments = [];
    let texts = [];
    let state = 'text';
    let isGroup = false;
    function handleToken(token) {
        if (token.type === 'operator') {
            switch (token.value) {
                case '<':
                    state = 'address';
                    break;
                case '(':
                    state = 'comment';
                    break;
                case ':':
                    state = 'group';
                    isGroup = true;
                    break;
                default:
                    state = 'text';
                    break;
            }
        }
        else if (token.value.length > 0) {
            switch (state) {
                case 'address':
                    addresses.push(token.value);
                    break;
                case 'comment':
                    comments.push(token.value);
                    break;
                case 'group':
                    groups.push(token.value);
                    break;
                default:
                    texts.push(token.value);
                    break;
            }
        }
    }
    for (const token of tokens) {
        handleToken(token);
    }
    if (texts.length === 0 && comments.length > 0) {
        texts = [...comments];
        comments = [];
    }
    if (isGroup) {
        addressObjects.push({
            name: texts.length === 0 ? undefined : texts.join(' '),
            group: groups.length > 0 ? addressparser(groups.join(',')) : [],
        });
    }
    else {
        if (addresses.length === 0 && texts.length > 0) {
            for (let i = texts.length - 1; i >= 0; i--) {
                if (texts[i].match(/^[^@\s]+@[^@\s]+$/)) {
                    addresses = texts.splice(i, 1);
                    break;
                }
            }
            if (addresses.length === 0) {
                for (let i = texts.length - 1; i >= 0; i--) {
                    texts[i] = texts[i]
                        .replace(/\s*\b[^@\s]+@[^@\s]+\b\s*/, (address) => {
                        if (addresses.length === 0) {
                            addresses = [address.trim()];
                            return ' ';
                        }
                        else {
                            return address;
                        }
                    })
                        .trim();
                    if (addresses.length > 0) {
                        break;
                    }
                }
            }
        }
        if (texts.length === 0 && comments.length > 0) {
            texts = [...comments];
            comments = [];
        }
        if (addresses.length > 1) {
            texts = [...texts, ...addresses.splice(1)];
        }
        if (addresses.length === 0 && isGroup) {
            return [];
        }
        else {
            let address = addresses.join(' ');
            let name = texts.length === 0 ? address : texts.join(' ');
            if (address === name) {
                if (address.match(/@/)) {
                    name = '';
                }
                else {
                    address = '';
                }
            }
            addressObjects.push({ address, name });
        }
    }
    return addressObjects;
}
export function addressparser(address) {
    const addresses = [];
    let tokens = [];
    for (const token of tokenizeAddress(address)) {
        if (token.type === 'operator' &&
            (token.value === ',' || token.value === ';')) {
            if (tokens.length > 0) {
                addresses.push(...convertAddressTokens(tokens));
            }
            tokens = [];
        }
        else {
            tokens.push(token);
        }
    }
    if (tokens.length > 0) {
        addresses.push(...convertAddressTokens(tokens));
    }
    return addresses;
}
//# sourceMappingURL=address.js.map
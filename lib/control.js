const {
    controllerObjectId,
    echonet,
    objectIdToArray,
    parsePositiveInt,
    releaseEchonet,
    sleep,
} = require('./common');

const CONTROL_PROPERTY = 0xda;
const CONNECTION_PROPERTY = 0xc7;
const OPERATION_PROPERTY = 0x80;
const FAULT_PROPERTY = 0x88;
const SET_MAP_PROPERTY = 0x9e;
const GET_MAP_PROPERTY = 0x9f;
const VEHICLE_CONNECTION_CHECK_PROPERTY = 0xcd;
const VEHICLE_CONNECTION_CHECK_VALUE = 0x10;

const controlModes = {
    charge: { value: 0x42, label: 'charge' },
    discharge: { value: 0x43, label: 'discharge' },
    standby: { value: 0x44, label: 'standby' },
    stop: { value: 0x47, label: 'stop' },
};

async function getControlSnapshot(options = {}) {
    return withEchonet(options, async (ctx) => {
        const raw = {};
        let connectionCheckResponse = null;

        if (options.probeConnection) {
            connectionCheckResponse = await setProperty(
                ctx,
                VEHICLE_CONNECTION_CHECK_PROPERTY,
                VEHICLE_CONNECTION_CHECK_VALUE
            );
            await sleep(ctx.connectionProbeDelayMs);
        }

        const properties = [
            OPERATION_PROPERTY,
            FAULT_PROPERTY,
            CONNECTION_PROPERTY,
            CONTROL_PROPERTY,
            SET_MAP_PROPERTY,
            GET_MAP_PROPERTY,
        ];

        for (const property of properties) {
            const value = await getProperty(ctx, property);
            if (value !== null) {
                raw[toHex(property)] = value;
            }
            await sleep(ctx.commandIntervalMs);
        }

        return buildControlSnapshot({
            ip: ctx.ip,
            objectId: ctx.objectId,
            raw,
            connectionCheckResponse,
        });
    });
}

async function controlV2h(options = {}) {
    const mode = normalizeMode(options.mode);
    const execute = Boolean(options.execute);

    return withEchonet(options, async (ctx) => {
        const beforeRaw = {};
        const precheckProperties = [
            OPERATION_PROPERTY,
            FAULT_PROPERTY,
            CONNECTION_PROPERTY,
            CONTROL_PROPERTY,
            SET_MAP_PROPERTY,
        ];

        for (const property of precheckProperties) {
            const value = await getProperty(ctx, property);
            if (value !== null) {
                beforeRaw[toHex(property)] = value;
            }
            await sleep(ctx.commandIntervalMs);
        }

        let connectionCheckResponse = null;

        if (options.probeConnection) {
            connectionCheckResponse = await setProperty(
                ctx,
                VEHICLE_CONNECTION_CHECK_PROPERTY,
                VEHICLE_CONNECTION_CHECK_VALUE
            );
            await sleep(ctx.connectionProbeDelayMs);
            const connectionValue = await getProperty(ctx, CONNECTION_PROPERTY);
            if (connectionValue !== null) {
                beforeRaw[toHex(CONNECTION_PROPERTY)] = connectionValue;
            }
            await sleep(ctx.commandIntervalMs);
        }

        const before = buildControlSnapshot({
            ip: ctx.ip,
            objectId: ctx.objectId,
            raw: beforeRaw,
            connectionCheckResponse,
        });
        const safety = validateControl({ mode, snapshot: before });
        const result = {
            ip: ctx.ip,
            objectId: ctx.objectId,
            requestedMode: mode.label,
            requestedValue: toHex(mode.value),
            dryRun: !execute,
            before,
            safety,
            setResponse: null,
            after: null,
        };

        if (!execute || !safety.allowed) {
            return result;
        }

        result.setResponse = await setMode(ctx, mode.value);
        await sleep(ctx.confirmDelayMs);

        const afterMode = await getProperty(ctx, CONTROL_PROPERTY);
        const afterRaw = { ...beforeRaw };
        if (afterMode !== null) {
            afterRaw[toHex(CONTROL_PROPERTY)] = afterMode;
        }

        result.after = buildControlSnapshot({
            ip: ctx.ip,
            objectId: ctx.objectId,
            raw: afterRaw,
        });

        return result;
    });
}

async function withEchonet(options, fn) {
    if (!options.ip) {
        throw new Error('V2H IP address is required');
    }

    const ctx = {
        ip: options.ip,
        objectId: (options.objectId || '027e01').toLowerCase(),
        timeoutMs: parsePositiveInt(options.timeoutMs || options.timeout, 2500),
        commandIntervalMs: parsePositiveInt(options.commandIntervalMs, 250),
        confirmDelayMs: parsePositiveInt(options.confirmDelayMs, 2000),
        connectionProbeDelayMs: parsePositiveInt(options.connectionProbeDelayMs, 5000),
        messages: [],
        waiters: [],
    };

    function handler(rinfo, els, err) {
        if (err || !rinfo || !els) {
            return;
        }

        const message = {
            ip: rinfo.address,
            tid: (els.TID || '').toLowerCase(),
            seoj: (els.SEOJ || '').toLowerCase(),
            deoj: (els.DEOJ || '').toLowerCase(),
            esv: (els.ESV || '').toLowerCase(),
            details: normalizeDetails(els.DETAILs),
        };
        ctx.messages.push(message);

        ctx.waiters.slice().forEach((waiter) => {
            if (waiter.match(message)) {
                waiter.resolve(message);
            }
        });
    }

    try {
        echonet.initialize(['05ff01'], handler, 4, {
            ignoreMe: true,
            autoGetProperties: false,
            debugMode: false,
        });
        await sleep(500);
        return await fn(ctx);
    } finally {
        releaseEchonet();
    }
}

async function getProperty(ctx, property) {
    const tid = tidToString(echonet.sendOPC1(
        ctx.ip,
        controllerObjectId,
        objectIdToArray(ctx.objectId),
        echonet.GET,
        property
    ));
    const epc = toHex(property);
    const response = await waitForMessage(ctx, (message) => (
        message.ip === ctx.ip
        && message.tid === tid
        && message.seoj === ctx.objectId
        && (message.esv === echonet.GET_RES || message.esv === echonet.GET_SNA)
        && Object.prototype.hasOwnProperty.call(message.details, epc)
    ));

    if (!response || response.esv === echonet.GET_SNA) {
        return null;
    }

    return response.details[epc];
}

async function setMode(ctx, value) {
    return setProperty(ctx, CONTROL_PROPERTY, value);
}

async function setProperty(ctx, property, value) {
    const tid = tidToString(echonet.sendOPC1(
        ctx.ip,
        controllerObjectId,
        objectIdToArray(ctx.objectId),
        echonet.SETC,
        property,
        value
    ));
    const response = await waitForMessage(ctx, (message) => (
        message.ip === ctx.ip
        && message.tid === tid
        && message.seoj === ctx.objectId
        && (message.esv === echonet.SET_RES || message.esv === echonet.SETC_SNA)
    ));

    if (!response) {
        return { ok: false, esv: null, message: 'timeout' };
    }

    return {
        ok: response.esv === echonet.SET_RES,
        esv: response.esv,
        message: response.esv === echonet.SET_RES ? 'accepted' : 'rejected',
    };
}

function waitForMessage(ctx, match) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            removeWaiter();
            resolve(null);
        }, ctx.timeoutMs);

        const waiter = {
            match,
            resolve: (message) => {
                clearTimeout(timeout);
                removeWaiter();
                resolve(message);
            },
        };

        function removeWaiter() {
            const index = ctx.waiters.indexOf(waiter);
            if (index >= 0) {
                ctx.waiters.splice(index, 1);
            }
        }

        ctx.waiters.push(waiter);
    });
}

function buildControlSnapshot({ ip, objectId, raw, connectionCheckResponse = null }) {
    const connectionCode = raw[toHex(CONNECTION_PROPERTY)] || null;
    const faultCode = raw[toHex(FAULT_PROPERTY)] || null;
    const modeCode = raw[toHex(CONTROL_PROPERTY)] || null;

    return {
        ip,
        objectId,
        raw,
        operation: parseOperation(raw[toHex(OPERATION_PROPERTY)]),
        fault: parseFault(faultCode),
        connection: parseConnection(connectionCode),
        connectionCheckResponse,
        mode: parseMode(modeCode),
        supportsModeSet: supportsProperty(raw[toHex(SET_MAP_PROPERTY)], CONTROL_PROPERTY),
        supportsConnectionCheck: supportsProperty(raw[toHex(SET_MAP_PROPERTY)], VEHICLE_CONNECTION_CHECK_PROPERTY),
    };
}

function validateControl({ mode, snapshot }) {
    const reasons = [];

    if (snapshot.operation !== 'ON') {
        reasons.push('operation status is not ON');
    }

    if (snapshot.fault === 'FAULT') {
        reasons.push('device reports a fault');
    }

    if (snapshot.supportsModeSet === false) {
        reasons.push('operation mode setting (EPC 0xDA) is not in Set property map');
    }

    if (mode.label === 'charge' && !snapshot.connection.canCharge) {
        reasons.push('vehicle is not in a charge-capable state');
    }

    if (mode.label === 'discharge' && !snapshot.connection.canDischarge) {
        reasons.push('vehicle is not in a discharge-capable state');
    }

    if ((mode.label === 'standby' || mode.label === 'stop') && snapshot.connection.isUnknown) {
        reasons.push('vehicle connection state is unknown');
    }

    return {
        allowed: reasons.length === 0,
        reasons,
    };
}

function normalizeMode(mode) {
    const normalized = String(mode || '').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(controlModes, normalized)) {
        throw new Error(`Unsupported mode "${mode}". Use charge, discharge, standby, or stop.`);
    }

    return controlModes[normalized];
}

function normalizeDetails(details) {
    const normalized = {};
    Object.keys(details || {}).forEach((key) => {
        normalized[key.toLowerCase()] = String(details[key]).toLowerCase();
    });
    return normalized;
}

function parseOperation(value) {
    switch ((value || '').toLowerCase()) {
        case '30':
            return 'ON';
        case '31':
            return 'OFF';
        default:
            return 'UNKNOWN';
    }
}

function parseFault(value) {
    switch ((value || '').toLowerCase()) {
        case '41':
            return 'FAULT';
        case '42':
            return 'NORMAL';
        default:
            return 'UNKNOWN';
    }
}

function parseConnection(value) {
    switch ((value || '').toLowerCase()) {
        case '30':
            return {
                code: value,
                label: 'not_connected',
                canCharge: false,
                canDischarge: false,
                isUnknown: false,
            };
        case '41':
            return {
                code: value,
                label: 'connected_charge_only',
                canCharge: true,
                canDischarge: false,
                isUnknown: false,
            };
        case '42':
            return {
                code: value,
                label: 'connected_discharge_only',
                canCharge: false,
                canDischarge: true,
                isUnknown: false,
            };
        case '43':
            return {
                code: value,
                label: 'connected_charge_discharge',
                canCharge: true,
                canDischarge: true,
                isUnknown: false,
            };
        case '40':
            return {
                code: value,
                label: 'connected_not_available',
                canCharge: false,
                canDischarge: false,
                isUnknown: false,
            };
        case '44':
            return {
                code: value,
                label: 'connected_unknown_availability',
                canCharge: false,
                canDischarge: false,
                isUnknown: true,
            };
        case 'ff':
            return {
                code: value,
                label: 'indeterminate',
                canCharge: false,
                canDischarge: false,
                isUnknown: true,
            };
        default:
            return {
                code: value || null,
                label: 'unknown',
                canCharge: false,
                canDischarge: false,
                isUnknown: true,
            };
    }
}

function parseMode(value) {
    switch ((value || '').toLowerCase()) {
        case '42':
            return 'charge';
        case '43':
            return 'discharge';
        case '44':
            return 'standby';
        case '46':
            return 'charge_discharge';
        case '47':
            return 'stop';
        case '49':
            return 'auto';
        case '40':
            return 'other';
        default:
            return 'unknown';
    }
}

function supportsProperty(propertyMap, property) {
    if (!propertyMap) {
        return null;
    }

    const map = propertyMap.toLowerCase();
    const bytes = map.match(/.{2}/g) || [];
    if (bytes.length === 0) {
        return false;
    }

    const count = parseInt(bytes[0], 16);
    if (Number.isFinite(count) && count <= 15) {
        return bytes.slice(1, count + 1).includes(toHex(property));
    }

    const epc = Number(property);
    if (epc < 0x80 || epc > 0xff || bytes.length < 17) {
        return false;
    }

    const offset = epc - 0x80;
    const byteIndex = 1 + Math.floor(offset / 8);
    const bitIndex = offset % 8;
    const bitmapByte = parseInt(bytes[byteIndex], 16);
    return Number.isFinite(bitmapByte) && (bitmapByte & (1 << bitIndex)) !== 0;
}

function tidToString(tid) {
    if (!Array.isArray(tid) || tid.length < 2) {
        return '';
    }

    return `${toHex(tid[0])}${toHex(tid[1])}`;
}

function toHex(value) {
    return Number(value).toString(16).padStart(2, '0');
}

module.exports = {
    controlModes,
    controlV2h,
    getControlSnapshot,
    validateControl,
};

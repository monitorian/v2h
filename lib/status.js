const {
    controllerObjectId,
    echonet,
    objectIdToArray,
    parsePositiveInt,
    releaseEchonet,
    sleep,
} = require('./common');

const statusProperties = [
    0x80,
    0x82,
    0xc2,
    0xc4,
    0xc5,
    0xc6,
    0xc7,
    0xcc,
    0xce,
    0xcf,
    0xda,
    0xe2,
    0xe4,
    0xe6,
    0x88,
];

const VEHICLE_CONNECTION_CHECK_PROPERTY = 0xcd;
const VEHICLE_CONNECTION_CHECK_VALUE = 0x10;

async function getStatus(options = {}) {
    if (!options.ip) {
        throw new Error('getStatus requires options.ip');
    }

    const ip = options.ip;
    const objectId = (options.objectId || '027e01').toLowerCase();
    const timeoutMs = parsePositiveInt(options.timeoutMs, 2500);
    const commandIntervalMs = parsePositiveInt(options.commandIntervalMs, 50);
    const connectionProbeDelayMs = parsePositiveInt(options.connectionProbeDelayMs, 5000);
    const raw = {};
    const messages = [];
    let connectionCheckResponse = null;

    function handler(rinfo, els, err) {
        if (err || !rinfo || !els) {
            return;
        }

        messages.push({
            ip: rinfo.address,
            tid: (els.TID || '').toLowerCase(),
            seoj: (els.SEOJ || '').toLowerCase(),
            esv: (els.ESV || '').toLowerCase(),
            details: normalizeDetails(els.DETAILs),
        });

        if (!els.DETAILs) {
            return;
        }

        if (els.SEOJ && els.SEOJ.toLowerCase() !== objectId) {
            return;
        }

        Object.keys(els.DETAILs).forEach((key) => {
            raw[key.toLowerCase()] = String(els.DETAILs[key]).toLowerCase();
        });
    }

    try {
        echonet.initialize(['05ff01'], handler);
        await sleep(500);

        const targetObjectId = objectIdToArray(objectId);

        if (options.probeConnection) {
            connectionCheckResponse = await setVehicleConnectionCheck({
                ip,
                objectId,
                timeoutMs,
                messages,
            });
            await sleep(connectionProbeDelayMs);
        }

        for (const property of statusProperties) {
            echonet.sendOPC1(ip, controllerObjectId, targetObjectId, echonet.GET, property);
            await sleep(commandIntervalMs);
        }

        await sleep(timeoutMs);

        return buildStatus({ ip, objectId, raw, connectionCheckResponse });
    } finally {
        releaseEchonet();
    }
}

async function setVehicleConnectionCheck({ ip, objectId, timeoutMs, messages }) {
    const tid = tidToString(echonet.sendOPC1(
        ip,
        controllerObjectId,
        objectIdToArray(objectId),
        echonet.SETC,
        VEHICLE_CONNECTION_CHECK_PROPERTY,
        VEHICLE_CONNECTION_CHECK_VALUE
    ));

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        await sleep(50);
        const response = findSetResponse({ ip, objectId, tid, messages });
        if (response) {
            return response;
        }
    }

    return { ok: false, esv: null, message: 'timeout' };
}

function findSetResponse({ ip, objectId, tid, messages }) {
    const response = messages.find((message) => (
        message.ip === ip
        && message.tid === tid
        && message.seoj === objectId
        && (message.esv === echonet.SET_RES || message.esv === echonet.SETC_SNA)
    ));

    if (!response) {
        return null;
    }

    return {
        ok: response.esv === echonet.SET_RES,
        esv: response.esv,
        message: response.esv === echonet.SET_RES ? 'accepted' : 'rejected',
    };
}

function normalizeDetails(details) {
    const normalized = {};
    Object.keys(details || {}).forEach((key) => {
        normalized[key.toLowerCase()] = String(details[key]).toLowerCase();
    });
    return normalized;
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

function buildStatus({ ip, objectId, raw, connectionCheckResponse = null }) {
    const vehicleConnection = parseVehicleConnectionAvailability(raw.c7);
    const connectionStatus = parseConnectionStatus(raw.c7);
    const mode = parseMode(raw.da);
    const socPct = parseHexByte(raw.e4);

    return {
        ip,
        objectId,
        isVehicleConnected: vehicleConnection.isVehicleConnected,
        connectionStatus,
        vehicleConnection,
        connectionCheckResponse,
        socPct,
        mode,
        raw,
        table: {
            'システム電源': raw['80'] === '30' ? 'ON' : 'OFF',
            '異常発生状態': raw['88'] === '41' ? '異常' : '平常',
            '充電器タイプ': parseV2hType(raw.cc),
            '定格充電能力(W)': parseHexNumber(raw.c5),
            '定格放電能力(W)': parseHexNumber(raw.c6),
            '車両接続確認': formatSetResponse(connectionCheckResponse),
            '車両接続・充放電可否状態': formatVehicleConnectionAvailability(vehicleConnection),
            '車載電池の充電可能容量値(Wh)': parseHexNumber(raw.ce),
            '車載電池の充電可能残容量(Wh)': parseHexNumber(raw.cf),
            '運転モード設定': parseModeLabel(raw.da),
            '車載電池の放電可能残容量(Wh)': parseHexNumber(raw.c2),
            '車載電池の放電可能残容量(%)': parseHexNumber(raw.c4),
            '車両ID': getVehicleId(vehicleConnection, raw.e6),
            '車載電池の残容量(Wh)': parseHexNumber(raw.e2),
            '車載電池の残容量(％)': socPct,
            '規格Version情報': raw['82'] || null,
        },
    };
}

function isVehicleConnected(value) {
    return parseVehicleConnectionAvailability(value).isVehicleConnected;
}

function parseConnectionStatus(value) {
    const parsed = parseVehicleConnectionAvailability(value);
    if (parsed.isUnknown) {
        return 'UNKNOWN';
    }
    return parsed.isVehicleConnected ? 'CONNECTED' : 'DISCONNECTED';
}

function parseVehicleConnectionAvailability(value) {
    const code = typeof value === 'string' ? value.toLowerCase() : null;

    switch (code) {
        case '30':
            return {
                code,
                label: '車両未接続',
                isVehicleConnected: false,
                canCharge: false,
                canDischarge: false,
                isUnknown: false,
            };
        case '40':
            return {
                code,
                label: '車両接続・充電不可・放電不可',
                isVehicleConnected: true,
                canCharge: false,
                canDischarge: false,
                isUnknown: false,
            };
        case '41':
            return {
                code,
                label: '車両接続・充電可・放電不可',
                isVehicleConnected: true,
                canCharge: true,
                canDischarge: false,
                isUnknown: false,
            };
        case '42':
            return {
                code,
                label: '車両接続・充電不可・放電可',
                isVehicleConnected: true,
                canCharge: false,
                canDischarge: true,
                isUnknown: false,
            };
        case '43':
            return {
                code,
                label: '車両接続・充電可・放電可',
                isVehicleConnected: true,
                canCharge: true,
                canDischarge: true,
                isUnknown: false,
            };
        case '44':
            return {
                code,
                label: '車両接続・状態不明',
                isVehicleConnected: true,
                canCharge: false,
                canDischarge: false,
                isUnknown: true,
            };
        case 'ff':
            return {
                code,
                label: '不定',
                isVehicleConnected: false,
                canCharge: false,
                canDischarge: false,
                isUnknown: true,
            };
        default:
            return {
                code,
                label: '取得できず',
                isVehicleConnected: false,
                canCharge: false,
                canDischarge: false,
                isUnknown: true,
            };
    }
}

function formatVehicleConnectionAvailability(value) {
    if (!value || !value.code) {
        return '取得できず';
    }

    return `${value.label} (0x${value.code})`;
}

function formatSetResponse(response) {
    if (!response) {
        return '未実施';
    }

    if (response.ok) {
        return `受理 (ESV 0x${response.esv})`;
    }

    if (response.esv) {
        return `拒否 (ESV 0x${response.esv})`;
    }

    return response.message || '応答なし';
}

function parseMode(value) {
    switch ((value || '').toLowerCase()) {
        case '42':
            return 'CHARGE';
        case '43':
            return 'DISCHARGE';
        case '44':
            return 'STANDBY';
        case '47':
            return 'STOP';
        case '40':
            return 'OTHER';
        default:
            return 'UNKNOWN';
    }
}

function parseModeLabel(value) {
    switch (parseMode(value)) {
        case 'CHARGE':
            return '充電';
        case 'DISCHARGE':
            return '放電';
        case 'STANDBY':
            return '待機';
        case 'STOP':
            return '停止';
        case 'OTHER':
            return 'その他';
        default:
            return '取得できず';
    }
}

function parseV2hType(value) {
    switch ((value || '').toLowerCase()) {
        case '21':
            return 'DCタイプA(充電のみ)';
        case '22':
            return 'DCタイプA(放電のみ)';
        case '23':
            return 'DCタイプA(充放電)';
        default:
            return '取得できず';
    }
}

function getVehicleId(vehicleConnection, vehicleId) {
    return vehicleConnection && vehicleConnection.isVehicleConnected ? vehicleId || null : 'ff';
}

function parseHexByte(value) {
    return parseHexNumber(value);
}

function parseHexNumber(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const parsed = parseInt(value, 16);
    return Number.isFinite(parsed) ? parsed : null;
}

module.exports = {
    getStatus,
    buildStatus,
    parseVehicleConnectionAvailability,
};

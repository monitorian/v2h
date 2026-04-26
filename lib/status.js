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

async function getStatus(options = {}) {
    if (!options.ip) {
        throw new Error('getStatus requires options.ip');
    }

    const ip = options.ip;
    const objectId = (options.objectId || '027e01').toLowerCase();
    const timeoutMs = parsePositiveInt(options.timeoutMs, 2500);
    const raw = {};

    function handler(rinfo, els, err) {
        if (err || !els || !els.DETAILs) {
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
        for (const property of statusProperties) {
            echonet.sendOPC1(ip, controllerObjectId, targetObjectId, echonet.GET, property);
            await sleep(50);
        }

        await sleep(timeoutMs);

        return buildStatus({ ip, objectId, raw });
    } finally {
        releaseEchonet();
    }
}

function buildStatus({ ip, objectId, raw }) {
    const connectionStatus = parseConnectionStatus(raw.c7);
    const mode = parseMode(raw.da);
    const socPct = parseHexByte(raw.e4);

    return {
        ip,
        objectId,
        isVehicleConnected: isVehicleConnected(raw.c7),
        connectionStatus,
        socPct,
        mode,
        raw,
        table: {
            'システム電源': raw['80'] === '30' ? 'ON' : 'OFF',
            '異常発生状態': raw['88'] === '41' ? '異常' : '平常',
            '充電器タイプ': parseV2hType(raw.cc),
            '定格充電能力(W)': parseHexNumber(raw.c5),
            '定格放電能力(W)': parseHexNumber(raw.c6),
            '車両接続・充放電可否状態': raw.c7 || null,
            '車載電池の充電可能容量値(Wh)': parseHexNumber(raw.ce),
            '車載電池の充電可能残容量(Wh)': parseHexNumber(raw.cf),
            '運転モード設定': parseModeLabel(raw.da),
            '車載電池の放電可能残容量(Wh)': parseHexNumber(raw.c2),
            '車載電池の放電可能残容量(%)': parseHexNumber(raw.c4),
            '車両ID': getVehicleId(raw.c7, raw.e6),
            '車載電池の残容量(Wh)': parseHexNumber(raw.e2),
            '車載電池の残容量(％)': socPct,
            '規格Version情報': raw['82'] || null,
        },
    };
}

function isVehicleConnected(value) {
    const parsed = parseInt(value, 16);
    return Number.isFinite(parsed) && parsed >= 0x40 && parsed <= 0xff;
}

function parseConnectionStatus(value) {
    if (!value) {
        return 'UNKNOWN';
    }

    if (value.toLowerCase() === 'ff') {
        return 'CONNECTED';
    }

    return isVehicleConnected(value) ? 'CONNECTED' : 'DISCONNECTED';
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

function getVehicleId(connectionStatus, vehicleId) {
    return isVehicleConnected(connectionStatus) ? vehicleId || null : 'ff';
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
};

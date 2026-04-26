const echonet = require('echonet-lite');

const controllerObjectId = [0x0e, 0xf0, 0x01];
const v2hObjectId = [0x02, 0x7e, 0x01];

function sleep(interval) {
    return new Promise((resolve) => {
        setTimeout(resolve, interval);
    });
}

function parsePositiveInt(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function releaseEchonet() {
    if (typeof echonet.release === 'function') {
        echonet.release();
    }
}

function objectIdToArray(objectId) {
    const normalized = (objectId || '027e01').toLowerCase();
    return [
        parseInt(normalized.substr(0, 2), 16),
        parseInt(normalized.substr(2, 2), 16),
        parseInt(normalized.substr(4, 2), 16),
    ];
}

module.exports = {
    controllerObjectId,
    echonet,
    objectIdToArray,
    parsePositiveInt,
    releaseEchonet,
    sleep,
    v2hObjectId,
};

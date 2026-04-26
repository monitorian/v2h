const {
    controllerObjectId,
    echonet,
    parsePositiveInt,
    releaseEchonet,
    sleep,
    v2hObjectId,
} = require('./common');

async function discover(options = {}) {
    const timeoutMs = parsePositiveInt(options.timeoutMs || options.timeout, 5000);
    const devicesByKey = {};

    function addDevice(ip, objectId) {
        if (!ip || !objectId) {
            return;
        }

        const normalizedObjectId = objectId.toLowerCase();
        const key = `${ip}/${normalizedObjectId}`;
        devicesByKey[key] = {
            ip,
            objectId: normalizedObjectId,
        };
    }

    function collectFromMessage(ip, els) {
        if (!els) {
            return;
        }

        if (els.SEOJ && els.SEOJ.toLowerCase().startsWith('027e')) {
            addDevice(ip, els.SEOJ);
        }

        if (!els.DETAILs) {
            return;
        }

        ['d5', 'd6'].forEach((epc) => {
            extractV2hObjectIds(els.DETAILs[epc]).forEach((objectId) => {
                addDevice(ip, objectId);
            });
        });
    }

    function handler(rinfo, els, err) {
        if (err || !rinfo || !els) {
            return;
        }

        collectFromMessage(rinfo.address, els);
    }

    try {
        echonet.initialize(['05ff01'], handler, 4, {
            ignoreMe: true,
            autoGetProperties: true,
            autoGetDelay: 500,
            debugMode: false,
        });

        await sleep(500);
        echonet.search();

        if (options.probeIp) {
            probeV2hDevice(options.probeIp);
        }

        await sleep(timeoutMs);
        collectFromFacilities(addDevice);

        return Object.values(devicesByKey);
    } finally {
        releaseEchonet();
    }
}

function probeV2hDevice(ip) {
    echonet.sendOPC1(ip, controllerObjectId, v2hObjectId, echonet.GET, 0x80);
    echonet.sendOPC1(ip, controllerObjectId, v2hObjectId, echonet.GET, 0x82);
}

function collectFromFacilities(addDevice) {
    Object.keys(echonet.facilities || {}).forEach((ip) => {
        Object.keys(echonet.facilities[ip] || {}).forEach((objectId) => {
            if (objectId.toLowerCase().startsWith('027e')) {
                addDevice(ip, objectId);
                return;
            }

            ['d5', 'd6'].forEach((epc) => {
                const value = echonet.facilities[ip][objectId][epc];
                extractV2hObjectIds(value).forEach((v2hObjectId) => {
                    addDevice(ip, v2hObjectId);
                });
            });
        });
    });
}

function extractV2hObjectIds(instanceList) {
    if (typeof instanceList !== 'string' || instanceList.length < 8) {
        return [];
    }

    const objectIds = [];
    const count = parseInt(instanceList.substr(0, 2), 16);

    for (let i = 0; i < count; i++) {
        const objectId = instanceList.substr(2 + i * 6, 6).toLowerCase();
        if (objectId.startsWith('027e')) {
            objectIds.push(objectId);
        }
    }

    return objectIds;
}

module.exports = {
    discover,
    extractV2hObjectIds,
};

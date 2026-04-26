#! /usr/bin/env node
const os = require('os');
const fs = require('fs');
const path = require('path');
const colors = require('colors');
const cli = require('cac')();

const { discover, getStatus } = require('./');
const { formatDiscoveredDevices, formatStatus } = require('./lib/format');
const {
    controllerObjectId,
    echonet,
    parsePositiveInt,
    sleep,
    v2hObjectId,
} = require('./lib/common');

const packagejson = require('./package.json');
const v2hDB = require('./v2h-db.json');

const configPath = path.join(os.homedir(), '.v2h.config.json');
const v2hLaunchDateObj = new Date();
const v2hLaunchTimeStamp = v2hLaunchDateObj.toISOString();

const redON = colors.red('ON');
const cyanOFF = colors.cyan('OFF');

console.log(`${colors.red.bold('⚡')} ${colors.cyan.bold('v2h')} ${colors.red.bold('⚡')}`);

cli
    .command('on', 'V2HをONにします。')
    .action(async () => {
        try {
            v2hSet(requireConfiguredIp(), 0x80, 0x30);
            console.log(`V2Hを ${redON} にします。`);
        } catch (err) {
            fail(err);
        }
    });

cli
    .command('off', 'V2HをOFFにします。')
    .action(async () => {
        try {
            v2hSet(requireConfiguredIp(), 0x80, 0x31);
            console.log(`V2Hを ${cyanOFF} にします。`);
        } catch (err) {
            fail(err);
        }
    });

cli.command('send-el <deoj> <esv> <property> [...value]')
    .action((deoj, esv, property, value) => {
        try {
            echonetSend(requireConfiguredIp(), deoj, esv, property, value[0]);
        } catch (err) {
            fail(err);
        }
    });

cli
    .command('discover', 'Discover V2H devices on the local ECHONET Lite network.')
    .option('--timeout <ms>', 'Discovery timeout in milliseconds.', {
        default: 5000,
    })
    .option('--ip <address>', 'Also probe a specific IP address directly.')
    .option('--save', 'Save the first discovered V2H IP address to the config file.')
    .action(async (options) => {
        try {
            const timeoutMs = parsePositiveInt(options.timeout, 5000);
            const probeIp = options.ip || getConfiguredProbeIp();
            process.stdout.write(`V2H devices discovering for ${timeoutMs}ms...`);

            const devices = await discover({
                timeoutMs,
                probeIp,
            });

            process.stdout.write('\r\x1b[K');

            if (devices.length === 0) {
                console.log('V2H devices were not found.');
                process.exitCode = 1;
                return;
            }

            console.log(formatDiscoveredDevices(devices));

            if (options.save) {
                saveConfigIp(devices[0].ip);
                console.log(`Saved ${devices[0].ip} to ${configPath}`);
            }
        } catch (err) {
            fail(err);
        }
    });

cli
    .command('status', '充放電可否状態など現在の状態を表示します。')
    .option('--ip <address>', 'V2H IP address. Defaults to ~/.v2h.config.json.')
    .option('--timeout <ms>', 'Status timeout in milliseconds.', {
        default: 2500,
    })
    .action(async (options) => {
        try {
            const ip = options.ip || requireConfiguredIp();
            const timeoutMs = parsePositiveInt(options.timeout, 2500);
            process.stdout.write('V2Hの設定値を取得中……');
            const status = await getStatus({ ip, timeoutMs });
            process.stdout.write('\r\x1b[K');
            console.log(formatStatus(status));
        } catch (err) {
            fail(err);
        }
    });

cli
    .command('watch', 'メッセージを待ち受け、ログとして表示します。')
    .option('--csv', 'CSV形式でログを表示します')
    .action(async (options) => {
        try {
            const currentDateObj = new Date();
            if (options.csv) {
                fs.writeFileSync(`${v2hLaunchTimeStamp}.csv`, 'timestamp,SEOJ,DEOJ,ESV,OPC,property,value\n');
                echonet.initialize(['05ff01'], v2hWatchCsvHandler);
            } else {
                writeLog(currentDateObj, '[v2h] メッセージを待機中…… Ctrl-C で終了します');
                echonet.initialize(['05ff01'], v2hWatchMessageHandler);
            }
            await sleep(500);
        } catch (err) {
            fail(err);
        }
    });

cli.command('').action(() => cli.outputHelp());
cli.help();
cli.version(packagejson.version);
cli.parse();

function echonetSend(ip, deojArg, esvArg, propertyArg, valueArg) {
    const elDeoj = [
        parseInt(deojArg.substr(0, 2), 16),
        parseInt(deojArg.substr(2, 2), 16),
        parseInt(deojArg.substr(4, 2), 16),
    ];
    const elEsv = parseEsv(esvArg);
    const elProperty = parseInt(propertyArg);
    const elValue = parseInt(valueArg);

    echonet.sendOPC1(ip, controllerObjectId, elDeoj, elEsv, elProperty, elValue);
}

function v2hSet(ip, item, value) {
    echonet.sendOPC1(ip, controllerObjectId, v2hObjectId, echonet.SETC, item, value);
}

function parseEsv(esvArg) {
    switch (esvArg) {
        case 'SETI_SNA':
            return echonet.SETI_SNA;
        case 'SETC_SNA':
            return echonet.SETC_SNA;
        case 'GET_SNA':
            return echonet.GET_SNA;
        case 'INF_SNA':
            return echonet.INF_SNA;
        case 'SETGET_SNA':
            return echonet.SETGET_SNA;
        case 'SETI':
            return echonet.SETI;
        case 'SETC':
            return echonet.SETC;
        case 'GET':
            return echonet.GET;
        case 'INF_REQ':
            return echonet.INF_REQ;
        case 'SETGET':
            return echonet.SETGET;
        case 'SET_RES':
            return echonet.SET_RES;
        case 'GET_RES':
            return echonet.GET_RES;
        case 'INF':
            return echonet.INF;
        case 'INFC':
            return echonet.INFC;
        case 'INFC_RES':
            return echonet.INFC_RES;
        case 'SETGET_RES':
            return echonet.SETGET_RES;
        default:
            return echonet.GET;
    }
}

function v2hWatchMessageHandler(rinfo, els, err) {
    const currentDateObj = new Date();
    if (err) {
        console.dir(err);
        return;
    }

    const matchedSEOJ = v2hDB[els.SEOJ];
    const matchedDEOJ = v2hDB[els.DEOJ];
    const seoj = els.SEOJ;
    const deoj = els.DEOJ;
    const esv = els.ESV;
    const opc = els.OPC;
    const keys = Object.keys(els.DETAILs || {});

    keys.forEach((key) => {
        const elsDetailsValue = els.DETAILs[key].toLowerCase();
        let seojName = '';
        let deojName = '';
        let valueName = '';
        let displayValue = '';

        if (matchedSEOJ === undefined) {
            seojName = 'unknown';
            valueName = 'unknown';
            displayValue = `hex: ${elsDetailsValue}`;
        } else if (matchedSEOJ.values[key] === undefined) {
            seojName = matchedSEOJ.name;
            valueName = 'unknown';
            displayValue = `hex: ${elsDetailsValue}`;
        } else {
            const type = matchedSEOJ.values[key].type;
            seojName = matchedSEOJ.name;
            valueName = matchedSEOJ.values[key].name;

            if (type === 'list') {
                displayValue = `${matchedSEOJ.values[key].values[elsDetailsValue]} (hex: ${elsDetailsValue})`;
            } else if (type === 'hex') {
                displayValue = `${parseInt(elsDetailsValue, 16)} (hex: ${elsDetailsValue})`;
            } else if (type === 'raw') {
                displayValue = `(hex: ${elsDetailsValue})`;
            }
        }

        deojName = matchedDEOJ === undefined ? 'unknown' : matchedDEOJ.name;
        writeLog(currentDateObj, `[${colors.yellow.bold(seojName)}(${seoj})->${colors.yellow.bold(deojName)}(${deoj})] ESV:${colors.green(esv)} OPC:${colors.blue(opc)} ${colors.yellow(valueName)}(${key}) : ${colors.yellow(displayValue)}`);
    });
}

function v2hWatchCsvHandler(rinfo, els, err) {
    const currentDateObj = new Date();
    const currentTimeStamp = currentDateObj.toISOString();
    if (err) {
        return;
    }

    const seoj = els.SEOJ;
    const deoj = els.DEOJ;
    const esv = els.ESV;
    const opc = els.OPC;
    const keys = Object.keys(els.DETAILs || {});

    keys.forEach((key) => {
        const elsDetailsValue = els.DETAILs[key].toLowerCase();
        const csvLine = `${currentTimeStamp},${seoj},${deoj},${esv},${opc},${key},${elsDetailsValue}`;
        console.log(csvLine);
        fs.appendFileSync(`${v2hLaunchTimeStamp}.csv`, `${csvLine}\n`);
    });
}

function writeLog(dateObj, arg) {
    const currentTimeStamp = dateObj.toISOString();
    console.log(`${currentTimeStamp} ${arg}`);
}

function getConfiguredProbeIp() {
    const config = readConfig(false);
    if (!config || !config.ip) {
        return null;
    }

    return config.ip;
}

function requireConfiguredIp() {
    const config = readConfig(true);
    if (!config.ip) {
        throw new Error(`V2H IP address is not configured. Edit ${configPath} or pass --ip.`);
    }

    return config.ip;
}

function readConfig(createIfMissing) {
    if (!fs.existsSync(configPath)) {
        if (createIfMissing) {
            fs.writeFileSync(configPath, `${JSON.stringify({ ip: '' })}\n`);
            throw new Error(`設定ファイルを以下のパスに作成しました。IPアドレスを書き換えてください。\n${configPath}`);
        }

        return null;
    }

    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function saveConfigIp(ip) {
    fs.writeFileSync(configPath, `${JSON.stringify({ ip })}\n`);
}

function fail(err) {
    console.error(`[${colors.red.bold('ERROR')}] ${err.message || err}`);
    process.exitCode = 1;
}

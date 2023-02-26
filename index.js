#! /usr/bin/env node
const os = require('os');
const fs = require('fs');
const path = require('path');
const echonet = require('echonet-lite');
const cli = require('cac')();
const colors = require('colors');

const packagejson = require('./package.json');
const v2hDB = require('./v2h-db.json');
const configPath = path.join(os.homedir(), '.v2h.config.json');

const ListIt = require("list-it");
const listit = new ListIt({
    headerBold: true,
    headerUnderline: true,
});

const v2hLaunchDateObj = new Date();
const v2hLaunchTimeStamp = v2hLaunchDateObj.toISOString();

const redON = `${colors.red('ON')}`;
const cyanOFF = `${colors.cyan('OFF')}`;

console.log(`${colors.red.bold('⚡')} ${colors.cyan.bold('v2h')} ${colors.red.bold('⚡')}`);

if (!fs.existsSync(configPath)) {
    console.error(`[${colors.red.bold('ERROR')}] 設定ファイルが見つかりません。`);
    fs.writeFile(configPath, `{"ip":"192.0.2.0"}`, (err) => {
        if (err) {
            console.error(`設定ファイルを書き込めませんでした。:\n${err}`);
            throw err;
        }
        else {
            console.log(`設定ファイルを以下のパスに作成しました。IPアドレスを書き換えてください。\n${configPath}`);
        }
    });
    return;
}

const config = JSON.parse(fs.readFileSync(configPath));
const controllerObjectId = [0x0e, 0xf0, 0x01]; //コントローラ
const bathControllerObjectId = [0x02, 0x7e, 0x01]; //V2H
const responseResultObj = {};

cli
    .command('on', 'V2HをONにします。')
    .action(() => {
        v2hSet(0x80, 0x30);
        console.log(`V2Hを ${redON} にします。`);
    });

cli
    .command('off', 'V2HをOFFにします。')
    .action(() => {
        v2hSet(0x80, 0x31);
        console.log(`V2Hを ${cyanOFF} にします。`);
    });

cli.command('send-el <deoj> <esv> <property> [...value]')
    .action((deoj, esv, property, value) => {
        echonetSend(deoj, esv, property, value[0]);
    });

cli
    .command('status', '充放電可否状態など現在の状態を表示します。')
    .action(() => {
        (async () => {
            process.stdout.write('V2Hの設定値を取得中……');
            echonet.initialize(['05ff01'], v2hStatusMessageHandler);
            await sleep(500);
            await v2hGet(0x80);
            await v2hGet(0xC7); // 車両接続・充放電可否状態
            await v2hGet(0xCD); // 車両接続確認
            await v2hGet(0xCE); // 車載電池の充電可能容量値
            await v2hGet(0xCF); // 車載電池の充電可能残容量
            await v2hGet(0xDA); // 運転モード設定
            await v2hGet(0xE6); // 車両ID
            await v2hGet(0x88); // 異常発生状態
            process.stdout.write("\r\x1b[K")
            showStatus(responseResultObj);
            process.exit();
        })();
    });

cli
    .command('watch', 'メッセージを待ち受け、ログとして表示します。')
    .option('--csv', 'CSV形式でログを表示します')
    .action((options) => {
        (async () => {
            const currentDateObj = new Date();
            if (options.csv) {
                fs.writeFileSync(`${v2hLaunchTimeStamp}.csv`, `timestamp,SEOJ,DEOJ,ESV,OPC,property,value\n`);
                echonet.initialize(['05ff01'], v2hWatchCsvHandler);
            } else {
                writeLog(currentDateObj, `[v2h] メッセージを待機中……　Ctrl-C で終了します`);
                echonet.initialize(['05ff01'], v2hWatchMessageHandler);
            }
            await sleep(500);
        })();
    });

cli.command('').action(() => cli.outputHelp());
cli.help();
cli.version(packagejson.version);
cli.parse();

function echonetSend(deojArg, esvArg, propertyArg, valueArg) {
    let elDeoj = ['0x00', '0x00', '0x00'];
    //TODO: Sanitize
    elDeoj = [`0x${deojArg.substr(0, 2)}`, `0x${deojArg.substr(2, 2)}`, `0x${deojArg.substr(4, 2)}`];

    let elEsv = echonet.GET;
    switch (esvArg) {
        case 'SETI_SNA':
            elEsv = echonet.SETI_SNA;
            break;
        case 'SETC_SNA':
            elEsv = echonet.SETC_SNA;
            break;
        case 'GET_SNA':
            elEsv = echonet.GET_SNA;
            break;
        case 'INF_SNA':
            elEsv = echonet.INF_SNA;
            break;
        case 'SETGET_SNA':
            elEsv = echonet.SETGET_SNA;
            break;
        case 'SETI':
            elEsv = echonet.SETI;
            break;
        case 'SETC':
            elEsv = echonet.SETC;
            break;
        case 'GET':
            elEsv = echonet.GET;
            break;
        case 'INF_REQ':
            elEsv = echonet.INF_REQ;
            break;
        case 'SETGET':
            elEsv = echonet.SETGET;
            break;
        case 'SET_RES':
            elEsv = echonet.SET_RES;
            break;
        case 'GET_RES':
            elEsv = echonet.GET_RES;
            break;
        case 'INF':
            elEsv = echonet.INF;
            break;
        case 'INFC':
            elEsv = echonet.INFC;
            break;
        case 'INFC_RES':
            elEsv = echonet.INFC_RES;
            break;
        case 'SETGET_RES':
            elEsv = echonet.SETGET_RES;
            break;
        default:
            elEsv = echonet.GET;
    }

    let elProperty = 0x00;
    elProperty = parseInt(propertyArg);

    let elValue = 0x00;
    elValue = parseInt(valueArg);

    echonet.sendOPC1(config.ip, controllerObjectId, elDeoj, elEsv, elProperty, elValue);
}

function v2hSet(item, value) {
    echonet.sendOPC1(config.ip, controllerObjectId, bathControllerObjectId, echonet.SETC, item, value);
}

async function v2hGet(item) {
    echonet.sendOPC1(config.ip, controllerObjectId, bathControllerObjectId, echonet.GET, item);
    await sleep(50);
}

function v2hStatusMessageHandler(rinfo, els, err) {
    if (err) {
        console.dir(err);
    } else {
        if (els['SEOJ'] == '027e01') { // V2Hオブジェクトコード
            let key = Object.keys(els.DETAILs).shift();
            let val = els.DETAILs[key];
            responseResultObj[key] = val;
        }
    }
}

function showStatus(obj) {
    const pwr = obj['80'] == '30' ? redON : cyanOFF;
    const carConnectChargeStatus = obj['c7'];
    const carConnectStatus = obj['cd'] == '10' ? `${colors.red('接続中')}` : `${colors.cyan('未接続')}`;
    const chargeCapacity = parseInt(obj['ce'], 16);
    const remainChargeCapacity = parseInt(obj['ce'], 16);   
    const v2hModeStatus = obj['da'];
    const vehicleID = obj['e6'];
    const emgStatus = obj['88'] == '41' ? `${colors.red.bold('YES')}` : `${colors.green('平常')}`;

    const items = [
        ['項目名', '値'],
        ['システム電源', pwr],
        ['ステータス', emgStatus],
        ['車両接続・充放電可否状態', carConnectChargeStatus],
        ['車両接続確認', carConnectStatus],
        ['車載電池の充電可能容量値', chargeCapacity],
        ['車載電池の充電可能残容量', remainChargeCapacity],
        ['運転モード設定', v2hModeStatus],
        ['車両ID', vehicleID],
    ];
    console.log(listit.setHeaderRow(items.shift()).d(items).toString());
}

function v2hWatchMessageHandler(rinfo, els, err) {
    const currentDateObj = new Date();
    if (err) {
        console.dir(err);
    } else {
        const matchedSEOJ = v2hDB[els['SEOJ']];
        const matchedDEOJ = v2hDB[els['DEOJ']];
        let seoj = els['SEOJ'];
        let deoj = els['DEOJ'];
        let esv = els['ESV'];
        let opc = els['OPC'];
        let seojName = '';
        let deojName = ''
        let valueName = '';
        let displayValue = '';
        const keys = Object.keys(els['DETAILs']);
        keys.forEach(key => {
            const elsDetailsValue = els['DETAILs'][key].toLowerCase();
            if (matchedSEOJ == undefined) {
                seojName = 'unknown';
                valueName = 'unknown';
                displayValue = `hex: ${elsDetailsValue}`;
            } else if (matchedSEOJ.values[key] == undefined) {
                seojName = matchedSEOJ['name'];
                valueName = 'unknown';
                displayValue = `hex: ${elsDetailsValue}`;
            } else {
                const type = matchedSEOJ.values[key].type;
                seojName = matchedSEOJ['name'];
                valueName = matchedSEOJ.values[key].name;

                if (type == 'list') {
                    displayValue = `${matchedSEOJ.values[key].values[elsDetailsValue]} (hex: ${elsDetailsValue})`
                } else if (type == 'hex') {
                    displayValue = `${parseInt(elsDetailsValue, 16)} (hex: ${elsDetailsValue})`
                } else if (type == 'raw') {
                    displayValue = `(hex: ${elsDetailsValue})`;
                }
            }

            if (matchedDEOJ == undefined) {
                deojName = 'unknown';
            } else {
                deojName = matchedDEOJ['name'];
            }
            writeLog(currentDateObj, `[${colors.yellow.bold(seojName)}(${seoj})->${colors.yellow.bold(deojName)}(${deoj})] ESV:${colors.green(esv)} OPC:${colors.blue(opc)} ${colors.yellow(valueName)}(${key}) : ${colors.yellow(displayValue)}`);
        });
    }
}

function v2hWatchCsvHandler(rinfo, els, err) {
    const currentDateObj = new Date();
    const currentTimeStamp = currentDateObj.toISOString();
    if (!err) {
        let seoj = els['SEOJ'];
        let deoj = els['DEOJ'];
        let esv = els['ESV'];
        let opc = els['OPC'];
        const keys = Object.keys(els['DETAILs']);
        keys.forEach(key => {
            const elsDetailsValue = els['DETAILs'][key].toLowerCase();
            let csvLine = `${currentTimeStamp},${seoj},${deoj},${esv},${opc},${key},${elsDetailsValue}`
            console.log(csvLine);
            fs.appendFileSync(`${v2hLaunchTimeStamp}.csv`, `${csvLine}\n`);
        });
    }
}

function writeLog(dateObj, arg) {
    const currentTimeStamp = dateObj.toISOString();
    console.log(`${currentTimeStamp} ${arg}`);
}

function sleep(interval) {
    return new Promise((resolve) => {
        setTimeout(() => { resolve() }, interval);
    });
} 
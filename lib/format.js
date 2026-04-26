const colors = require('colors');
const ListIt = require('list-it');

function createList() {
    return new ListIt({
        headerBold: true,
        headerUnderline: true,
    });
}

function formatDiscoveredDevices(devices) {
    const items = [
        ['IP address', 'Object ID'],
        ...devices.map((device) => [device.ip, device.objectId]),
    ];
    return createList().setHeaderRow(items.shift()).d(items).toString();
}

function formatStatus(status) {
    const table = status.table || {};
    const pwr = table['システム電源'] === 'ON' ? colors.red('ON') : colors.cyan('OFF');
    const emgStatus = table['異常発生状態'] === '異常' ? colors.red.bold('異常') : colors.green('平常');

    const items = [
        ['項目名', '値'],
        ['システム電源', pwr],
        ['ステータス', emgStatus],
        ['充電器タイプ', table['充電器タイプ']],
        ['定格充電能力(W)', table['定格充電能力(W)']],
        ['定格放電能力(W)', table['定格放電能力(W)']],
        ['車両接続・充放電可否状態', table['車両接続・充放電可否状態']],
        ['車載電池の充電可能容量値(Wh)', table['車載電池の充電可能容量値(Wh)']],
        ['車載電池の充電可能残容量(Wh)', table['車載電池の充電可能残容量(Wh)']],
        ['運転モード設定', table['運転モード設定']],
        ['車載電池の放電可能残容量(Wh)', table['車載電池の放電可能残容量(Wh)']],
        ['車載電池の放電可能残容量(%)', table['車載電池の放電可能残容量(%)']],
        ['車両ID', table['車両ID']],
        ['車載電池の残容量(Wh)', table['車載電池の残容量(Wh)']],
        ['車載電池の残容量(％)', table['車載電池の残容量(％)']],
        ['規格Version情報', table['規格Version情報']],
    ];

    return createList().setHeaderRow(items.shift()).d(items).toString();
}

module.exports = {
    formatDiscoveredDevices,
    formatStatus,
};

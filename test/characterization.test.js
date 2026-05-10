const test = require('node:test');
const assert = require('node:assert/strict');

const { extractV2hObjectIds } = require('../lib/discover');
const { buildStatus } = require('../lib/status');
const { formatDiscoveredDevices, formatStatus } = require('../lib/format');

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(value) {
  return String(value).replace(ANSI_RE, '');
}

function normalizeDynamicTableValues(value) {
  return String(value)
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<IP>')
    .replace(/\b[0-9a-fA-F]{6}\b/g, '<OBJECT_ID>');
}

function sampleRaw(overrides = {}) {
  return {
    '80': '30',
    '82': '1234',
    '88': '41',
    c2: '000001f4',
    c4: '00000032',
    c5: '00000fa0',
    c6: '00000bb8',
    c7: '43',
    cc: '23',
    ce: '000003e8',
    cf: '0000012c',
    da: '42',
    e2: '00000258',
    e4: '64',
    e6: 'abcd1234',
    ...overrides,
  };
}

test('extractV2hObjectIds: returns only 027e object ids from d5/d6 style payload', () => {
  const payload = '03027e010ef001027e02';
  assert.deepEqual(extractV2hObjectIds(payload), ['027e01', '027e02']);
});

test('extractV2hObjectIds: returns empty array for invalid payload', () => {
  assert.deepEqual(extractV2hObjectIds(null), []);
  assert.deepEqual(extractV2hObjectIds(''), []);
  assert.deepEqual(extractV2hObjectIds('01027e'), []);
});

test('buildStatus: maps charge/discharge availability into stable status fields/table', () => {
  const status = buildStatus({
    ip: '192.0.2.10',
    objectId: '027e01',
    raw: sampleRaw(),
    connectionCheckResponse: { ok: true, esv: '71', message: 'accepted' },
  });

  assert.equal(status.connectionStatus, 'CONNECTED');
  assert.equal(status.isVehicleConnected, true);
  assert.equal(status.vehicleConnection.canCharge, true);
  assert.equal(status.vehicleConnection.canDischarge, true);
  assert.equal(status.mode, 'CHARGE');
  assert.equal(status.socPct, 100);

  assert.equal(status.table['車両接続確認'], '受理 (ESV 0x71)');
  assert.equal(status.table['車両接続・充放電可否状態'], '車両接続・充電可・放電可 (0x43)');
  assert.equal(status.table['車両ID'], 'abcd1234');
  assert.equal(status.table['車載電池の残容量(％)'], 100);
});

test('buildStatus: treats 0xff vehicle connection availability as indeterminate', () => {
  const status = buildStatus({
    ip: '192.0.2.10',
    objectId: '027e01',
    raw: sampleRaw({ c7: 'ff' }),
  });

  assert.equal(status.connectionStatus, 'UNKNOWN');
  assert.equal(status.isVehicleConnected, false);
  assert.equal(status.vehicleConnection.isUnknown, true);
  assert.equal(status.table['車両接続・充放電可否状態'], '不定 (0xff)');
  assert.equal(status.table['車両ID'], 'ff');
});

test('buildStatus: disconnected case keeps 車両ID as ff', () => {
  const status = buildStatus({ ip: '192.0.2.11', objectId: '027e01', raw: { c7: '30' } });
  assert.equal(status.connectionStatus, 'DISCONNECTED');
  assert.equal(status.table['車両ID'], 'ff');
});

test('buildStatus: fallback handling for missing/unknown values', () => {
  const status = buildStatus({ ip: '192.0.2.12', objectId: '027e99', raw: {} });
  assert.equal(status.connectionStatus, 'UNKNOWN');
  assert.equal(status.mode, 'UNKNOWN');
  assert.equal(status.socPct, null);
  assert.equal(status.table['システム電源'], 'OFF');
  assert.equal(status.table['運転モード設定'], '取得できず');
  assert.equal(status.table['充電器タイプ'], '取得できず');
  assert.equal(status.table['車両接続確認'], '未実施');
  assert.equal(status.table['規格Version情報'], null);
});

test('formatDiscoveredDevices: stable table output', () => {
  const output = stripAnsi(formatDiscoveredDevices([
    { ip: '192.0.2.10', objectId: '027e01' },
    { ip: '192.0.2.11', objectId: '027e02' },
  ]));
  const normalized = normalizeDynamicTableValues(output);

  assert.match(normalized, /IP address/);
  assert.match(normalized, /Object ID/);
  const rows = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('<IP>'));

  assert.equal(rows.length, 2);
  rows.forEach((line) => {
    const cols = line.split(/\s+/).filter(Boolean);
    assert.equal(cols.length, 2);
    assert.equal(cols[0], '<IP>');
    assert.equal(cols[1], '<OBJECT_ID>');
  });
});

test('formatDiscoveredDevices: keeps stable column order', () => {
  const output = stripAnsi(formatDiscoveredDevices([
    { ip: '198.51.100.1', objectId: '0ef001' },
  ]));
  const normalized = normalizeDynamicTableValues(output);
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);

  assert.match(lines[0], /^IP address\s+Object ID$/);
});

test('formatStatus: stable table output for known values', () => {
  const status = buildStatus({
    ip: '192.0.2.10',
    objectId: '027e01',
    raw: sampleRaw(),
    connectionCheckResponse: { ok: true, esv: '71', message: 'accepted' },
  });

  const output = stripAnsi(formatStatus(status));
  assert.match(output, /項目名/);
  assert.match(output, /システム電源/);
  assert.match(output, /ON/);
  assert.match(output, /異常/);
  assert.match(output, /車両接続確認/);
  assert.match(output, /受理 \(ESV 0x71\)/);
  assert.match(output, /車両接続・充電可・放電可 \(0x43\)/);
  assert.match(output, /規格Version情報/);
  assert.match(output, /1234/);
});

test('formatStatus: keeps stable label order', () => {
  const output = stripAnsi(formatStatus({ table: {} }));
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
  const headerIndex = lines.findIndex((line) => line.includes('項目名') && line.includes('値'));
  assert.notEqual(headerIndex, -1);

  const dataLines = lines.slice(headerIndex + 2);
  const labels = dataLines.map((line) => line.split(/\s{2,}/)[0].replace(/\s+\(null\)$/, ''));
  assert.deepEqual(labels, [
    'システム電源',
    'ステータス',
    '充電器タイプ',
    '定格充電能力(W)',
    '定格放電能力(W)',
    '車両接続確認',
    '車両接続・充放電可否状態',
    '車載電池の充電可能容量値(Wh)',
    '車載電池の充電可能残容量(Wh)',
    '運転モード設定',
    '車載電池の放電可能残容量(Wh)',
    '車載電池の放電可能残容量(%)',
    '車両ID',
    '車載電池の残容量(Wh)',
    '車載電池の残容量(％)',
    '規格Version情報',
  ]);
});

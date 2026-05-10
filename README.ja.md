# v2h

ECHONET Lite 経由で V2H 機器を探索・状態取得・実験的に制御するための Node.js CLI / ライブラリです。

英語版: [README.md](./README.md)

## これは何か

`v2h` は、日本国内向け V2H 機器を ECHONET Lite で扱うための Node.js パッケージです。PoC 目的のツールとして作成しており、メンテナ環境ではニチコン VCG-666CN7 で動作確認しています。

## 注意事項

このプロジェクトは PoC および実地テスト目的です。商用利用、常時自動運用、安全上重要な制御に使うことは想定していません。

このソフトウェアの利用はすべて自己責任で行ってください。本ソフトウェアの利用に起因する機器故障、車両・バッテリーの損傷、データ損失、電力まわりの問題、金銭的損失、その他直接または間接の損害について、作者およびコントリビューターは一切責任を負いません。

制御コマンドを試す場合は、必ず dry-run から開始し、機器状態を確認してから実行してください。

## インストール

```bash
npm install v2h
```

## クイックスタート

```bash
npx v2h discover
npx v2h status --ip V2H_IP_ADDRESS
```

車両接続・充放電可否状態を更新してからステータスを表示する場合:

```bash
npx v2h status --ip V2H_IP_ADDRESS --probe-connection
```

`--probe-connection` は、ステータス取得前に車両接続確認 `EPC 0xCD=0x10` を1回送信します。充電・放電の開始コマンドではありませんが、ECHONET Lite の `SetC` 要求です。

## 制御CLI

制御コマンドはデフォルトで dry-run です。事前確認用プロパティを読み取り、`--execute` を指定しない限り運転モード設定 `SetC` は送信しません。

```bash
npx v2h control-status --ip V2H_IP_ADDRESS --probe-connection
npx v2h control charge --ip V2H_IP_ADDRESS --probe-connection
npx v2h control discharge --ip V2H_IP_ADDRESS --probe-connection
```

dry-run の結果が `safety.allowed: true` の場合だけ、1回だけ実行します。

```bash
npx v2h control charge --ip V2H_IP_ADDRESS --probe-connection --execute
npx v2h control discharge --ip V2H_IP_ADDRESS --probe-connection --execute
npx v2h control standby --ip V2H_IP_ADDRESS --probe-connection --execute
```

制御コマンドは運転モード設定 `EPC 0xDA` に対して1回だけ `SetC` を送信します。

- `charge`: `0xDA=0x42`
- `discharge`: `0xDA=0x43`
- `standby`: `0xDA=0x44`
- `stop`: `0xDA=0x47`

運転モード設定を送信する前に、動作状態 (`0x80`)、異常発生状態 (`0x88`)、車両接続・充放電可否状態 (`0xC7`)、現在の運転モード (`0xDA`)、Setプロパティマップ (`0x9E`) を確認します。高負荷にならないよう、要求は小さな間隔を空けて1件ずつ送信します。

`0xC7` の主な意味は以下です。

- `0x41`: 車両接続・充電可・放電不可
- `0x42`: 車両接続・充電不可・放電可
- `0x43`: 車両接続・充電可・放電可
- `0xFF`: 不定

## ステータス表示

`status --probe-connection` を使うと、車両接続確認の結果と、意味付きの車両接続・充放電可否状態を表示します。

```bash
npx v2h status --ip V2H_IP_ADDRESS --probe-connection
```

表示例:

```text
項目名                       値
---------------------------- -------------------------------
システム電源                 ON
ステータス                   平常
充電器タイプ                 DCタイプA(放電のみ)
定格充電能力(W)              5900
定格放電能力(W)              5900
車両接続確認                 受理 (ESV 0x71)
車両接続・充放電可否状態     車両接続・充電可・放電可 (0x43)
運転モード設定               放電
車載電池の放電可能残容量(Wh) 21700
車載電池の放電可能残容量(%)  63
車載電池の残容量(Wh)         31600
車載電池の残容量(％)         92
規格Version情報              00004a00
```

`0xC7` が `0xFF` の場合は、以下のように不定として表示します。

```text
車両接続・充放電可否状態     不定 (0xff)
```

## Raspberry Pi 実地テスト用スクリプト

`test/field/` 以下のスクリプトは手動の実機テスト補助用です。npm コマンドとしては登録していません。

ステータスログ:

```bash
bash test/field/raspi-status-check.sh --ip V2H_IP_ADDRESS --probe-connection
```

放電テスト:

```bash
bash test/field/raspi-discharge-test.sh --ip V2H_IP_ADDRESS --dry-run --probe-connection
bash test/field/raspi-discharge-test.sh --ip V2H_IP_ADDRESS --execute --probe-connection
bash test/field/raspi-discharge-test.sh --ip V2H_IP_ADDRESS --standby --probe-connection
```

充電テスト:

```bash
bash test/field/raspi-charge-test.sh --ip V2H_IP_ADDRESS --dry-run --probe-connection
bash test/field/raspi-charge-test.sh --ip V2H_IP_ADDRESS --execute --probe-connection
bash test/field/raspi-charge-test.sh --ip V2H_IP_ADDRESS --standby --probe-connection
```

ログはデフォルトで `~/v2h-logs` に保存されます。Raspberry Pi 用スクリプトは、実地テストで扱いやすかった以下の待ち時間をデフォルトにしています。

- ステータス確認: `--timeout 3000 --interval 100 --probe-delay 3000`
- 充電/放電テスト: `--timeout 3000 --interval 250 --probe-delay 3000`

`0xC7` が `0xFF` のままの場合は、`probe-delay` を長くして再確認します。

```bash
bash test/field/raspi-status-check.sh --ip V2H_IP_ADDRESS --probe-connection --probe-delay 10000
```

## Raspberry Pi へのローカルテスト一式の転送

Windows から実行します。

```powershell
powershell -ExecutionPolicy Bypass -File test\field\deploy-raspi-test.ps1 -PiHost raspberrypi.local -PiUser pi
```

転送後すぐに読み取り専用のステータス確認も実行する場合:

```powershell
powershell -ExecutionPolicy Bypass -File test\field\deploy-raspi-test.ps1 -PiHost raspberrypi.local -PiUser pi -V2HIp V2H_IP_ADDRESS -RunStatusCheck
```

デフォルトでは Raspberry Pi 上の `~/v2h-local-test` に展開されます。

## ライブラリとして使う

```js
const { controlV2h, discover, getStatus } = require('v2h');

const devices = await discover({
  timeoutMs: 5000,
  probeIp: 'V2H_IP_ADDRESS',
});

const status = await getStatus({
  ip: 'V2H_IP_ADDRESS',
  timeoutMs: 2500,
  probeConnection: true,
});

const dryRun = await controlV2h({
  ip: 'V2H_IP_ADDRESS',
  mode: 'charge',
  probeConnection: true,
});
```

## 対応機器

ニチコン VCG-666CN7: メンテナ環境で、ステータス取得、車両接続確認、充電モード、放電モード、待機モードを実験的に確認済みです。

その他の ECHONET Lite 対応 V2H 機器: 未確認です。

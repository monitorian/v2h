# v2h

Node.js CLI/library for discovering, reading, and experimentally controlling
V2H devices via ECHONET Lite.

Japanese documentation: [README.ja.md](./README.ja.md)

## What is this?

`v2h` is a Node.js package for working with Japanese V2H devices over ECHONET
Lite. It was created as a proof-of-concept tool and has been tested by the
maintainer with a Nichicon VCG-666CN7.

## Safety Notice

This project is for PoC and field-testing purposes only. It is not intended for
commercial use, unattended operation, or safety-critical control.

Use it entirely at your own risk. The author and contributors accept no
responsibility or liability for device failure, vehicle or battery damage, data
loss, power issues, financial loss, or any other direct or indirect damage
caused by using this software.

When testing control commands, always start with dry-run mode and confirm the
device state before sending any command.

## Install

```bash
npm install v2h
```

## Quick Start

```bash
npx v2h discover
npx v2h status --ip V2H_IP_ADDRESS
```

For status that first refreshes vehicle connection / charge-discharge
availability, use:

```bash
npx v2h status --ip V2H_IP_ADDRESS --probe-connection
```

`--probe-connection` sends one vehicle connection check
(`EPC 0xCD=0x10`) before reading status. It is not a charge or discharge command,
but it is still an ECHONET Lite `SetC` request.

## Control CLI

Control commands are dry-run by default. They read precheck properties first and
do not send operation mode `SetC` unless `--execute` is specified.

```bash
npx v2h control-status --ip V2H_IP_ADDRESS --probe-connection
npx v2h control charge --ip V2H_IP_ADDRESS --probe-connection
npx v2h control discharge --ip V2H_IP_ADDRESS --probe-connection
```

Only after dry-run reports `safety.allowed: true`, send one command:

```bash
npx v2h control charge --ip V2H_IP_ADDRESS --probe-connection --execute
npx v2h control discharge --ip V2H_IP_ADDRESS --probe-connection --execute
npx v2h control standby --ip V2H_IP_ADDRESS --probe-connection --execute
```

The control command sends one `SetC` for operation mode setting (`EPC 0xDA`):

- `charge` sends `0xDA=0x42`.
- `discharge` sends `0xDA=0x43`.
- `standby` sends `0xDA=0x44`.
- `stop` sends `0xDA=0x47`.

Before sending operation mode `SetC`, it checks operation status (`0x80`), fault
status (`0x88`), vehicle connection / charge-discharge availability (`0xC7`),
current operation mode (`0xDA`), and the Set property map (`0x9E`). Requests are
sent one at a time with a small interval to avoid high command load.

For `0xC7`, the relevant meanings are:

- `0x41`: vehicle connected, charge allowed, discharge not allowed
- `0x42`: vehicle connected, charge not allowed, discharge allowed
- `0x43`: vehicle connected, charge and discharge allowed
- `0xFF`: indeterminate

## Raspberry Pi Field Test Scripts

The scripts in `test/field/` are manual field-test helpers. They are not registered as npm
commands.

Status logging:

```bash
bash test/field/raspi-status-check.sh --ip V2H_IP_ADDRESS --probe-connection
```

Discharge test:

```bash
bash test/field/raspi-discharge-test.sh --ip V2H_IP_ADDRESS --dry-run --probe-connection
bash test/field/raspi-discharge-test.sh --ip V2H_IP_ADDRESS --execute --probe-connection
bash test/field/raspi-discharge-test.sh --ip V2H_IP_ADDRESS --standby --probe-connection
```

Charge test:

```bash
bash test/field/raspi-charge-test.sh --ip V2H_IP_ADDRESS --dry-run --probe-connection
bash test/field/raspi-charge-test.sh --ip V2H_IP_ADDRESS --execute --probe-connection
bash test/field/raspi-charge-test.sh --ip V2H_IP_ADDRESS --standby --probe-connection
```

Logs are written to `~/v2h-logs` by default. The Raspberry Pi scripts default to
moderate waits that worked well in field testing:

- status check: `--timeout 3000 --interval 100 --probe-delay 3000`
- charge/discharge test: `--timeout 3000 --interval 250 --probe-delay 3000`

If `0xC7` remains `0xFF`, retry with a longer probe delay:

```bash
bash test/field/raspi-status-check.sh --ip V2H_IP_ADDRESS --probe-connection --probe-delay 10000
```

## Deploy Local Test Bundle to Raspberry Pi

From Windows:

```powershell
powershell -ExecutionPolicy Bypass -File test\field\deploy-raspi-test.ps1 -PiHost raspberrypi.local -PiUser pi
```

Deploy and immediately run the read-only status check:

```powershell
powershell -ExecutionPolicy Bypass -File test\field\deploy-raspi-test.ps1 -PiHost raspberrypi.local -PiUser pi -V2HIp V2H_IP_ADDRESS -RunStatusCheck
```

The deployed files are placed under `~/v2h-local-test` on the Raspberry Pi by
default.

## Library Usage

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

## Supported Devices

Nichicon VCG-666CN7: experimental / tested by maintainer for status, connection
check, charge mode, discharge mode, and standby mode.

Other ECHONET Lite V2H devices: not yet confirmed.

# v2h

Node.js CLI/library for discovering and reading V2H devices via ECHONET Lite.

日本語の説明はこちら: [README.ja.md](./README.ja.md)

## What is this?

`v2h` is a Node.js package for working with Japanese V2H devices over ECHONET Lite.

## Install

```bash
npm install v2h
```

## Quick start

```bash
npx v2h discover
```

```js
const { getStatus, discover } = require('v2h');

const status = await getStatus({
  ip: 'V2H_IP_ADDRESS',
  timeoutMs: 2500,
});

const devices = await discover({
  timeoutMs: 5000,
  probeIp: 'V2H_IP_ADDRESS',
});
```

## Supported devices
Nichicon V2H: experimental / tested by maintainer
Other ECHONET Lite V2H devices: not yet confirmed

# Safety Rules for Codex

This repository contains real hardware control code for V2H systems.

## Critical Rules

- Do not modify hardware control timing without explicit human approval.
- Do not introduce tight loops.
- Do not introduce unlimited retry logic.
- Do not add setInterval below 1000ms.
- Do not directly call hardware APIs outside approved wrappers.
- Do not weaken CI, CODEOWNERS, workflow rules, or safety scripts.
- Do not use pull_request_target.
- Do not add secrets to workflows.

## Human Review Required

Any PR affecting:
- charging control
- ECHONET Lite
- service timing
- retry logic
- systemd service behavior
- scheduler behavior

must be explicitly reviewed by a human.

## CI Scope

CI may validate:
- build
- lint
- typecheck
- tests
- dangerous pattern detection

CI cannot validate:
- actual hardware behavior
- charging safety
- electrical safety
- real timing stability

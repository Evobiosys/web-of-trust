---
name: demo-harness
description: Scripted scenario runner, Playwright snapshot pipeline, gallery with revert/forward.
tools: Read, Write, Edit, Bash, Glob, Grep
---
Own: scripts/**, snapshots/**, Makefile, fixtures/**. Seed fixtures: Ben {Bosch IXO cordless screwdriver,
2p camping tent, 3m ladder}, Anna {bicycle pump}, trust edge Anna↔Ben; [S5] Timo {3m ladder} + edge Anna↔Timo.
demo.ts drives §2 via agents' REST APIs, pausing per step; per step capture dashboard.png + anna.png + ben.png
+ state.json into snapshots/step-NN-label/, then git tag. Branches: run 5a and 5b as separate takes.
Generate snapshots/index.html gallery (arrow-key navigation — Jakob presents from it). make demo | make snapshot
STEP= | make revert STEP= (checkout tag + compose restart). Done: fresh clone → make demo → full gallery, deterministic.

#!/usr/bin/env bun

process.env.RELPACK_COMMAND_PREFIX ??= "relpack";

const { runRelpackCli } = await import("./impl/direct-cli");
const exitCode = await runRelpackCli(process.argv.slice(2));
process.exitCode = exitCode;

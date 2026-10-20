import { AsyncLocalStorage } from "node:async_hooks";
import { realpath } from "node:fs/promises";

import { GrError } from "@reliverse/gr";
import type {
  createGrCampaignOwnerPushHost,
  createGrCampaignOwnerCommitHost,
} from "@reliverse/gr-action-runtime";

export type GrOwnerPushHost = ReturnType<typeof createGrCampaignOwnerPushHost>;
export type GrOwnerCommitHost = ReturnType<typeof createGrCampaignOwnerCommitHost>;
export interface GrOwnerTerminal {
  readonly tty: () => boolean;
  readonly uid: () => number;
}
const nativeTerminal: GrOwnerTerminal = {
  tty: () => process.stdin.isTTY === true && process.stderr.isTTY === true,
  uid: () => process.getuid?.() ?? -1,
};
const pushHosts = new AsyncLocalStorage<GrOwnerPushHost | undefined>();
const commitHosts = new AsyncLocalStorage<GrOwnerCommitHost | undefined>();
export function withGrOwnerPushHost<T>(host: GrOwnerPushHost | undefined, run: () => T): T {
  return pushHosts.run(host, run);
}
export function withGrOwnerCommitHost<T>(host: GrOwnerCommitHost | undefined, run: () => T): T {
  return commitHosts.run(host, run);
}
type Input = { readonly root: string; readonly apply: boolean; readonly interactive: boolean };
async function dispatch(
  input: Input,
  operation: "repo.push" | "repo.commit",
  host: GrOwnerPushHost | GrOwnerCommitHost | undefined,
  terminal: GrOwnerTerminal,
) {
  const name = operation === "repo.push" ? "push" : "commit";
  const code = `GR_OWNER_${name.toUpperCase()}`;
  if (!host) {
    if (input.apply)
      throw new GrError(
        "GR_NOT_AUTHORIZED",
        `${code}_HOST_NOT_ADMITTED: no trusted binding; no shell/source fallback.`,
      );
    return {
      operation: `gr.campaign.${name}`,
      capOperation: operation,
      status: "blocked",
      reason: `${code}_HOST_NOT_ADMITTED`,
      preview: true,
      automaticRetry: false,
    };
  }
  if (host.operation !== operation)
    throw new GrError("GR_NOT_AUTHORIZED", `${code}_OPERATION_MISMATCH`);
  if ((await realpath(input.root)) !== (await realpath(host.contextRoot)))
    throw new GrError("GR_NOT_AUTHORIZED", `${code}_CONTEXT_MISMATCH`);
  if (input.apply && (!input.interactive || !terminal.tty() || terminal.uid() !== host.ownerUid))
    throw new GrError(
      "GR_NOT_AUTHORIZED",
      `${code}_OWNER_TTY_REQUIRED: use --interactive --apply in the bound owner terminal.`,
    );
  const preview = await host.inspect();
  if (!input.apply) return { ...preview, preview: true };
  return host.execute();
}
export function dispatchGrOwnerPush(
  input: Input,
  host = pushHosts.getStore(),
  terminal = nativeTerminal,
) {
  return dispatch(input, "repo.push", host, terminal);
}
export function dispatchGrOwnerCommit(
  input: Input,
  host = commitHosts.getStore(),
  terminal = nativeTerminal,
) {
  return dispatch(input, "repo.commit", host, terminal);
}

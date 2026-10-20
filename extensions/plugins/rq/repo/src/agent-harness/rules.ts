import { defineRepositoryRule } from "../shared/rules";

export const REPO_AGENT_HARNESS_RULE_IDS = Object.freeze({
  boundedOutput: "repo.agent-harness.bounded-output",
  deterministicCatalog: "repo.agent-harness.deterministic-catalog",
  durableOverflow: "repo.agent-harness.durable-overflow",
  runtimeIntegration: "repo.agent-harness.runtime-integration",
  runtimePolicyIsolation: "repo.agent-harness.runtime-policy-isolation",
} as const);

export const REPO_AGENT_HARNESS_RULES = Object.freeze([
  defineRepositoryRule(
    "repo.agent-harness",
    "bounded-output",
    "Bounded model-visible output",
    "Every model-visible context item retains a declared default token limit.",
    "Unbounded tool output can destroy context efficiency and cache economics.",
    "Restore the 10,000-token default and explicit per-item limits.",
  ),
  defineRepositoryRule(
    "repo.agent-harness",
    "deterministic-catalog",
    "Deterministic capability catalog",
    "Model-visible capabilities use deterministic ordering and digesting.",
    "Unstable tool ordering changes the prompt prefix without semantic changes.",
    "Restore canonical sorting and catalog digest receipts.",
  ),
  defineRepositoryRule(
    "repo.agent-harness",
    "durable-overflow",
    "Durable context overflow",
    "Oversized context is preserved as a retrievable artifact instead of silently truncated.",
    "Optimization must not destroy evidence or hide omitted output.",
    "Restore the filesystem artifact writer and fail-closed overflow path.",
  ),
  defineRepositoryRule(
    "repo.agent-harness",
    "runtime-policy-isolation",
    "Runtime policy isolation",
    "Approval and capability policy retain a digest separate from the static prefix.",
    "Dynamic policy in static tool definitions lowers prompt-cache hit rates.",
    "Keep runtime policy outside prefix assembly and static operation contracts.",
  ),
  defineRepositoryRule(
    "repo.agent-harness",
    "runtime-integration",
    "Context runtime integration",
    "Rse Runs persist Context Epoch receipts before provider execution.",
    "Inspector output must be based on durable assembly evidence rather than reconstructed logs.",
    "Restore Context Assembly persistence and inspector operations in the runtime boundary.",
  ),
]);

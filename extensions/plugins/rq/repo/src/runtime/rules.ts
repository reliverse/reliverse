import { defineRepositoryRule } from "../shared/rules";

export const REPO_RUNTIME_RULE_IDS = Object.freeze({
  sot: "repo.runtime.sot",
  architectureIndex: "repo.runtime.architecture-index",
  rseRvsSurface: "repo.runtime.rse-rvs-surface",
  rdgLifecycle: "repo.runtime.rdg-lifecycle",
  rvsRoot: "repo.runtime.rvs-root",
  retiredSurface: "repo.runtime.retired-surface",
  localDocLink: "repo.runtime.local-doc-link",
} as const);

export const REPO_RUNTIME_RULES = Object.freeze([
  defineRepositoryRule(
    "repo.runtime",
    "sot",
    "Runtime ownership SOT",
    "Runtime architecture documents retain reviewed ownership invariants.",
    "Deployment authority must remain explicit across BDI, RDG, RVS, and FSG.",
    "Restore the missing ownership statement in the canonical SOT.",
  ),
  defineRepositoryRule(
    "repo.runtime",
    "architecture-index",
    "Runtime architecture index",
    "The architecture index exposes runtime boundary and removal-readiness documents.",
    "Canonical architecture decisions must be discoverable from the index.",
    "Link both SOT documents from the architecture index.",
  ),
  defineRepositoryRule(
    "repo.runtime",
    "rse-rvs-surface",
    "Bounded Rse to RVS surface",
    "Rse forwards only the bounded RVS mint-local operation.",
    "Agent recommendation must not acquire release or deployment authority.",
    "Remove release/deploy forwarding and retain mint-local only.",
  ),
  defineRepositoryRule(
    "repo.runtime",
    "rdg-lifecycle",
    "Standalone RDG lifecycle",
    "RDG remains a standalone Rempts CLI rather than an RVS-hosted plugin.",
    "RDG owns deployment/release decisions while RVS remains the bounded host execution authority.",
    "Keep apps/cli/rdg as the canonical host and leave the historical RVS RDG plugin retired.",
  ),
  defineRepositoryRule(
    "repo.runtime",
    "rvs-root",
    "RVS path ownership",
    "RVS documentation and help distinguish caller-selected roots from RVS Home.",
    "Fixture/import/export inputs are not canonical runtime state roots.",
    "Restore the path ownership language and remove canonical .rvs examples.",
  ),
  defineRepositoryRule(
    "repo.runtime",
    "retired-surface",
    "Retired runtime surface",
    "Removed deployment scripts and OS plugin paths do not reappear.",
    "These surfaces violated the reviewed runtime ownership boundary.",
    "Remove the retired path and use current RVS/RDG ownership.",
  ),
  defineRepositoryRule(
    "repo.runtime",
    "local-doc-link",
    "RVS local documentation link",
    "Local links in the nested RVS README resolve from that package.",
    "Package documentation must remain navigable without repository-root assumptions.",
    "Correct the local Markdown target.",
  ),
]);

import { defineRepositoryRule } from "../shared/rules";

export const REPO_RSE_THIN_HOST_RULE_IDS = Object.freeze({
  sot: "repo.rse-thin-host.sot",
  zeroIntelligenceCore: "repo.rse-thin-host.zero-intelligence-core",
} as const);

export const REPO_RSE_THIN_HOST_RULES = Object.freeze([
  defineRepositoryRule(
    "repo.rse-thin-host",
    "sot",
    "Rse thin-host SOT",
    "The canonical Rse thin-host architecture and source composition remain coherent.",
    "Without an explicit SOT, host-package debt can be mistaken for product ownership.",
    "Reconcile the thin-host spec and implementation before changing ownership boundaries.",
  ),
  defineRepositoryRule(
    "repo.rse-thin-host",
    "zero-intelligence-core",
    "Zero-intelligence Rse core",
    "The Rse CLI, reusable Gateway package, and thin Gateway app stay free of direct AI/provider SDK ownership.",
    "Optional inference dependencies in the core closure make llm=false physically depend on intelligence runtimes and enlarge every install.",
    "Materialize optional Engine/provider implementations through RPR-backed Cap bindings instead of adding them to the core host.",
  ),
]);

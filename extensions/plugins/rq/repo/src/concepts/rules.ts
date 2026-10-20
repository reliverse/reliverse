import { defineRepositoryRule } from "../shared/rules";

export const REPO_CONCEPT_RULE_IDS = Object.freeze({
  retiredRseNc: "repo.concepts.retired-rse-nc",
} as const);

export const REPO_CONCEPT_RULES = Object.freeze([
  defineRepositoryRule(
    "repo.concepts",
    "retired-rse-nc",
    "Retired Node Capsule ownership",
    "Current operational sources do not depend on Node Capsule.",
    "Node Capsule is retired; surviving supply semantics belong to RPR, repository transfer to GR, build orchestration to Dler/RDG, and execution policy to RQ/RVS.",
    "Migrate current NC references to the owning RPR, GR, Dler/RDG, RQ, or RVS surface; keep historical evidence explicitly historical.",
  ),
]);

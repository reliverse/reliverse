import { defineRepositoryRule } from "../shared/rules";

export const REPO_TYPE_SUPPLY_RULE_IDS = Object.freeze({
  catalogPin: "repo.type-supply.catalog-pin",
  rootConsumer: "repo.type-supply.root-consumer",
  customShim: "repo.type-supply.custom-shim",
} as const);

export const REPO_TYPE_SUPPLY_RULES = Object.freeze([
  defineRepositoryRule(
    "repo.type-supply",
    "catalog-pin",
    "Official type catalog pin",
    "Official Bun and Node type packages use reviewed exact catalog versions.",
    "One exact type supply keeps ambient runtime declarations reproducible.",
    "Restore the reviewed catalog version.",
  ),
  defineRepositoryRule(
    "repo.type-supply",
    "root-consumer",
    "Root type supply consumer",
    "The root consumes official type packages through the workspace catalog.",
    "Root toolchain ownership ensures the official declarations are available to all projects.",
    "Declare the type package as catalog: in root devDependencies.",
  ),
  defineRepositoryRule(
    "repo.type-supply",
    "custom-shim",
    "No custom runtime type shim",
    "Repository sources do not replace official runtime declarations with handwritten shims.",
    "Custom runtime shims drift from Bun and Node's maintained type supply.",
    "Remove the shim and use official @types/bun and @types/node declarations.",
  ),
]);

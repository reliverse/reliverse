import type { QualityRuleDeclaration } from "@reliverse/quality";

export const REPO_NAMING_RULE_IDS = Object.freeze({
  adapterDirection: "repo.naming.adapter-direction",
  atomicFamily: "repo.naming.atomic-family",
  bindingEvidence: "repo.naming.binding-evidence",
  bindingKnown: "repo.naming.binding-known",
  directoryAlignment: "repo.naming.directory-alignment",
  duplicateToken: "repo.naming.duplicate-token",
  legacyPattern: "repo.naming.legacy-pattern",
  packageCollision: "repo.naming.package-collision",
  packageShape: "repo.naming.package-shape",
  pluginContract: "repo.naming.plugin-contract",
  roleKnown: "repo.naming.role-known",
  scopeOwnership: "repo.naming.scope-ownership",
  selfBinding: "repo.naming.self-binding",
  semanticElision: "repo.naming.semantic-elision",
  workspaceReferences: "repo.naming.workspace-references",
} as const);

export const REPO_NAMING_RULES: readonly QualityRuleDeclaration[] = Object.freeze([
  {
    id: REPO_NAMING_RULE_IDS.packageShape,
    diagnosticId: "RQ-REPO-NAMING-PACKAGE-SHAPE",
    capabilityId: "repo.naming",
    title: "Package identity shape",
    description: "Workspace package identities use a supported scoped package shape.",
    explanation:
      "Reliverse package identities use a lowercase npm scope and one kebab-case package segment before family-first interpretation begins.",
    defaultSeverity: "error",
    remediation: { kind: "plan", summary: "Rename the package to a valid scoped identity." },
  },
  {
    id: REPO_NAMING_RULE_IDS.atomicFamily,
    diagnosticId: "RQ-REPO-NAMING-ATOMIC-FAMILY",
    capabilityId: "repo.naming",
    title: "Atomic family identity",
    description: "Established compound product families remain indivisible in package names.",
    explanation:
      "Names such as rse-skills and rse-config are stable families. They must not be mechanically split into feature plus host binding.",
    defaultSeverity: "warning",
    remediation: { kind: "plan", summary: "Use the registered atomic family identity." },
  },
  {
    id: REPO_NAMING_RULE_IDS.roleKnown,
    diagnosticId: "RQ-REPO-NAMING-ROLE-KNOWN",
    capabilityId: "repo.naming",
    title: "Known package role",
    description: "Extension package roles agree with the registered role vocabulary.",
    explanation:
      "Role suffixes such as plugin, addon, client, provider, and store describe package responsibility and must use the canonical vocabulary.",
    defaultSeverity: "error",
    remediation: { kind: "plan", summary: "Choose the canonical role for this package." },
  },
  {
    id: REPO_NAMING_RULE_IDS.bindingKnown,
    diagnosticId: "RQ-REPO-NAMING-BINDING-KNOWN",
    capabilityId: "repo.naming",
    title: "Known binding",
    description: "Product and runtime bindings use registered stable identities.",
    explanation:
      "A binding is a concrete host, runtime, framework, backend, or provider contract. Unknown binding tokens require an explicit naming decision.",
    defaultSeverity: "error",
    remediation: { kind: "manual", summary: "Register or correct the package binding." },
  },
  {
    id: REPO_NAMING_RULE_IDS.semanticElision,
    diagnosticId: "RQ-REPO-NAMING-SEMANTIC-ELISION",
    capabilityId: "repo.naming",
    title: "Semantic elision",
    description: "Package identities omit tokens already encoded by the family or role.",
    explanation:
      "Family, binding, role, and variant tokens should appear only when they add information. Repetition creates names such as rse-gateway-gateway or dler-rse-rempts-plugin.",
    defaultSeverity: "error",
    remediation: { kind: "plan", summary: "Remove the redundant semantic token." },
  },
  {
    id: REPO_NAMING_RULE_IDS.bindingEvidence,
    diagnosticId: "RQ-REPO-NAMING-BINDING-EVIDENCE",
    capabilityId: "repo.naming",
    title: "Binding evidence",
    description: "A declared binding is supported by repository placement or dependencies.",
    explanation:
      "Bindings are architectural claims. A package should not name a target product or runtime when neither its path nor its dependency contract supports that relationship.",
    defaultSeverity: "warning",
    remediation: { kind: "manual", summary: "Add binding evidence or remove the binding token." },
  },
  {
    id: REPO_NAMING_RULE_IDS.directoryAlignment,
    diagnosticId: "RQ-REPO-NAMING-DIRECTORY-ALIGNMENT",
    capabilityId: "repo.naming",
    title: "Extension directory alignment",
    description: "Extension package identities agree with role-first repository placement.",
    explanation:
      "The path extensions/<role>/<binding>/<family> and package identity <family>-<binding>-<role> represent the same coordinates in opposite navigation order.",
    defaultSeverity: "error",
    remediation: { kind: "plan", summary: "Align the package identity with its extension path." },
  },
  {
    id: REPO_NAMING_RULE_IDS.selfBinding,
    diagnosticId: "RQ-REPO-NAMING-SELF-BINDING",
    capabilityId: "repo.naming",
    title: "No self-binding",
    description: "A family does not repeat itself as its own binding.",
    explanation:
      "A name such as rse-rse-plugin usually indicates that the family and target binding were derived mechanically instead of semantically.",
    defaultSeverity: "error",
    remediation: { kind: "plan", summary: "Remove the duplicated self-binding." },
  },
  {
    id: REPO_NAMING_RULE_IDS.duplicateToken,
    diagnosticId: "RQ-REPO-NAMING-DUPLICATE-TOKEN",
    capabilityId: "repo.naming",
    title: "No duplicate naming token",
    description: "A package identity does not repeat the same semantic token.",
    explanation:
      "Repeated tokens usually reveal an incorrectly composed family, binding, or role and make autocomplete families harder to read.",
    defaultSeverity: "error",
    remediation: { kind: "plan", summary: "Remove or reinterpret the duplicate token." },
  },
  {
    id: REPO_NAMING_RULE_IDS.adapterDirection,
    diagnosticId: "RQ-REPO-NAMING-ADAPTER-DIRECTION",
    capabilityId: "repo.naming",
    title: "Adapter direction",
    description: "Adapter names state source family before target binding.",
    explanation:
      "The canonical direction is <source-family>-<target-binding>-adapter. A bare adapter role lacks the target contract needed to interpret its direction.",
    defaultSeverity: "warning",
    remediation: { kind: "manual", summary: "Name the adapter source and target explicitly." },
  },
  {
    id: REPO_NAMING_RULE_IDS.scopeOwnership,
    diagnosticId: "RQ-REPO-NAMING-SCOPE-OWNERSHIP",
    capabilityId: "repo.naming",
    title: "Scope ownership",
    description: "Package scope agrees with repository ownership and package location.",
    explanation:
      "Reliverse product and tooling packages use @reliverse, repository-private app and configuration packages use @repo, and UI package families use their dedicated scopes.",
    defaultSeverity: "error",
    remediation: { kind: "plan", summary: "Move the package to its owning scope or location." },
  },
  {
    id: REPO_NAMING_RULE_IDS.packageCollision,
    diagnosticId: "RQ-REPO-NAMING-PACKAGE-COLLISION",
    capabilityId: "repo.naming",
    title: "Unique package identity",
    description: "Every workspace package name has one owner.",
    explanation:
      "Duplicate package identities make workspace dependency resolution and publication ownership ambiguous.",
    defaultSeverity: "error",
    remediation: { kind: "plan", summary: "Assign a unique canonical identity to each workspace." },
  },
  {
    id: REPO_NAMING_RULE_IDS.pluginContract,
    diagnosticId: "RQ-REPO-NAMING-PLUGIN-CONTRACT",
    capabilityId: "repo.naming",
    title: "Plugin contract identity",
    description: "Packages under extensions/plugins participate in the Rempts plugin contract.",
    explanation:
      "A package placed under extensions/plugins is a Rempts extension package and must declare @reliverse/rempts as a dependency or peer dependency.",
    defaultSeverity: "error",
    remediation: {
      kind: "manual",
      summary: "Declare the Rempts plugin contract or move the package.",
    },
  },
  {
    id: REPO_NAMING_RULE_IDS.workspaceReferences,
    diagnosticId: "RQ-REPO-NAMING-WORKSPACE-REFERENCES",
    capabilityId: "repo.naming",
    title: "Workspace package references",
    description: "Internal dependency references resolve to installed workspace identities.",
    explanation:
      "Dependencies using Reliverse-owned npm scopes must resolve to a workspace package during repository development, preventing stale names after migrations.",
    defaultSeverity: "error",
    remediation: {
      kind: "plan",
      summary: "Update the dependency to the canonical workspace identity.",
    },
  },
  {
    id: REPO_NAMING_RULE_IDS.legacyPattern,
    diagnosticId: "RQ-REPO-NAMING-LEGACY-PATTERN",
    capabilityId: "repo.naming",
    title: "Legacy extension identity",
    description:
      "Existing surface-first extension names are migration debt and new ones are forbidden.",
    explanation:
      "Legacy names such as plugin-rse-dler predate the family-first policy. They remain warnings until the reviewed migration stage updates identities and references together.",
    defaultSeverity: "warning",
    remediation: { kind: "plan", summary: "Use the reviewed family-first migration proposal." },
  },
]);

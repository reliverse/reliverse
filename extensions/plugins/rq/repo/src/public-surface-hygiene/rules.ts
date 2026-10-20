import { defineRepositoryRule } from "../shared/rules";

export const REPO_PUBLIC_SURFACE_HYGIENE_RULE_IDS = Object.freeze({
  misleadingReleaseLabel: "repo.public-surface-hygiene.misleading-release-label",
  ownerLocalPath: "repo.public-surface-hygiene.owner-local-path",
  privateTransitionLabel: "repo.public-surface-hygiene.private-transition-label",
});

export const REPO_PUBLIC_SURFACE_HYGIENE_RULES = Object.freeze([
  defineRepositoryRule(
    "repo.public-surface-hygiene",
    "owner-local-path",
    "Portable public paths",
    "Public source and documentation use role-based or repository-relative examples instead of a contributor's local home path.",
    "Owner-local paths leak private workstation details and make otherwise reusable instructions misleading.",
    "Replace the named home principal with a role placeholder such as /home/user or a repository-relative path.",
    "error",
  ),
  defineRepositoryRule(
    "repo.public-surface-hygiene",
    "private-transition-label",
    "Private transition labels stay private",
    "Public surfaces do not expose private GR transition labels such as grt_<number>.",
    "Transition labels are coordination evidence rather than durable product or release identities.",
    "Move the evidence under a private area or replace the label with the stable public concept it represents.",
    "error",
  ),
  defineRepositoryRule(
    "repo.public-surface-hygiene",
    "misleading-release-label",
    "Internal transitions are not releases",
    "Public prose does not describe a GR transition or internal stage label as a release or product version.",
    "Internal sequencing must not be mistaken for a supported public release line.",
    "Describe the stable public capability and keep transition sequencing in private handoff evidence.",
    "error",
  ),
]);

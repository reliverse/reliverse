import crypto from "node:crypto";
import path from "node:path";

import { ARCHIVE_SHA256SUMS_PATH, PLATFORM_NOTES_DIR, RSPACE_STATE_PATH } from "./constants";
import { stringifyState } from "./state";
import type { RspacePlatform, RspaceState } from "./types";

export function createGeneratedFiles(state: RspaceState): Map<string, string> {
  const files = new Map<string, string>();

  files.set(state.entryFile, createEntryFile(state));
  files.set("AGENTS.md", createAgents(state));
  files.set("IDENTITY.md", createIdentity(state));
  files.set("TOOLS.md", createTools());
  files.set("MEMORY.md", createMemory(state));
  files.set("ARCHIVE_MANIFEST.md", createManifest(state));
  files.set(RSPACE_STATE_PATH, stringifyState(state));
  files.set(`${PLATFORM_NOTES_DIR}/generic.md`, createPlatformNotes("generic"));
  files.set(`${PLATFORM_NOTES_DIR}/chatgpt.md`, createPlatformNotes("chatgpt"));
  files.set(`${PLATFORM_NOTES_DIR}/openclaw.md`, createPlatformNotes("openclaw"));
  files.set(`${PLATFORM_NOTES_DIR}/bleverse.md`, createPlatformNotes("bleverse"));

  files.set(ARCHIVE_SHA256SUMS_PATH, createChecksums(files));

  return sortFileMap(files);
}

function createEntryFile(state: RspaceState): string {
  return trimMd(`
# Start here

This is an Rspace: a provider-agnostic portable home for an Rse agent.

Read in this order:

1. \`AGENTS.md\`
2. \`IDENTITY.md\`
3. \`${RSPACE_STATE_PATH}\`
4. \`MEMORY.md\`
5. \`TOOLS.md\`
6. relevant files under \`${PLATFORM_NOTES_DIR}/\`
${state.source.targetPath ? `7. imported source files under \`${state.source.targetPath}/\`` : "7. no imported source files are present yet"}

When continuing work, preserve the Rspace protocol files and return an updated workspace or archive.
`);
}

function createAgents(state: RspaceState): string {
  return trimMd(`
# Rspace agent instructions

You are working inside a portable Rse workspace.

Rules:

- Treat \`${RSPACE_STATE_PATH}\` as the machine-readable source of truth.
- Treat \`ARCHIVE_MANIFEST.md\` as the human-readable summary.
- Preserve provider-neutral files unless the user explicitly asks to change the protocol.
- Keep platform-specific guidance under \`${PLATFORM_NOTES_DIR}/\`.
${state.source.targetPath ? `- Keep imported source content under \`${state.source.targetPath}/\`.` : "- Do not create imported source content unless the task requires it."}
- Do not include secrets, private tokens, \`.env\` files, \`node_modules\`, build outputs, or full chat transcripts.
- Prefer small, durable notes over long conversation dumps.
- When creating an archive, include full current versions of every file listed in \`${RSPACE_STATE_PATH}\`.
`);
}

function createIdentity(state: RspaceState): string {
  return trimMd(`
# Rspace identity

Name: ${state.name}  
${state.team ? `Team: ${state.team}  ` : ""}
Kind: ${state.kind}  
Protocol: ${state.protocol}  
Entry file: ${state.entryFile}  
Primary platform: ${state.platform}  
Optimized for: ${state.optimizedFor.join(", ")}  
Created by: ${state.createdBy}  
Created at: ${state.createdAt}  

## Imported source

Kind: ${state.source.kind}  
${state.source.name ? `Name: ${state.source.name}  ` : ""}
${state.source.team ? `Team: ${state.source.team}  ` : ""}
${state.source.customPath ? `Custom path: ${state.source.customPath}  ` : ""}
${state.source.originalPath ? `Original path hint: ${state.source.originalPath}  ` : ""}
${state.source.targetPath ? `Target path: ${state.source.targetPath}  ` : ""}
Imported files: ${state.source.fileCount}
`);
}

function createTools(): string {
  return trimMd(`
# Rspace tools

Recommended commands:

\`\`\`bash
tar -tzf ./name.rse.tar.gz
tar -xzf ./name.rse.tar.gz -C ./target
\`\`\`

When using \`@reliverse/rspace-rse-plugin\`:

\`\`\`bash
rse rspace --name spock --team reliverse --output ./spock.rse --apply
rse rspace --name spock --team reliverse --input ./agent --output ./spock.rse --apply
rse rspace pack --input ./spock.rse --output ./spock.rse.tar.gz --apply
rse rspace verify --input ./spock.rse.tar.gz
rse rspace doctor
\`\`\`

Use \`--overwrite\` only when replacing an existing output path is intended.
`);
}

function createMemory(state: RspaceState): string {
  return trimMd(`
# Rspace memory

- This workspace is provider-agnostic by default.
- Platform-specific behavior belongs in \`${PLATFORM_NOTES_DIR}/\`.
${state.source.targetPath ? `- Imported source files are stored under \`${state.source.targetPath}/\`.` : "- This Rspace was created without imported source files."}
- Current primary platform: \`${state.platform}\`.
`);
}

function createManifest(state: RspaceState): string {
  const files = state.files.map((file) => `- ${file}`).join("\n");

  return trimMd(`
# ${state.name} Rspace archive manifest

Protocol: ${state.protocol}  
Kind: ${state.kind}  
${state.team ? `Team: ${state.team}  ` : ""}
Entry file: ${state.entryFile}  
Primary platform: ${state.platform}  
Optimized for: ${state.optimizedFor.join(", ")}  
Updated at: ${state.updatedAt}  

## Imported source

- Kind: ${state.source.kind}
- Files: ${state.source.fileCount}
${state.source.team ? `- Team: ${state.source.team}` : ""}
${state.source.customPath ? `- Custom path: ${state.source.customPath}` : ""}
${state.source.targetPath ? `- Target path: ${state.source.targetPath}` : ""}

## Files

${files}
`);
}

function createPlatformNotes(platform: RspacePlatform): string {
  if (platform === "chatgpt") {
    return trimMd(`
# ChatGPT platform notes

Use this Rspace as a portable context capsule.

Guidelines:

- Prefer concise summaries and cumulative archives.
- Do not assume direct access to the user's local repository.
- Return updated files as a verified sandbox archive when file transfer is requested.
- Keep context-recovery instructions short and explicit.
`);
  }

  if (platform === "openclaw") {
    return trimMd(`
# OpenClaw platform notes

Use this Rspace as an agent workspace capsule.

Guidelines:

- Prefer direct filesystem operations when the workspace is mounted locally.
- Keep \`AGENTS.md\` concise and actionable.
- Keep long-term durable notes in \`MEMORY.md\`.
- Do not place credentials, auth profiles, runtime session state, or private machine config in the Rspace.
`);
  }

  if (platform === "bleverse") {
    return trimMd(`
# Bleverse platform notes

Use this Rspace as user-owned portable agent state.

Guidelines:

- Treat the Rspace as private user data unless explicitly published.
- Keep platform UI metadata separate from provider-neutral agent memory.
- Avoid leaking private project context into public surfaces.
- Prefer explicit import/export flows.
`);
  }

  return trimMd(`
# Generic platform notes

Use this Rspace as a provider-agnostic portable home for an Rse agent.

Guidelines:

- Keep canonical instructions platform-neutral.
- Keep platform-specific guidance isolated under \`${PLATFORM_NOTES_DIR}/\`.
- Prefer deterministic files over hidden runtime state.
`);
}

function createChecksums(files: Map<string, string>): string {
  return `${[...files.entries()]
    .filter(([filePath]) => filePath !== ARCHIVE_SHA256SUMS_PATH)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([filePath, content]) => {
      const hash = crypto.createHash("sha256").update(content).digest("hex");
      return `${hash}  ${toChecksumPath(filePath)}`;
    })
    .join("\n")}\n`;
}

function sortFileMap(files: Map<string, string>): Map<string, string> {
  return new Map([...files.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function toChecksumPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function trimMd(value: string): string {
  return `${value.trim()}\n`;
}

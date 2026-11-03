import {
  createDcsEditorDescriptor,
  digestCanonicalJson,
  type ConfigContractBundle,
  type DcsEditorFieldDescriptor,
  type JsonSchema,
  type JsonValue,
} from "@reliverse/dcs-contract";

export const DCS_REACT_UI_CODEGEN_VERSION = "0.0.1" as const;

export type DcsUiFramework = "react";
export type DcsUiPreset = "react-headless" | "tailwind-shadcn-v4";
/** Legacy flag value accepted by the CLI and normalized to tailwind-shadcn-v4. */
export type DcsUiCssFramework = "tailwind-shadcn-preset" | "tailwind-shadcn-v4";

export interface DcsReactUiGenerateOptions {
  readonly bundle: ConfigContractBundle;
  readonly endpoint?: string;
  readonly emitTheme?: boolean;
  readonly preset: DcsUiPreset;
}

export interface DcsReactGeneratedFile {
  readonly content: string;
  readonly filename: string;
}

export interface DcsReactUiGeneration {
  readonly componentName: string;
  readonly contractDigest: string;
  readonly files: readonly DcsReactGeneratedFile[];
  readonly manifest: {
    readonly contractId: string;
    readonly contractVersion: number;
    readonly generatorVersion: typeof DCS_REACT_UI_CODEGEN_VERSION;
    readonly preset: DcsUiPreset;
  };
}

export function isDcsUiPreset(value: string): value is DcsUiPreset {
  return value === "react-headless" || value === "tailwind-shadcn-v4";
}

export function normalizeDcsUiPreset(input: {
  readonly cssFramework?: string;
  readonly preset?: string;
}): DcsUiPreset {
  if (input.preset !== undefined) {
    if (!isDcsUiPreset(input.preset)) {
      throw new TypeError(`Unsupported DCS UI preset ${JSON.stringify(input.preset)}.`);
    }
    return input.preset;
  }
  if (
    input.cssFramework === "tailwind-shadcn-preset" ||
    input.cssFramework === "tailwind-shadcn-v4"
  ) {
    return "tailwind-shadcn-v4";
  }
  if (input.cssFramework !== undefined) {
    throw new TypeError(`Unsupported DCS CSS framework ${JSON.stringify(input.cssFramework)}.`);
  }
  return "tailwind-shadcn-v4";
}

/**
 * Builds owned TSX source. DCS never rewrites project routes or global CSS;
 * the output is safe to import explicitly from a product application.
 */
export async function generateDcsReactUi(
  options: DcsReactUiGenerateOptions,
): Promise<DcsReactUiGeneration> {
  const descriptor = createDcsEditorDescriptor(options.bundle);
  const contractDigest = await digestCanonicalJson(options.bundle as unknown as JsonValue);
  const componentName = `${toPascalCase(options.bundle.$dcs.fileStem)}Config`;
  const endpoint = options.endpoint ?? `/api/dcs/${options.bundle.$dcs.fileStem}`;
  const fields = descriptor.fields.filter((field) => !isContainerOnly(field));
  const files = [
    file(
      `${componentName}Form.tsx`,
      renderForm({ componentName, endpoint, fields, preset: options.preset }),
    ),
    file(
      `${componentName}ConflictDialog.tsx`,
      renderConflictDialog({ componentName, preset: options.preset }),
    ),
    file(
      `${componentName}Provenance.tsx`,
      renderProvenance({ componentName, preset: options.preset }),
    ),
    file(
      `${kebab(options.bundle.$dcs.fileStem)}-config-client.ts`,
      renderClient(componentName, endpoint),
    ),
    file(`${kebab(options.bundle.$dcs.fileStem)}-config-types.ts`, renderTypes(componentName)),
    file(
      `${kebab(options.bundle.$dcs.fileStem)}-config-server.ts`,
      renderServerStub(componentName, options.bundle.$dcs.id),
    ),
  ];
  if (options.emitTheme === true && options.preset === "tailwind-shadcn-v4") {
    files.push(file("dcs-theme.css", renderThemeCss()));
  }
  const manifest = {
    contractId: options.bundle.$dcs.id,
    contractVersion: options.bundle.$dcs.contractVersion,
    generatorVersion: DCS_REACT_UI_CODEGEN_VERSION,
    preset: options.preset,
  } as const;
  files.push(
    file(
      "dcs-ui.manifest.json",
      `${JSON.stringify(
        {
          $dcs: { format: "dcs-ui-manifest", version: DCS_REACT_UI_CODEGEN_VERSION },
          ...manifest,
          contractDigest,
          files: files.map((entry) => entry.filename).sort(),
        },
        null,
        2,
      )}\n`,
    ),
  );
  return Object.freeze({
    componentName,
    contractDigest,
    files: Object.freeze(files),
    manifest: Object.freeze(manifest),
  });
}

function file(filename: string, content: string): DcsReactGeneratedFile {
  return Object.freeze({ filename, content });
}

function renderForm(input: {
  readonly componentName: string;
  readonly endpoint: string;
  readonly fields: readonly DcsEditorFieldDescriptor[];
  readonly preset: DcsUiPreset;
}): string {
  const typeImport = `import type { ${input.componentName}Patch, ${input.componentName}Session } from "./${kebab(input.componentName.replace(/Config$/, ""))}-config-types";`;
  if (input.preset === "react-headless") {
    return `"use client";\n\nimport * as React from "react";\n${typeImport}\n\nexport interface ${input.componentName}FormProps {\n  readonly session: ${input.componentName}Session;\n  readonly onPatch: (patch: ${input.componentName}Patch) => void;\n}\n\nexport function ${input.componentName}Form({ session, onPatch }: ${input.componentName}FormProps) {\n  return (\n    <form onSubmit={(event) => event.preventDefault()}>\n${input.fields.map((field) => renderHeadlessField(field)).join("\n")}\n    </form>\n  );\n}\n`;
  }
  return `"use client";\n\nimport * as React from "react";\nimport { Button } from "@/components/ui/button";\nimport { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";\nimport { Input } from "@/components/ui/input";\nimport { Label } from "@/components/ui/label";\nimport { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";\nimport { Textarea } from "@/components/ui/textarea";\n${typeImport}\nimport { ${input.componentName}Provenance } from "./${input.componentName}Provenance";\n\nexport interface ${input.componentName}FormProps {\n  readonly onPatch: (patch: ${input.componentName}Patch) => void;\n  readonly onSave?: () => void | Promise<void>;\n  readonly session: ${input.componentName}Session;\n}\n\nexport function ${input.componentName}Form({ onPatch, onSave, session }: ${input.componentName}FormProps) {\n  const submit = async (event: React.FormEvent<HTMLFormElement>) => {\n    event.preventDefault();\n    await onSave?.();\n  };\n\n  return (\n    <form className="space-y-6" onSubmit={submit}>\n      <Card className="border-border bg-card text-card-foreground">\n        <CardHeader>\n          <CardTitle>${escapeJsx(titleFromComponent(input.componentName))}</CardTitle>\n          <CardDescription>Changes are staged as revision-aware DCS patches.</CardDescription>\n        </CardHeader>\n        <CardContent className="space-y-5">\n${input.fields.map((field) => renderShadcnField(field, input.componentName)).join("\n")}\n          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">\n            <Button type="submit">Save changes</Button>\n          </div>\n        </CardContent>\n      </Card>\n    </form>\n  );\n}\n\nfunction fieldValue(session: ${input.componentName}Session, path: string): unknown {\n  return session.fields.find((field) => field.path === path)?.value;\n}\n`;
}

function renderShadcnField(field: DcsEditorFieldDescriptor, componentName: string): string {
  const label = field.metadata.presentation?.label ?? lastSegment(field.path);
  const description = field.metadata.presentation?.description;
  const control = field.metadata.presentation?.control ?? controlFromSchema(field.schema);
  const id = `dcs-${field.path.replaceAll("/", "-").replace(/^-/, "")}`;
  const value = `fieldValue(session, ${JSON.stringify(field.path)})`;
  const patch = (value: string): string =>
    `onPatch({ operations: [{ op: "set", path: ${JSON.stringify(field.path)}, value: ${value} }] })`;
  const descriptionBlock =
    description === undefined
      ? ""
      : `\n              <p className="text-sm text-muted-foreground">${escapeJsx(description)}</p>`;
  const provenance = `\n              <${componentName}Provenance field={session.fields.find((entry) => entry.path === ${JSON.stringify(field.path)})} />`;
  if (field.metadata.secret === true) {
    return `          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-4">\n            <Label>${escapeJsx(label)}</Label>\n            <p className="text-sm text-muted-foreground">Configured through a secret reference. Its value is never rendered here.</p>${provenance}\n          </div>`;
  }
  if (control === "checkbox") {
    return `          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">\n            <div className="space-y-1">\n              <Label htmlFor="${id}">${escapeJsx(label)}</Label>${descriptionBlock}${provenance}\n            </div>\n            <input\n              checked={fieldValue(session, ${JSON.stringify(field.path)}) === true}\n              className="size-4 rounded border-input accent-primary"\n              id="${id}"\n              onChange={(event) => ${patch("event.currentTarget.checked")}}\n              type="checkbox"\n            />\n          </div>`;
  }
  if (control === "select") {
    const values = enumValues(field.schema);
    return `          <div className="space-y-2">\n            <Label htmlFor="${id}">${escapeJsx(label)}</Label>${descriptionBlock}\n            <Select onValueChange={(next) => ${patch("next")} } value={String(${value} ?? "")}>\n              <SelectTrigger id="${id}"><SelectValue placeholder="Select ${escapeJsx(label)}" /></SelectTrigger>\n              <SelectContent>\n${values.map((item) => `                <SelectItem value=${JSON.stringify(String(item))}>${escapeJsx(String(item))}</SelectItem>`).join("\n")}\n              </SelectContent>\n            </Select>${provenance}\n          </div>`;
  }
  if (control === "textarea") {
    return `          <div className="space-y-2">\n            <Label htmlFor="${id}">${escapeJsx(label)}</Label>${descriptionBlock}\n            <Textarea id="${id}" onChange={(event) => ${patch("event.currentTarget.value")}} value={String(${value} ?? "")} />${provenance}\n          </div>`;
  }
  const type = control === "number" ? "number" : "text";
  const parse =
    control === "number" ? "Number(event.currentTarget.value)" : "event.currentTarget.value";
  return `          <div className="space-y-2">\n            <Label htmlFor="${id}">${escapeJsx(label)}</Label>${descriptionBlock}\n            <Input id="${id}" onChange={(event) => ${patch(parse)}} type="${type}" value={String(${value} ?? "")} />${provenance}\n          </div>`;
}

function renderHeadlessField(field: DcsEditorFieldDescriptor): string {
  const label = field.metadata.presentation?.label ?? lastSegment(field.path);
  return `      <label>\n        <span>${escapeJsx(label)}</span>\n        <input\n          onChange={(event) => onPatch({ operations: [{ op: "set", path: ${JSON.stringify(field.path)}, value: event.currentTarget.value }] })}\n          value={String(session.fields.find((entry) => entry.path === ${JSON.stringify(field.path)})?.value ?? "")}\n        />\n      </label>`;
}

function renderConflictDialog(input: {
  readonly componentName: string;
  readonly preset: DcsUiPreset;
}): string {
  if (input.preset === "react-headless") {
    return `import type { ${input.componentName}Conflict } from "./${kebab(input.componentName.replace(/Config$/, ""))}-config-types";\n\nexport function ${input.componentName}ConflictDialog(props: { readonly conflict: ${input.componentName}Conflict; readonly onChoose: (choice: "latest" | "mine") => void }) {\n  return <div role="alert">Conflict at {props.conflict.path}</div>;\n}\n`;
  }
  return `import { Button } from "@/components/ui/button";\nimport type { ${input.componentName}Conflict } from "./${kebab(input.componentName.replace(/Config$/, ""))}-config-types";\n\nexport function ${input.componentName}ConflictDialog(props: { readonly conflict: ${input.componentName}Conflict; readonly onChoose: (choice: "latest" | "mine") => void }) {\n  return (\n    <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">\n      <strong className="text-destructive">Concurrent configuration change</strong>\n      <p className="mt-1 text-muted-foreground">Both edits touch {props.conflict.path}. DCS will not silently choose a winner.</p>\n      <div className="mt-3 flex gap-2">\n        <Button onClick={() => props.onChoose("mine")} size="sm" type="button">Keep mine</Button>\n        <Button onClick={() => props.onChoose("latest")} size="sm" type="button" variant="outline">Use latest</Button>\n      </div>\n    </section>\n  );\n}\n`;
}

function renderProvenance(input: {
  readonly componentName: string;
  readonly preset: DcsUiPreset;
}): string {
  const typeImport = `import type { ${input.componentName}Field } from "./${kebab(input.componentName.replace(/Config$/, ""))}-config-types";`;
  if (input.preset === "react-headless") {
    return `${typeImport}\n\nexport function ${input.componentName}Provenance(props: { readonly field?: ${input.componentName}Field }) {\n  return props.field === undefined ? null : <span>{props.field.source}</span>;\n}\n`;
  }
  return `${typeImport}\n\nexport function ${input.componentName}Provenance(props: { readonly field?: ${input.componentName}Field }) {\n  if (props.field === undefined) return null;\n  return <p className="text-xs text-muted-foreground">Source: {props.field.source}</p>;\n}\n`;
}

function renderTypes(componentName: string): string {
  return `export type ${componentName}Patch = { readonly operations: readonly { readonly op: "set" | "unset" | "reset"; readonly path: string; readonly value?: unknown }[] };\n\nexport interface ${componentName}Field {\n  readonly editable: boolean;\n  readonly path: string;\n  readonly source: "default" | "user" | "workspace" | "local" | "invocation" | "mixed";\n  readonly value: unknown;\n}\n\nexport interface ${componentName}Session {\n  readonly documentRevision: string;\n  readonly fields: readonly ${componentName}Field[];\n  readonly profile?: string;\n  readonly selectedScope: "user" | "workspace" | "local";\n}\n\nexport interface ${componentName}Conflict {\n  readonly kind: "document-overlap" | "collection-overlap";\n  readonly path: string;\n}\n`;
}

function renderClient(componentName: string, endpoint: string): string {
  return `import type { ${componentName}Patch, ${componentName}Session } from "./${kebab(componentName.replace(/Config$/, ""))}-config-types";\n\nconst defaultEndpoint = ${JSON.stringify(endpoint)};\n\nexport async function fetch${componentName}Session(endpoint = defaultEndpoint): Promise<${componentName}Session> {\n  const response = await fetch(endpoint, { headers: { accept: "application/json" } });\n  if (!response.ok) throw new Error(\`DCS session request failed: \${response.status}\`);\n  return await response.json() as ${componentName}Session;\n}\n\nexport async function stage${componentName}Patch(patch: ${componentName}Patch, endpoint = defaultEndpoint): Promise<void> {\n  const response = await fetch(\`${endpoint}/patch\`, {\n    body: JSON.stringify(patch),\n    headers: { "content-type": "application/json" },\n    method: "POST",\n  });\n  if (!response.ok) throw new Error(\`DCS patch request failed: \${response.status}\`);\n}\n`;
}

function renderServerStub(componentName: string, contractId: string): string {
  return `/**\n * Application-owned route glue. DCS intentionally does not mutate your routes.\n * Bind this module to your Bun/Node route and authorize the host before exposing it.\n */\nexport interface ${componentName}ServerOptions {\n  readonly contractId?: string;\n  readonly endpoint?: string;\n}\n\nexport const ${componentName}ContractId = ${JSON.stringify(contractId)};\n\nexport function create${componentName}RouteMetadata(options: ${componentName}ServerOptions = {}) {\n  return {\n    contractId: options.contractId ?? ${componentName}ContractId,\n    endpoint: options.endpoint ?? "/api/dcs",\n    security: "Authenticate and authorize every remote request before opening a DCS editor session.",\n  } as const;\n}\n`;
}

function renderThemeCss(): string {
  return `/* Optional DCS Tailwind v4 + shadcn token additions. Import this file explicitly from your global CSS. */\n@theme inline {\n  --color-dcs-warning: var(--dcs-warning);\n  --color-dcs-warning-foreground: var(--dcs-warning-foreground);\n}\n\n:root {\n  --dcs-warning: oklch(0.84 0.16 84);\n  --dcs-warning-foreground: oklch(0.28 0.07 46);\n}\n\n.dark {\n  --dcs-warning: oklch(0.41 0.11 46);\n  --dcs-warning-foreground: oklch(0.99 0.02 95);\n}\n`;
}

function isContainerOnly(field: DcsEditorFieldDescriptor): boolean {
  return field.schema.type === "object" && field.metadata.merge === "deep";
}

function controlFromSchema(schema: JsonSchema): "checkbox" | "number" | "select" | "text" {
  if (Array.isArray(schema.enum)) return "select";
  if (schema.type === "boolean") return "checkbox";
  if (schema.type === "integer" || schema.type === "number") return "number";
  return "text";
}

function enumValues(schema: JsonSchema): readonly string[] {
  return Array.isArray(schema.enum)
    ? schema.enum
        .filter(
          (value): value is string | number | boolean =>
            typeof value === "string" || typeof value === "number" || typeof value === "boolean",
        )
        .map(String)
    : [];
}

function lastSegment(pointer: string): string {
  const value = pointer.split("/").at(-1) ?? pointer;
  return value
    .replaceAll("~1", "/")
    .replaceAll("~0", "~")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
}

function toPascalCase(value: string): string {
  return (
    value
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
      .join("") || "Dcs"
  );
}

function kebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function titleFromComponent(value: string): string {
  return value.replace(/Config$/, " configuration").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function escapeJsx(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;");
}

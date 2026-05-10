import type { GtbNpmPackResult, GtbNpmPackageInfo } from "./types";

export async function readNpmPackageInfo(
    npmBin: string,
    spec: string,
): Promise<GtbNpmPackageInfo> {
    const stdout = await runNpmJson(npmBin, [
        "view",
        spec,
        "name",
        "version",
        "optionalDependencies",
        "--json",
    ]);

    const parsed = parseNpmJson(stdout);
    const info = Array.isArray(parsed) ? parsed.at(-1) : parsed;

    if (!isRecord(info)) {
        throw new Error(
            `npm view did not return package metadata for ${spec}.`,
        );
    }

    const name = readStringProperty(info, "name");
    const version = readStringProperty(info, "version");
    const optionalDependencies = readStringRecordProperty(
        info,
        "optionalDependencies",
    );

    return {
        name,
        version,
        optionalDependencies,
    };
}

export async function npmPack(
    npmBin: string,
    spec: string,
    outputDir: string,
): Promise<GtbNpmPackResult | null> {
    const stdout = await runNpmJson(npmBin, [
        "pack",
        spec,
        "--pack-destination",
        outputDir,
        "--json",
    ]);

    const parsed = parseNpmJson(stdout);
    const item = Array.isArray(parsed) ? parsed.at(0) : parsed;

    if (!item || typeof item !== "object") {
        return null;
    }

    return item as GtbNpmPackResult;
}

export function packageSpec(name: string, versionOrTag: string): string {
    return `${name}@${versionOrTag}`;
}

async function runNpmJson(npmBin: string, args: string[]): Promise<string> {
    const proc = Bun.spawn([npmBin, ...args], {
        stdout: "pipe",
        stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);

    if (exitCode !== 0) {
        const cleanStderr = stderr.trim();
        const cleanStdout = stdout.trim();

        throw new Error(
            [
                `npm command failed with exit code ${exitCode}: ${shellQuote([npmBin, ...args])}`,
                cleanStderr ? `stderr:\n${cleanStderr}` : undefined,
                cleanStdout ? `stdout:\n${cleanStdout}` : undefined,
            ]
                .filter(Boolean)
                .join("\n\n"),
        );
    }

    return stdout;
}

function parseNpmJson(stdout: string): unknown {
    const trimmed = stdout.trim();

    if (!trimmed) {
        return null;
    }

    try {
        return JSON.parse(trimmed);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Failed to parse npm JSON output: ${message}\n\n${trimmed}`,
        );
    }
}

function readStringProperty(
    record: Record<string, unknown>,
    key: string,
): string {
    const value = record[key];

    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`npm metadata is missing string field: ${key}`);
    }

    return value;
}

function readStringRecordProperty(
    record: Record<string, unknown>,
    key: string,
): Record<string, string> {
    const value = record[key];

    if (!isRecord(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value)
            .filter(
                (entry): entry is [string, string] =>
                    typeof entry[1] === "string",
            )
            .map(([dependencyName, dependencyRange]) => [
                dependencyName,
                dependencyRange,
            ]),
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shellQuote(parts: string[]): string {
    return parts
        .map((part) => {
            if (/^[a-zA-Z0-9_./:@+-]+$/.test(part)) {
                return part;
            }

            return `'${part.replaceAll("'", String.raw`'\''`)}'`;
        })
        .join(" ");
}

import { platformLabel } from "./platform";
import type { GtbRunResult } from "./types";

export type GtbSummaryColors = {
    heading: (text: string) => string;
    key: (text: string) => string;
    value: (text: string) => string;
    info: (text: string) => string;
    warning: (text: string) => string;
    success: (text: string) => string;
    muted: (text: string) => string;
    error: (text: string) => string;
};

export function formatGtbSummary(
    run: GtbRunResult,
    colors: GtbSummaryColors,
): string {
    const lines: string[] = [];

    lines.push("");
    lines.push(
        colors.heading(run.apply ? "gtb packed tarballs" : "gtb preview"),
    );
    lines.push("");

    if (run.alias) {
        lines.push(
            `${colors.key("alias")} ${colors.value(run.alias.aliasName)} ${colors.muted(`-> ${run.alias.packageName}`)}`,
        );
    }

    lines.push(
        `${colors.key("package")} ${colors.value(run.resolvedRoot.name)}`,
    );

    if (run.inputPackageName !== run.packageName) {
        lines.push(
            `${colors.key("input package")} ${colors.value(run.inputPackageName)}`,
        );
    }

    lines.push(`${colors.key("requested")} ${colors.value(run.requestedSpec)}`);
    lines.push(
        `${colors.key("resolved")} ${colors.value(`${run.resolvedRoot.name}@${run.resolvedRoot.version}`)}`,
    );
    lines.push(
        `${colors.key("platform")} ${colors.value(platformLabel(run.os, run.arch))}`,
    );
    lines.push(`${colors.key("output")} ${colors.value(run.outputDir)}`);
    lines.push(
        `${colors.key("optional mode")} ${colors.value(run.optionalMode)}`,
    );
    lines.push("");

    lines.push(colors.heading("tarballs"));

    for (const item of run.plan) {
        const badge =
            item.kind === "root"
                ? colors.info("root")
                : colors.info("optional");
        const platform =
            item.kind === "optional"
                ? item.matchedPlatform
                    ? colors.success("platform match")
                    : colors.warning("not platform matched")
                : "";

        lines.push(
            [
                `- ${badge}`,
                colors.value(item.outputFilename),
                colors.muted(`(${item.resolvedSpec})`),
                platform,
            ]
                .filter(Boolean)
                .join(" "),
        );
    }

    if (run.skipped.length > 0) {
        lines.push("");
        lines.push(colors.heading("skipped optional dependencies"));

        for (const skipped of run.skipped) {
            lines.push(
                `- ${colors.muted(skipped.name)} ${colors.muted(skipped.reason)}`,
            );
        }
    }

    if (!run.apply) {
        lines.push("");
        lines.push(colors.warning("preview only"));
        lines.push(
            colors.muted(
                "No tarballs were written. Re-run with --apply to execute npm pack.",
            ),
        );
        lines.push("");
        lines.push(colors.heading("commands"));

        for (const command of run.commands) {
            lines.push(colors.muted(command));
        }
    }

    if (run.apply) {
        lines.push("");
        lines.push(
            colors.success(
                `written ${run.packed.length} tarball${run.packed.length === 1 ? "" : "s"}`,
            ),
        );

        for (const packed of run.packed) {
            const filename = packed.npm?.filename ?? packed.plan.outputFilename;
            lines.push(`- ${colors.value(filename)}`);
        }
    }

    lines.push("");

    return lines.join("\n");
}

export function isPlatformOptionalDependency(
    name: string,
    os: string,
    arch: string,
): boolean {
    const normalizedName = name.toLowerCase();
    const suffixes = platformSuffixes(os, arch);

    return suffixes.some((suffix) => normalizedName.endsWith(suffix));
}

export function platformLabel(os: string, arch: string): string {
    return `${os}-${arch}`;
}

function platformSuffixes(os: string, arch: string): string[] {
    const osAliases = osTokenAliases(os);
    const archAliases = archTokenAliases(arch);

    const suffixes: string[] = [];

    for (const osAlias of osAliases) {
        for (const archAlias of archAliases) {
            suffixes.push(`-${osAlias}-${archAlias}`);
        }
    }

    return suffixes;
}

function osTokenAliases(os: string): string[] {
    switch (os) {
        case "win32":
            return ["win32", "windows", "win"];
        case "darwin":
            return ["darwin", "macos", "mac"];
        default:
            return [os];
    }
}

function archTokenAliases(arch: string): string[] {
    switch (arch) {
        case "x64":
            return ["x64", "amd64"];
        case "arm64":
            return ["arm64", "aarch64"];
        default:
            return [arch];
    }
}

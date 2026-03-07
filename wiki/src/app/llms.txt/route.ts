import { blogSource, source } from "~/lib/source";

export const revalidate = false;

export async function GET() {
  const lines: string[] = [];

  const docBase = "/docs";
  const blogBase = "/blog";

  lines.push("# Documentation");
  lines.push("");
  for (const page of source.getPages()) {
    const url = `${docBase}/${page.url}`.replace(/\/+/g, "/");
    lines.push(`- [${page.data.title}](${url}): ${page.data.description}`);
  }

  lines.push("");
  lines.push("# Blog");
  lines.push("");
  for (const page of blogSource.getPages()) {
    const url = `${blogBase}/${page.url}`.replace(/\/+/g, "/");
    lines.push(`- [${page.data.title}](${url}): ${page.data.description}`);
  }

  return new Response(lines.join("\n"));
}

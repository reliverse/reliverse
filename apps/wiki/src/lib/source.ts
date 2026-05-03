import { loader, multiple } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import type { TOCItemType } from "fumadocs-core/toc";
import { blog, docs } from "fumadocs-mdx:collections/server";
import type { MDXContent } from "mdx/types";

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
});

export const blogSource = loader({
  baseUrl: "/blog",
  source: blog.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
});

/** Combined source for search index (docs + blog). */
export const searchSource = loader({
  baseUrl: "/",
  source: multiple({
    docs: docs.toFumadocsSource(),
    blog: blog.toFumadocsSource(),
  }),
  plugins: [lucideIconsPlugin()],
});

type PageWithUrl = { url: string; slugs: string[] };
type RenderablePageData = { body: MDXContent; toc: TOCItemType[]; full?: boolean };
type LLMPageData = { getText: (type: "processed" | "raw") => Promise<string>; title: string };

export function isRenderablePageData(data: unknown): data is RenderablePageData {
  if (typeof data !== "object" || data === null) return false;

  const body = Reflect.get(data, "body");
  const toc = Reflect.get(data, "toc");
  const full = Reflect.get(data, "full");

  return (
    typeof body === "function" &&
    Array.isArray(toc) &&
    (full === undefined || typeof full === "boolean")
  );
}

function isLLMPageData(data: unknown): data is LLMPageData {
  if (typeof data !== "object" || data === null) return false;

  const getText = Reflect.get(data, "getText");
  const title = Reflect.get(data, "title");

  return typeof getText === "function" && typeof title === "string";
}

export function getPageImage(page: PageWithUrl) {
  const section = page.url.split("/")[1] ?? "docs";
  const segments = [...page.slugs, "image.png"];
  return {
    segments,
    url: `/og/${section}/${segments.join("/")}`,
  };
}

export async function getLLMText(page: { data: unknown }) {
  if (!isLLMPageData(page.data)) {
    throw new Error("Page data does not contain LLM text methods");
  }

  const processed = await page.data.getText("processed");

  return `# ${page.data.title}

${processed}`;
}

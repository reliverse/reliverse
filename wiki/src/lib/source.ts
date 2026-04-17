import { loader, multiple } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { blog, docs } from "fumadocs-mdx:collections/server";

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

export function getPageImage(page: PageWithUrl) {
  const section = page.url.split("/")[1] ?? "docs";
  const segments = [...page.slugs, "image.png"];
  return {
    segments,
    url: `/og/${section}/${segments.join("/")}`,
  };
}

export async function getLLMText(
  page: { data: { getText: (type: "processed" | "raw") => Promise<string>; title: string } },
) {
  const processed = await page.data.getText("processed");

  return `# ${page.data.title}

${processed}`;
}

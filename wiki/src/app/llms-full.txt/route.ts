import { getLLMText, blogSource, loreSource, source } from "~/lib/source";

export const revalidate = false;

export async function GET() {
  const docsScan = source.getPages().map(getLLMText);
  const blogScan = blogSource.getPages().map(getLLMText);
  const [docs, blog] = await Promise.all([
    Promise.all(docsScan),
    Promise.all(blogScan),
  ]);
  return new Response([...docs, ...blog].join("\n\n"));
}

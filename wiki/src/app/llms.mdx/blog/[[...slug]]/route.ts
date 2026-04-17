import { notFound } from "next/navigation";

import { blogSource, getLLMText } from "~/lib/source";

export const revalidate = false;

export async function GET(_req: Request, { params }: RouteContext<"/llms.mdx/blog/[[...slug]]">) {
  const { slug } = await params;
  const page = blogSource.getPage(slug);
  if (!page) notFound();

  return new Response(await getLLMText(page), {
    headers: {
      "Content-Type": "text/markdown",
    },
  });
}

export function generateStaticParams() {
  return blogSource.generateParams();
}

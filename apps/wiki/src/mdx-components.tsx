import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import type { AnchorHTMLAttributes, FC } from "react";

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...components,
  };
}

export function createRelativeMdxLink<Page>(
  resolveHref: (href: string, page: Page) => string,
  page: Page,
): FC<AnchorHTMLAttributes<HTMLAnchorElement>> {
  const Link = defaultMdxComponents.a;

  return function RelativeMdxLink({ href, ...props }) {
    return <Link href={href ? resolveHref(href, page) : href} {...props} />;
  };
}

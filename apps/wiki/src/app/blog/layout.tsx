import { DocsLayout } from "fumadocs-ui/layouts/docs";

import { baseOptions } from "~/lib/layout.shared";
import { blogSource } from "~/lib/source";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DocsLayout tree={blogSource.getPageTree()} {...baseOptions()}>
      {children}
    </DocsLayout>
  );
}

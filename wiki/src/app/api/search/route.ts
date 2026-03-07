import { createFromSource } from "fumadocs-core/search/server";

import { searchSource } from "~/lib/source";

export const { GET } = createFromSource(searchSource, {
  // https://docs.orama.com/docs/orama-js/supported-languages
  language: "english",
});

import { expect, test } from "bun:test";

import { applyJsoncEdits, parseJsoncText } from "./jsonc";

test("parses comments and trailing commas without changing semantic data", () => {
  const source = `{
  // root comment
  "enabled": true,
  "items": [
    "one",
  ],
}
`;
  const result = parseJsoncText(source);
  expect(result.ok).toBe(true);
  expect(result.parsed?.value).toEqual({ enabled: true, items: ["one"] });
});

test("JSONC parsing and edits preserve prototype-named own properties as data", () => {
  const source = '{"__proto__":{"enabled":true},"constructor":1}';
  const result = parseJsoncText(source);
  expect(result.ok).toBe(true);
  expect(JSON.stringify(result.parsed!.value)).toBe(source);
  expect(Object.getPrototypeOf(result.parsed!.value)).toBe(Object.prototype);
  const edited = applyJsoncEdits(source, [{ op: "set", path: "/__proto__/enabled", value: false }]);
  expect(JSON.stringify(edited.document)).toBe('{"__proto__":{"enabled":false},"constructor":1}');
});

test("replaces a nested value and preserves unrelated comments, order, and trailing commas", () => {
  const source = `{
  // keep this root comment
  "$dcs": {
    "id": "org.example.demo",
  },
  "editor": {
    // keep this nested comment
    "fontSize": 14,
  },
  "telemetry": false, // keep this trailing comment
}
`;
  const result = applyJsoncEdits(source, [
    { op: "set", path: "/editor/fontSize", value: 16 },
    { op: "set", path: "/telemetry", value: true },
  ]);

  expect(result.text).toContain("// keep this root comment");
  expect(result.text).toContain("// keep this nested comment");
  expect(result.text).toContain("// keep this trailing comment");
  expect(result.text).toContain('"fontSize": 16,');
  expect(result.text).toContain('"telemetry": true,');
  expect(result.document).toEqual({
    $dcs: { id: "org.example.demo" },
    editor: { fontSize: 16 },
    telemetry: true,
  });
});

test("inserts missing nested paths without rebuilding the whole JSONC document", () => {
  const source = `{
  "$dcs": {
    "id": "org.example.demo",
  },
  "editor": {
    // color is intentionally absent
    "fontSize": 14,
  },
}
`;
  const result = applyJsoncEdits(source, [{ op: "set", path: "/editor/theme", value: "dark" }]);

  expect(result.text).toContain("// color is intentionally absent");
  expect(result.text).toContain('"fontSize": 14,');
  expect(result.text).toContain('"theme": "dark",');
  expect(result.document).toEqual({
    $dcs: { id: "org.example.demo" },
    editor: { fontSize: 14, theme: "dark" },
  });
});

test("deletes only the selected property and leaves sibling comments available", () => {
  const source = `{
  "editor": {
    // font comment
    "fontSize": 14,
    // theme comment
    "theme": "dark",
  },
}
`;
  const result = applyJsoncEdits(source, [{ op: "delete", path: "/editor/fontSize" }]);
  expect(result.text).toContain("// theme comment");
  expect(result.text).toContain('"theme": "dark",');
  expect(result.document).toEqual({ editor: { theme: "dark" } });
});

import { defineCommand } from "@reliverse/rempts";
export default defineCommand({
  meta: { name: "wt", description: "Capture a bounded work turn and its forward/reverse patches." },
  safety: { defaultMode: "execute", requiresApply: false, effects: [] },
  async handler(ctx) {
    ctx.out(
      "Use gr wt begin, gr wt status, gr wt reconcile-index, gr wt extend-scope, gr wt finish, gr wt supersede, or gr wt recover.",
    );
  },
});

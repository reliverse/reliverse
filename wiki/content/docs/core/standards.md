---
title: Reliverse Standards
description: Best practice recommendations for Reliverse and your own projects.
---

**Reliverse Standards** provides best practice recommendations to help keep your code clean, maintainable, and efficient, both in Reliverse projects and your own work.

## Avoid Repeated I/O Operations

Repeated I/O operations-like reading a configuration file every time a function is called-can degrade performance, especially in large-scale or performance-sensitive applications.

**❌ Bad Example (Reading config on every prompt):**

```ts
import { confirmPrompt } from "@reliverse/prompts";
import { readConfig } from "./utils/readConfig.js"; // Hypothetical utility
import { getCurrentWorkingDirectory } from "./utils/fs.js";

async function decide(behaviorKey: string, title: string): Promise<boolean> {
  const cwd = getCurrentWorkingDirectory();
  const config = await readConfig(cwd); // I/O every time
  const behavior = config?.[behaviorKey] || "prompt";

  if (behavior === "autoYes") return true;
  if (behavior === "autoNo") return false;

  return confirmPrompt({ title, defaultValue: true });
}
```

**✅ Good Example (Read config once and pass it along):**

```ts
import { confirmPrompt } from "@reliverse/prompts";

async function decide(config: any, behaviorKey: string, title: string): Promise<boolean> {
  const behavior = config?.[behaviorKey] || "prompt";

  if (behavior === "autoYes") return true;
  if (behavior === "autoNo") return false;

  return confirmPrompt({ title, defaultValue: true });
}

// Usage elsewhere:
const config = await readConfigOnceAtStartup();
const shouldGitInit = await decide(config, "gitInitBehavior", "Init .git?"); // Pass config
const shouldDeploy = await decide(config, "deployBehavior", "Deploy to Vercel?"); // Reuse
```

By loading the configuration once and passing it to `decide()`, you avoid repetitive file reads and ensure better performance.

## Avoid Using `console.log` in Production

**In production environments**, avoid using `console.log` for debugging, as it may expose sensitive information and clutter logs. Instead, use a proper logging framework or monitoring tool that can manage log levels and ensure that sensitive data is handled securely.

## Maintain Consistent Code Formatting and Style

A consistent coding style improves readability and reduces cognitive overhead. Use tools like **oxlint** and **oxfmt** for formatting and linting. Enforce these tools via your CI pipeline so that all contributors follow the same code style.

- Add `oxlint` and `oxfmt` as dev dependencies.
- Configure `oxlintrc.json` and `oxfmtrc.json` for your project.
- Run `oxlint --fix` and `oxfmt --fix` as part of your CI workflow.

## Use Environment Variables Securely

**❌ Bad Example (Hardcoding secrets):**

```ts
const apiKey = "hardcoded-api-key";
```

**✅ Good Example (Load from .env):**

```ts
import dotenv from "dotenv";
dotenv.config();

const apiKey = process.env.API_KEY;
```

Store sensitive credentials like API keys and database passwords in `.env` files (excluded from version control) and load them with a library such as `dotenv`. On production, rely on environment variables provided by your deployment platform. This approach keeps secrets out of source control and reduces the risk of unauthorized access.

## Write Automated Tests

Automated tests catch bugs early and improve code confidence. Write unit, integration, and end-to-end tests as appropriate. Consider using frameworks like **Jest**, **Mocha**, or **Vitest** for unit tests, and **Playwright** or **Cypress** for end-to-end testing.

**✅ Good Example (Simple Jest test):**

```ts
// sum.test.ts
import { sum } from "./sum";

test("adds two numbers", () => {
  expect(sum(1, 2)).toBe(3);
});
```

Adding tests ensures that your codebase remains stable as it evolves.

## Implement Continuous Integration and Deployment (CI/CD)

Set up a CI pipeline to run tests, linters, and build steps before merging changes. This helps maintain code quality and ensures that issues are caught before production releases. Tools like GitHub Actions, GitLab CI, and CircleCI make it easier to implement CI/CD workflows.

**✅ Good Example (GitHub Actions Workflow):**

```yaml
name: CI
on: [push, pull_request]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Use Node.js
        uses: actions/setup-node@v2
        with:
          node-version: "18"
      - name: Install dependencies
        run: npm install
      - name: Run tests
        run: npm test
```

## Perform Regular Code Reviews

Encourage code reviews for every pull request. Peer reviews help maintain code quality, share knowledge, and catch issues early. Reviews also ensure that guidelines like those listed above are being followed, improving overall project health.

---

By following these recommendations-avoiding repeated I/O operations, using secure logging practices, maintaining consistent code style, handling secrets safely, writing automated tests, implementing CI/CD, and performing code reviews-you ensure that your code remains efficient, secure, and maintainable, embodying the principles of the Reliverse Standard.

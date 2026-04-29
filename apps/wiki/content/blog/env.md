---
title: Environment variables
description: A detailed guide to configuring and using environment variables in your project.
---

:::note
TL;DR: This document provides guidance on defining, accessing, and organizing environment variables.
:::

Environment variables play a crucial role in managing configuration settings for your application, enabling you to tailor your project's behavior without modifying the codebase.

## What Are Environment Variables?

Environment variables are key-value pairs used to configure software behavior at runtime. They are often employed to store sensitive or environment-specific information, such as API keys, database connection strings, or feature flags.

### Common Uses

- **Authentication:** Storing secrets like API keys or OAuth tokens.
- **Configuration:** Defining environment-specific settings such as database URLs.
- **Debugging:** Enabling or disabling debug modes.

## Setting Up Environment Variables

### In a Local Development Environment

1. Create a `.env` file in the root of your project.
2. Add key-value pairs in the format `KEY=VALUE`.

Example:

```properties
DATABASE_URL=postgres://user:password@localhost:5432/mydb
API_KEY=your-api-key-here
```

> **Note:** Ensure your `.env` file is included in `.gitignore` to avoid committing sensitive information to your version control system.

### In a Production Environment

Environment variables can be set through your hosting provider's dashboard, command-line tools, or CI/CD pipelines. Refer to your specific platform's documentation for exact instructions.

Example for Linux:

```bash
export DATABASE_URL=postgres://user:password@prod:5432/mydb
```

## Accessing Environment Variables

### In Node.js

Environment variables can be accessed using `process.env`.

Example:

```javascript
const dbUrl = process.env.DATABASE_URL;
console.log(`Connecting to database at ${dbUrl}`);
```

### In Other Frameworks

Most modern frameworks provide built-in support for managing environment variables. Refer to your framework's documentation for best practices.

## Best Practices

1. **Do not hardcode sensitive information.** Always use environment variables for secrets and keys.
2. **Use descriptive keys.** Choose meaningful names that convey their purpose (e.g., `API_KEY`, `DATABASE_URL`).
3. **Keep environment variables organized.** Group them logically, especially in large projects.
4. **Validate environment variables.** Ensure required variables are set, and provide default values where applicable.

Example:

```javascript
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set.");
}
```

## Further Reading

- Learn more [about reference](https://diataxis.fr/reference/) in the Diátaxis framework.
- Check out [12-factor app principles](https://12factor.net/config) for guidelines on environment variable management.

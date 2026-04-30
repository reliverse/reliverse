# Brand icons

Small React wrappers around [`simple-icons`](https://www.npmjs.com/package/simple-icons).

These components intentionally do not copy SVG path data into this repository. The icon paths come from the installed `simple-icons` package at build time.

## Prerequisites

```bash
bun add simple-icons
```

## Icons

```txt
packages/ui/src/icons/
  brand-icon.tsx
  github.tsx
  google.tsx
  x.tsx
  index.ts
  README.md
```

## Usage

```tsx
import { GitHubIcon, GoogleIcon, XIcon } from "@reliverse/ui/icons";

export function SocialLinks() {
  return (
    <div className="flex items-center gap-3 text-zinc-950 dark:text-zinc-50">
      <GitHubIcon />
      <GoogleIcon />
      <XIcon />
    </div>
  );
}
```

By default, icons are decorative and hidden from screen readers.

Use `title` when the icon itself carries meaning:

```tsx
<GitHubIcon title="GitHub" />
```

If the accessible label is already provided by a parent button/link, keep the icon decorative:

```tsx
<a href="https://github.com/reliverse" aria-label="Reliverse on GitHub">
  <GitHubIcon />
</a>
```

## Sizing

```tsx
<GitHubIcon size={16} />
<GitHubIcon size={20} />
<GitHubIcon size={24} />
```

You can also pass regular SVG props:

```tsx
<GitHubIcon className="size-5 shrink-0" />
```

## Colors

Most icons default to `currentColor`, so they work naturally with light/dark mode:

```tsx
<GitHubIcon className="text-zinc-950 dark:text-zinc-50" />
```

Use the official Simple Icons brand color with `color="brand"`:

```tsx
<GitHubIcon color="brand" />
<XIcon color="brand" />
```

You can also pass any CSS color string:

```tsx
<GitHubIcon color="#181717" />
```

The `fill` prop overrides `color`:

```tsx
<GitHubIcon fill="currentColor" />
```

## Google note

`GoogleIcon` uses the monochrome Simple Icons version and defaults to `color="brand"`.

Do not use this component as the icon inside a "Sign in with Google" button. Google sign-in branding requires the official full-color Google "G" logo and must follow Google's official sign-in branding rules.

For OAuth/sign-in buttons, use the official Google Identity assets or Google's rendered button.

## LinkedIn note

LinkedIn is intentionally not exported from this package through `simple-icons`.

Simple Icons removed the LinkedIn icon in v14.0.0, so this package should not fake it with another brand icon. If LinkedIn support is needed, use the official LinkedIn `[in] Logo` asset from LinkedIn Brand Downloads and follow LinkedIn's official brand rules.

## X naming

This package exposes `XIcon`.

If a legacy X bird is ever needed, add it as `x-legacy.tsx` instead of overloading `x.tsx`.

## Trademark note

Brand icons and trademarks belong to their respective owners.

The `simple-icons` package is CC0, but that does not automatically grant trademark permission for every possible usage of each brand mark. Use these icons only in contexts allowed by each brand's official guidelines.

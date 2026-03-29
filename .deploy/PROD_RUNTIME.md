# Reliverse production runtime policy

## Canonical roots
- dev: `/home/blefnk/dev/reliverse/reliverse`
- prod: `/home/deploy/prod/reliverse/reliverse`

## Production layout
Reliverse production uses a release-style runtime tree:
- `current -> releases/<release-id>`
- `previous -> releases/<release-id>`
- `releases/`
- `shared/`
- `metadata/`

The deploy workflow swaps `current` to a new release and records deploy history in `metadata/`.

## Checkout staging
Remote deploy staging now uses:
- `/home/deploy/prod/.checkouts`

## Deploy registry
Canonical registry path:
- `/home/deploy/.config/bleverse/deploy.json`

Relevant app ids:
- `reliverse-web`
- `reliverse-api`

Registry entries for Reliverse should point `repoDir` at:
- `/home/deploy/prod/reliverse/reliverse/current`

## Repo fetch model
Reliverse is public.
Deploy workflow clones the source repository via HTTPS:
- `https://github.com/reliverse/reliverse.git`

## Runtime model
Current Reliverse prod services run from:
- `current/apps/web`
- `current/apps/api`

Current Reliverse prod runtime uses deploy-owned env files:
- `/home/deploy/.config/reliverse/reliverse-web.env`
- `/home/deploy/.config/reliverse/reliverse-api.env`

Current DB contract is environment-split:
- dev -> `reliverse_dev`
- prod -> `reliverse_prod`

Reliverse does not currently use canonical app env files under `shared/` for web/api startup.
The `shared/` directory remains reserved for future durable runtime config if needed.

## Systemd user units
Canonical unit templates live in:
- `deploy/systemd/bun-web-4020-reliverse-prod.service`
- `deploy/systemd/bun-api-4021-reliverse-prod.service`

## Operational note
If a Reliverse deploy fails after the runtime tree updates, check in this order:
1. `current` points to the intended release
2. `/home/deploy/.config/bleverse/deploy.json` points Reliverse apps to `.../current`
3. prod units still match the templates in `deploy/systemd/`
4. `.deploy-sha` exists in the active release and matches the requested ref
5. `/home/deploy/.config/reliverse/reliverse-web.env` is still present/readable for the web unit
6. local/public health checks still pass for `4020` and `4021`

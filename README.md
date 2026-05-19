# zero-config

**Typed, validated, agent-readable environment configuration for Zero applications.**

`zero-config` is a CLI tool and Zero library that adds a typed schema layer to application environment configuration. It acts as a single source of truth, moving configuration errors from runtime panics to startup-time validation, while outputting machine-readable JSON diagnostics that AI agents and CI pipelines can easily digest.

---

## The Problem

Every application reads configuration from environment variables (e.g., `.env` files). However, this flat key-value text format lacks types, documentation, and the ability to distinguish required vs. optional variables. This leads to:

1. **Human Error:** Missing variables are discovered at runtime. Port numbers formatted as strings or invalid URLs cause confusing panics.
2. **Operational Drift:** New variables added in development are silently missing in staging or production.
3. **Agent Opacity:** AI agents assisting with deployments cannot reason about your configuration requirements, slowing down automated workflows.

## The Solution

`zero-config` introduces a schema layer that provides:
- **Typed Schema Declarations:** Define your environment variables (String, Url, Port, Bool, Int, Secret, Email, Path, Duration, Json).
- **Validation Pipeline:** Check your live environment or `.env` files against the schema.
- **Machine-Readable Output:** Every command supports a `--json` flag to return structured diagnostics and automated repair hints.
- **Template Generation:** Autogenerate documented, human-editable `.env.template` files.

---

## Installation

You can use `zero-config` via the Zero toolchain or as a standalone CLI using npm.

### For Non-Zero Projects (via npm)

If you are using Node.js, Next.js, Express, Python, Docker, or any other stack, you can use the npm wrapper. It downloads the pre-compiled native binary for your architecture.

```bash
npm install -g zero-config-cli

# Or run it directly without installing globally:
npx zero-config-cli check
```

### For Zero Projects

If you are building a Zero application, add it as a dependency:

```bash
zero add zero-config
```

---

## Usage & Commands

Define your schema in a `zero-config.json` file in your project root (or `config/zero-config.json`):

```json
{
  "name": "my-app",
  "version": "1.0.0",
  "variables": [
    {
      "name": "DATABASE_URL",
      "type": "url",
      "required": true,
      "description": "PostgreSQL connection string",
      "example": "postgres://user:password@localhost:5432/appdb",
      "default": null,
      "deprecated": false,
      "tags": ["database"]
    },
    {
      "name": "PORT",
      "type": "port",
      "required": false,
      "description": "HTTP server listening port",
      "example": "3000",
      "default": "3000",
      "deprecated": false,
      "tags": []
    }
  ]
}
```

### 1. `check`
Validate your environment variables against the schema. Fails fast if required variables are missing or have type mismatches.

```bash
# Check the live process environment
zero-config check

# Check against a specific .env file
zero-config check --env-file .env.development

# Output as JSON for CI or AI agents
zero-config check --json
```

### 2. `generate`
Create a `.env.template` file automatically from your schema.

```bash
zero-config generate --output .env.example
```

### 3. `diff`
Compare two environments to see what's missing or mismatched. Perfect for deploying to a new environment.

```bash
zero-config diff .env.development .env.staging
```

### 4. `inspect`
Return the full schema documentation.

```bash
zero-config inspect
```

---

## Integrations

### Docker

Fail fast at startup if configuration is invalid:

```dockerfile
FROM node:22-alpine AS base
RUN npm install -g zero-config-cli
COPY . .
ENTRYPOINT ["sh", "-c", "zero-config check && exec node server.js"]
```

### GitHub Actions

Validate configuration in your CI pipeline:

```yaml
jobs:
  config-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g zero-config-cli
      - run: zero-config check --json
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          PORT: "3000"
```

---

## Schema Variable Types

`zero-config` supports the following types out of the box:
- `string`: Any string
- `url`: Structural URL validation (e.g. `https://`, `postgres://`, `redis://`)
- `port`: Integer between 1 and 65535
- `bool`: `true`, `false`, `1`, `0`, `yes`, `no`
- `int`: Any valid integer
- `secret`: Always redacted in output (replaced with `[REDACTED]`)
- `email`: Contains an `@` symbol and valid local/domain parts
- `path`: Valid file path string
- `duration`: `10s`, `5m`, `2h`, `1d`
- `json`: Must be parseable JSON

---

## License
MIT
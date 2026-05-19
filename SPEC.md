# zero-config — Technical Specification
**Version:** 0.1.0-draft  
**Status:** Active — this document is the single source of truth for all implementation decisions  
**Last updated:** 2026-05-19  
**Language:** Zero (zerolang.ai) — compiler v0.1.2  
**Repository:** github.com/[owner]/zero-config  

---

## Document Conventions

- `MUST` / `MUST NOT` — non-negotiable requirements
- `SHOULD` / `SHOULD NOT` — strong preference; deviation requires a recorded justification
- `MAY` — optional; implementation discretion
- Code blocks labelled `zero` contain Zero source. Blocks labelled `json`, `shell`, `dotenv` are as described.
- All JSON output schemas in this document are normative contracts. Implementations MUST NOT add or remove top-level keys from defined output objects without a spec change.
- Design decisions are recorded in §16 (ADR log). Before changing any decision marked ADR-NNN, write a new ADR entry.

---

## Table of Contents

1. [Overview & Purpose](#1-overview--purpose)
2. [Context: The Zero Ecosystem](#2-context-the-zero-ecosystem)
3. [System Architecture](#3-system-architecture)
4. [Type System](#4-type-system)
5. [CLI Interface](#5-cli-interface)
6. [JSON Output Contracts](#6-json-output-contracts)
7. [Human-Readable Output](#7-human-readable-output)
8. [Error Code Catalogue](#8-error-code-catalogue)
9. [Schema Declaration Format](#9-schema-declaration-format)
10. [Skills System Integration](#10-skills-system-integration)
11. [File & Directory Structure](#11-file--directory-structure)
12. [Module Responsibilities](#12-module-responsibilities)
13. [Implementation Phases](#13-implementation-phases)
14. [Testing Strategy](#14-testing-strategy)
15. [Integration Reference](#15-integration-reference)
16. [Design Decision Record](#16-design-decision-record)
17. [Open Questions & Constraints](#17-open-questions--constraints)

---

## 1. Overview & Purpose

### 1.1 What zero-config is

`zero-config` is a Zero skill library and CLI tool that adds a typed, documented, agent-readable schema layer to application environment configuration. It wraps Zero's built-in `std.env` module with structured declarations, validation, and machine-readable output.

It is NOT:
- A secrets manager (no encryption, no vault integration at v1)
- A remote configuration service
- A replacement for the OS environment variable system
- A SaaS product

### 1.2 The problem it solves

Every application reads configuration from environment variables. The dominant pattern — the `.env` file — is a flat key=value text format with no types, no documentation, no required/optional distinction, and no machine-readable interface. This creates three classes of failure:

**Class 1 — Human error.** Missing required variables are discovered at runtime, not at startup. Type errors (port as string, boolean as integer) produce misleading panics rather than clear diagnostics.

**Class 2 — Operational drift.** New variables are added to one environment (dev) and silently missing from another (staging, production). There is no canonical schema to diff against.

**Class 3 — Agent opacity.** AI agents assisting with deployment, debugging, or environment setup cannot reason about configuration requirements. They cannot determine which variables are needed, what types they accept, or what valid values look like. Every interaction requires a human to interpret the `.env` file and relay its meaning.

### 1.3 The solution

`zero-config` provides:

1. A typed schema declaration format using Zero's native type system
2. A validation pipeline that checks the live environment against the schema
3. Structured JSON output for every command — the agent interface
4. A Zero skill registration so agents can call `zero skills get config --full` to retrieve the complete schema for any project

### 1.4 Scope at v1.0

**In scope:**
- 10 typed config variable types (String, Url, Port, Bool, Int, Secret, Email, Path, Duration, Json)
- Four CLI commands: check, inspect, generate, diff
- JSON output for all commands
- Human-readable text output for all commands
- Next.js, Express.js, Docker, and GitHub Actions integration examples
- Binary distribution: macOS ARM64, macOS x64, Linux x64, Linux ARM64
- npm wrapper (`npx zero-config`) for zero-friction installation

**Out of scope at v1.0:**
- Schema inheritance / composition
- Remote schema registries
- Secrets encryption or masking at write-time
- Watch mode / hot reload
- Windows native binary
- Plugin system

---

## 2. Context: The Zero Ecosystem

### 2.1 Zero language fundamentals

Zero is a systems language released by Vercel Labs on 2026-05-17 (v0.1.2). It compiles to sub-10KB native binaries and is designed explicitly for agent-native tooling. The key design properties relevant to this project:

**Explicit capabilities.** Functions declare what they touch via the `World` parameter. A function that reads environment variables MUST receive `world: World` — there is no hidden global env access. This is enforced at compile time.

```zero
// ✓ Correct — capability declared
pub fun load(world: World) -> AppConfig raises {
  let raw = check world.env.get("DATABASE_URL")
  ...
}

// ✗ Compile error — no access to env without World
pub fun load() -> AppConfig raises {
  let raw = check env.get("DATABASE_URL")  // NAM003: unknown identifier
}
```

**Machine-readable diagnostics.** `zero check --json` emits structured JSON. Every diagnostic includes a stable `code` (e.g. `NAM003`), a human message, line/column, and a `repair` hint with a typed action. This is the core agent interface of the toolchain.

**Skills system.** `zero skills get <name>` returns documentation for any installed skill. Skills are packages with a `skill.json` manifest. This is the primary mechanism by which agents discover what a package can do.

**Standard library modules relevant to this project:**
- `std.env` — environment variable access; `world.env.get(key: str) -> str? raises`
- `std.json` — JSON encode/decode; `json.encode(value) -> str` and `json.decode(str) -> JsonValue raises`
- `std.io` — I/O through `world.out` and `world.err`
- `std.args` — CLI argument parsing; `world.args.get(n: i32) -> str?`
- `std.fs` — file system access; `world.fs.read(path: str) -> str raises`

**Zero type primitives used in this project:**
- `str` — UTF-8 string
- `i32` — 32-bit signed integer
- `bool` — boolean
- `T?` — optional T (nullable)
- `[T]` — array of T
- `shape` — named record type (analogous to struct)
- `choice` — discriminated union (analogous to enum with data)
- `fun` — function declaration
- `pub` — public visibility modifier
- `raises` — marks a function as fallible (returns Result)
- `check` — unwraps a fallible expression; propagates error if it fails

### 2.2 The skills system — detailed

When a package includes a `skill.json` at its root, `zero skills get <skill-name>` returns a structured JSON object describing the skill's capabilities, types, and exports.

The command reads the `skill.json` from either:
1. A globally installed package (`~/.zero/skills/<name>/`)
2. The current project's dependencies
3. A local path (`zero skills get ./zero-config`)

The output is machine-readable and stable across versions. Agents use it to understand what functions are available, what types they accept, and what effects they have.

### 2.3 Why this is the right gap to fill

Zero's `std.env` module provides raw environment access: read a variable by name, get back a string or nil. It has no concept of:
- Expected variables and their types
- Required vs optional variables
- Documentation for each variable
- Validation logic
- Structured error reporting when variables are missing or invalid

`zero-config` is the schema layer. It is the idiomatic Zero way to declare "my application needs these variables with these types" and get structured, agent-readable validation in return. It should feel like a natural extension of `std.env`, not a replacement for it.

---

## 3. System Architecture

### 3.1 Component diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CALLER                                       │
│  Human (terminal) / AI Agent / CI system / Docker entrypoint       │
└───────────────┬─────────────────────────────────────────────────────┘
                │ CLI invocation: zero-config <command> [flags]
┌───────────────▼─────────────────────────────────────────────────────┐
│                    src/main.0  (CLI router)                         │
│  Parses world.args → dispatches to command module                   │
│  Applies --json flag globally                                       │
│  Handles --help, --version                                          │
└──┬──────────┬──────────┬──────────┬────────────────────────────────┘
   │          │          │          │
   ▼          ▼          ▼          ▼
check      inspect    generate    diff
cmd        cmd        cmd         cmd
   │          │          │          │
   └────┬─────┘          └────┬─────┘
        │                     │
        ▼                     ▼
┌───────────────┐    ┌────────────────┐
│  validation/  │    │   output/      │
│  validator.0  │    │   json.0       │
│  type_checks.0│    │   text.0       │
│  error_codes.0│    │   template.0   │
└───────┬───────┘    └────────────────┘
        │
        ▼
┌───────────────┐    ┌────────────────┐
│  schema/      │    │  std.env       │
│  types.0      │◄───┤  (Zero stdlib) │
│  registry.0   │    └────────────────┘
│  loader.0     │
└───────────────┘
```

### 3.2 Data flow: `zero-config check --json`

```
1. world.args parsed → Command.Check, flags: { json: true, envFile: nil }
2. loader.0: locate schema
   a. Look for config.0 in CWD
   b. If not found, look for zero-config.json in CWD
   c. If not found, error CFG000 (no schema found)
3. registry.0: load schema → AppConfig (list of ConfigVar)
4. validator.0: for each ConfigVar:
   a. Read from world.env.get(var.name)
   b. If required and nil → ValidationError { code: CFG001, ... }
   c. If set → type_checks.0 per var.type → ValidationError? 
5. output/json.0: serialize CheckResult to JSON string
6. world.out.write(json_string)
7. exit 0 if result.ok else exit 1
```

### 3.3 Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success — all validations passed (check), or command completed (inspect/generate) |
| 1 | Validation failure — one or more errors in `check` |
| 2 | Usage error — invalid command or flag |
| 3 | Schema error — schema file not found or unparseable |
| 4 | System error — unexpected internal failure |

Exit codes MUST be stable across versions. They are part of the public contract.

---

## 4. Type System

All type declarations live in `src/schema/types.0`. They are the canonical definitions. If a type appears elsewhere in this spec, the `types.0` definition takes precedence.

### 4.1 ConfigType

The complete set of recognized environment variable types. No other type identifiers are valid.

```zero
pub choice ConfigType {
  String      // Any UTF-8 string value. No format validation.
  Url         // Valid URL. Schemes validated per §4.3.
  Port        // Integer in range 1–65535 inclusive.
  Bool        // Canonical values: "true","false","1","0","yes","no" (case-insensitive).
  Int         // Parseable as i64. No range constraint at v1.
  Secret      // String; value is redacted in all output. Format not validated.
  Email       // Must contain exactly one @, non-empty local and domain parts.
  Path        // Non-empty string. Existence NOT checked unless --check-paths flag set.
  Duration    // Pattern: /^\d+[smhd]$/ — e.g. "30s", "5m", "2h", "1d".
  Json        // Must be parseable by std.json. Any valid JSON value.
}
```

### 4.2 ConfigVar

The declaration for a single environment variable.

```zero
pub shape ConfigVar {
  name:        str            // Variable name. MUST match /^[A-Z][A-Z0-9_]*$/.
  type:        ConfigType     // Expected type. MUST be a valid ConfigType member.
  required:    bool           // If true, absence is an error. If false, absence is allowed.
  description: str            // Human + agent readable. MUST NOT be empty.
  example:     str            // A valid example value. Used in generate output.
  default:     str?           // Default used in generate output. nil if no default.
  deprecated:  bool           // If true, presence produces a CFG004 warning.
  tags:        [str]          // Optional labels for grouping. e.g. ["database", "required"]
}
```

Constraints:
- `name` MUST match regex `/^[A-Z][A-Z0-9_]*$/` — uppercase with underscores only
- `description` MUST NOT be empty string
- `example` MUST NOT be empty string
- If `required` is false and `default` is nil, `generate` outputs the variable commented out
- If `required` is false and `default` is set, `generate` outputs the variable with the default value
- `deprecated` and `required` MUST NOT both be true (a required variable cannot be deprecated)
- Tags are informational only; no behaviour is attached to specific tag values at v1

### 4.3 URL scheme validation

A value passes `Url` type checking if and only if:
1. It is non-empty
2. It begins with one of the following scheme prefixes (case-insensitive):
   - `http://` or `https://`
   - `postgres://` or `postgresql://`
   - `mysql://` or `mariadb://`
   - `redis://` or `rediss://`
   - `mongodb://` or `mongodb+srv://`
   - `amqp://` or `amqps://`
   - `smtp://` or `smtps://`
   - `ftp://` or `ftps://`
   - `s3://`
3. The scheme prefix is followed by at least one non-empty character

The implementation MUST NOT make network requests to validate URLs. Structural validation only.

### 4.4 AppConfig

The top-level schema object. This is what a project declares.

```zero
pub shape AppConfig {
  name:        str        // Project or application name. Used in output headers.
  version:     str        // Schema version. Semver string. e.g. "1.0.0".
  variables:   [ConfigVar]
}
```

### 4.5 ValidationError

A single diagnostic produced by the validator.

```zero
pub shape ValidationError {
  code:      str           // Error code from catalogue (§8). e.g. "CFG001".
  severity:  Severity      // error | warning
  variable:  str           // The variable name this error concerns.
  value:     str?          // The actual value found, if one exists. nil for missing vars.
  message:   str           // Human-readable explanation.
  repair:    RepairHint    // Machine-readable fix suggestion.
}

pub choice Severity {
  Error
  Warning
}
```

### 4.6 RepairHint

Every `ValidationError` MUST include a `RepairHint`. This is the primary agent interface for automated fixing.

```zero
pub shape RepairHint {
  id:         str    // Action identifier. Stable across versions. See §4.7.
  variable:   str    // The variable name to act on.
  type:       str    // The expected ConfigType as a lowercase string.
  example:    str?   // A valid example value, if available from the schema.
  constraint: str?   // Human-readable constraint description. e.g. "1 ≤ value ≤ 65535"
}
```

### 4.7 RepairHint.id catalogue

The `id` field in `RepairHint` MUST be one of the following stable identifiers:

| id | Meaning | Typical action |
|----|---------|----------------|
| `set-missing-required` | Variable is absent; must be set | Add variable to environment |
| `fix-invalid-type` | Value exists but fails type check | Replace value with correctly typed value |
| `fix-invalid-format` | Value is correct type but wrong format | Correct the format (e.g. URL scheme) |
| `remove-deprecated` | Variable is deprecated; should be removed | Delete the variable |
| `fix-unknown-variable` | Variable not in schema (strict mode only) | Remove variable or add to schema |

### 4.8 CheckResult

The complete result of a `check` command run.

```zero
pub shape CheckResult {
  ok:          bool
  timestamp:   str           // ISO 8601 UTC. e.g. "2026-05-22T14:30:00Z"
  schema_name: str
  version:     str
  summary:     CheckSummary
  diagnostics: [ValidationError]
}

pub shape CheckSummary {
  total:    i32   // Total variables in schema
  valid:    i32   // Variables that passed validation
  errors:   i32   // Errors (severity: Error)
  warnings: i32   // Warnings (severity: Warning)
}
```

### 4.9 InspectResult

The complete result of an `inspect` command run.

```zero
pub shape InspectResult {
  skill:     str          // Always "config"
  version:   str          // zero-config package version
  schema:    SchemaInfo
}

pub shape SchemaInfo {
  name:      str
  version:   str
  variables: [ConfigVar]
}
```

### 4.10 DiffResult

```zero
pub shape DiffResult {
  ok:        bool
  left:      str           // Label for left environment (filename or "env")
  right:     str           // Label for right environment
  missing_in_left:  [str]  // Variable names present in schema, missing in left
  missing_in_right: [str]  // Variable names present in schema, missing in right
  type_mismatches:  [DiffMismatch]
}

pub shape DiffMismatch {
  variable:    str
  left_value:  str?
  right_value: str?
  type:        str
}
```

---

## 5. CLI Interface

### 5.1 Root command

```
zero-config [--version] [--help]
zero-config <command> [flags]
```

Global flags (apply to all commands):
- `--json` — emit machine-readable JSON to stdout instead of human-readable text. Errors also go to stdout in JSON format when this flag is set.
- `--schema <path>` — path to schema file (`.0` or `.json`). Default: auto-discover (§9.3).
- `--version` — print `zero-config <semver>` and exit 0
- `--help` — print usage and exit 0

### 5.2 `check` command

Validate the current process environment (or a specified `.env` file) against the schema.

```
zero-config check [flags]

Flags:
  --env-file <path>     Read variables from file instead of process environment.
                        File format: standard dotenv (KEY=VALUE, comments with #).
  --strict              Treat unknown variables (not in schema) as warnings.
  --check-paths         For Path-typed variables, verify that the path exists on disk.
  --json                JSON output (global).
  --schema <path>       Schema file (global).
```

**Behaviour:**
- Reads each variable in the schema against the environment source
- Validates type, format, and required/optional status
- Produces a `CheckResult` (§4.8)
- Exits 0 if `ok: true`, exits 1 if `ok: false`
- Secrets are redacted in all output (replaced with `[REDACTED]`)
- With `--strict`: variables present in environment but absent from schema produce `CFG005` warnings

**Example invocations:**
```shell
zero-config check
zero-config check --json
zero-config check --env-file .env.staging --json
zero-config check --strict --json
zero-config check --schema ./config/app-config.0 --json
```

### 5.3 `inspect` command

Return the full schema documentation without touching the live environment.

```
zero-config inspect [flags]

Flags:
  --json       JSON output (global).
  --schema     Schema file (global).
```

**Behaviour:**
- Does NOT read from `world.env`
- Loads the schema declaration and serializes it
- Always exits 0 (unless schema cannot be loaded — exit 3)
- Primary use case: agents discovering what a project needs before configuring it

**Example invocations:**
```shell
zero-config inspect
zero-config inspect --json
zero-config inspect --schema ./config/app-config.0
```

### 5.4 `generate` command

Write a `.env.template` file from the schema. This file documents every variable with its type, description, example, and whether it is required or optional.

```
zero-config generate [flags]

Flags:
  --output <path>   Write template to this path. Default: .env.template in CWD.
  --stdout          Print template to stdout instead of writing file.
  --overwrite       Overwrite existing file. Default: error if file exists.
  --schema          Schema file (global).
```

**Behaviour:**
- Does NOT read from `world.env`
- Writes a human-editable dotenv file with comments
- Required variables: uncommented with placeholder value
- Optional variables with default: uncommented with default value
- Optional variables without default: commented out
- Deprecated variables: commented out with deprecation note
- Variables are grouped: required first, optional second, deprecated last
- Exits 0 on success, 3 if schema not found, 4 if write fails

**Note:** `generate` does NOT have a `--json` flag. The output is always the template file (or stdout). Rationale: the template is inherently a text artifact for human editing.

### 5.5 `diff` command

Compare two environment sources against the schema. Useful for promoting config between environments.

```
zero-config diff <left> <right> [flags]

Arguments:
  left    Path to first .env file, OR "env" to use the live process environment.
  right   Path to second .env file, OR "env" to use the live process environment.

Flags:
  --json      JSON output (global).
  --schema    Schema file (global).
```

**Behaviour:**
- Loads both environment sources
- For each variable in the schema, compares presence and type-validity in both sources
- Reports variables missing in left, missing in right, and type mismatches between the two
- Does NOT compare values directly (to avoid leaking secrets in output) — only presence and type-validity
- Exits 0 if no errors, 1 if differences found, 3 if schema error

**Example invocations:**
```shell
zero-config diff .env.development .env.staging --json
zero-config diff env .env.staging
zero-config diff .env.v1 .env.v2 --json
```

---

## 6. JSON Output Contracts

These are normative. Agent integrations MUST be written against these exact schemas. Any deviation is a bug.

### 6.1 `check --json` — success case

```json
{
  "ok": true,
  "timestamp": "2026-05-22T14:30:00Z",
  "schema_name": "my-nextjs-app",
  "version": "1.0.0",
  "summary": {
    "total": 6,
    "valid": 6,
    "errors": 0,
    "warnings": 0
  },
  "diagnostics": []
}
```

### 6.2 `check --json` — failure case

```json
{
  "ok": false,
  "timestamp": "2026-05-22T14:30:00Z",
  "schema_name": "my-nextjs-app",
  "version": "1.0.0",
  "summary": {
    "total": 6,
    "valid": 4,
    "errors": 2,
    "warnings": 0
  },
  "diagnostics": [
    {
      "code": "CFG001",
      "severity": "error",
      "variable": "DATABASE_URL",
      "value": null,
      "message": "DATABASE_URL is required but not set",
      "repair": {
        "id": "set-missing-required",
        "variable": "DATABASE_URL",
        "type": "url",
        "example": "postgres://user:password@localhost:5432/appdb",
        "constraint": null
      }
    },
    {
      "code": "CFG002",
      "severity": "error",
      "variable": "PORT",
      "value": "99999",
      "message": "PORT must be a valid port number (1–65535), got: 99999",
      "repair": {
        "id": "fix-invalid-type",
        "variable": "PORT",
        "type": "port",
        "example": "3000",
        "constraint": "1 ≤ value ≤ 65535"
      }
    }
  ]
}
```

### 6.3 `check --json` — with warnings (strict mode)

```json
{
  "ok": true,
  "timestamp": "2026-05-22T14:30:00Z",
  "schema_name": "my-nextjs-app",
  "version": "1.0.0",
  "summary": {
    "total": 6,
    "valid": 6,
    "errors": 0,
    "warnings": 2
  },
  "diagnostics": [
    {
      "code": "CFG004",
      "severity": "warning",
      "variable": "LEGACY_API_URL",
      "value": "[REDACTED]",
      "message": "LEGACY_API_URL is deprecated and should be removed",
      "repair": {
        "id": "remove-deprecated",
        "variable": "LEGACY_API_URL",
        "type": "url",
        "example": null,
        "constraint": null
      }
    },
    {
      "code": "CFG005",
      "severity": "warning",
      "variable": "VITE_DEBUG_MODE",
      "value": "true",
      "message": "VITE_DEBUG_MODE is set but not declared in the schema (--strict mode)",
      "repair": {
        "id": "fix-unknown-variable",
        "variable": "VITE_DEBUG_MODE",
        "type": "unknown",
        "example": null,
        "constraint": null
      }
    }
  ]
}
```

**Key rules for the diagnostics array:**
- Errors come before warnings
- Within each severity, variables appear in schema declaration order
- `value` is `null` (JSON null) when the variable is absent from the environment
- `value` is `"[REDACTED]"` (literal string) when the variable is of type `Secret`
- All other values appear as their raw string from the environment

### 6.4 `inspect --json`

```json
{
  "skill": "config",
  "version": "1.0.0",
  "schema": {
    "name": "my-nextjs-app",
    "version": "1.0.0",
    "variables": [
      {
        "name": "DATABASE_URL",
        "type": "url",
        "required": true,
        "description": "PostgreSQL connection string for the primary database",
        "example": "postgres://user:password@localhost:5432/appdb",
        "default": null,
        "deprecated": false,
        "tags": ["database"]
      },
      {
        "name": "API_SECRET_KEY",
        "type": "secret",
        "required": true,
        "description": "HMAC signing key for API authentication tokens",
        "example": "[generate-a-32-char-random-string]",
        "default": null,
        "deprecated": false,
        "tags": ["auth", "security"]
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
      },
      {
        "name": "REDIS_URL",
        "type": "url",
        "required": false,
        "description": "Redis connection URL for session cache. If absent, sessions are stored in memory.",
        "example": "redis://localhost:6379",
        "default": null,
        "deprecated": false,
        "tags": ["cache"]
      },
      {
        "name": "DEBUG",
        "type": "bool",
        "required": false,
        "description": "Enable verbose debug logging",
        "example": "false",
        "default": "false",
        "deprecated": false,
        "tags": []
      },
      {
        "name": "LEGACY_SESSION_SECRET",
        "type": "secret",
        "required": false,
        "description": "Deprecated: use API_SECRET_KEY instead",
        "example": "",
        "default": null,
        "deprecated": true,
        "tags": []
      }
    ]
  }
}
```

**Rules for inspect output:**
- Variables appear in schema declaration order
- Deprecated variables are included (agents need to know they exist to warn about them)
- `default` is `null` when no default is declared (not omitted — always present)
- ConfigType members are serialized as lowercase strings: `"url"`, `"port"`, `"bool"`, etc.

### 6.5 `diff --json`

```json
{
  "ok": false,
  "left": ".env.development",
  "right": ".env.staging",
  "missing_in_left": [],
  "missing_in_right": ["REDIS_URL", "SMTP_HOST"],
  "type_mismatches": [
    {
      "variable": "PORT",
      "left_value": "3000",
      "right_value": "not-a-port",
      "type": "port"
    }
  ]
}
```

**Rules for diff output:**
- `ok` is `true` only when both arrays are empty and `type_mismatches` is empty
- Variable names in `missing_in_left` and `missing_in_right` appear in schema declaration order
- `left_value` and `right_value` in mismatches: secrets show `"[REDACTED]"`, absent values show `null`

### 6.6 Error envelope (all commands, --json, when a system error occurs)

When a system-level failure occurs (schema not found, parse error, filesystem error), the output is:

```json
{
  "ok": false,
  "error": {
    "code": "CFG000",
    "message": "No schema found. Expected config.0 or zero-config.json in /current/directory",
    "hint": "Run `zero new cli my-schema` to create a Zero project, then add zero-config as a dependency."
  }
}
```

Exit code is 3 for schema errors, 4 for system errors.

---

## 7. Human-Readable Output

When `--json` is NOT set, output is formatted for terminal reading. This section defines the format.

### 7.1 `check` — success

```
✓ zero-config check — my-nextjs-app v1.0.0
  6 variables · 6 valid · 0 errors · 0 warnings
```

### 7.2 `check` — failure

```
✗ zero-config check — my-nextjs-app v1.0.0
  6 variables · 4 valid · 2 errors · 0 warnings

  [CFG001] DATABASE_URL — required but not set
           Type: url
           Example: postgres://user:password@localhost:5432/appdb
           Fix: set DATABASE_URL in your environment

  [CFG002] PORT — invalid type
           Value: 99999
           Expected: port (1–65535)
           Fix: set PORT to a value between 1 and 65535
```

### 7.3 `inspect` — human format

```
zero-config schema — my-nextjs-app v1.0.0
6 variables declared

REQUIRED (3)
  DATABASE_URL   url      PostgreSQL connection string for the primary database
  API_SECRET_KEY secret   HMAC signing key for API authentication tokens
  SMTP_HOST      string   SMTP server hostname for transactional email

OPTIONAL (2)
  PORT           port     HTTP server listening port (default: 3000)
  DEBUG          bool     Enable verbose debug logging (default: false)

DEPRECATED (1)
  LEGACY_SESSION_SECRET   Use API_SECRET_KEY instead
```

### 7.4 `generate` — output file format

```dotenv
# zero-config template
# Schema: my-nextjs-app v1.0.0
# Generated: 2026-05-22T14:30:00Z
# 
# This file was generated from your zero-config schema.
# Copy to .env and fill in the values.
# Do not commit .env to source control.

# ──────────────────────────────────────────────────────
# REQUIRED — must be set before the application starts
# ──────────────────────────────────────────────────────

# DATABASE_URL (url)
# PostgreSQL connection string for the primary database
# Example: postgres://user:password@localhost:5432/appdb
DATABASE_URL=

# API_SECRET_KEY (secret)
# HMAC signing key for API authentication tokens
# Example: [generate-a-32-char-random-string]
API_SECRET_KEY=

# SMTP_HOST (string)
# SMTP server hostname for transactional email
# Example: smtp.sendgrid.net
SMTP_HOST=

# ──────────────────────────────────────────────────────
# OPTIONAL — sensible defaults are applied if not set
# ──────────────────────────────────────────────────────

# PORT (port) — default: 3000
# HTTP server listening port
PORT=3000

# DEBUG (bool) — default: false
# Enable verbose debug logging
# DEBUG=false

# ──────────────────────────────────────────────────────
# DEPRECATED — remove these from your environment
# ──────────────────────────────────────────────────────

# LEGACY_SESSION_SECRET (secret) — DEPRECATED
# Use API_SECRET_KEY instead
# LEGACY_SESSION_SECRET=
```

---

## 8. Error Code Catalogue

All error codes are stable across versions. A code, once assigned, MUST NOT be reused for a different error.

| Code | Severity | Condition | Message template |
|------|----------|-----------|-----------------|
| CFG000 | Error | No schema found | `No schema found in <path>` |
| CFG001 | Error | Required variable absent | `<NAME> is required but not set` |
| CFG002 | Error | Value fails type check | `<NAME> must be a valid <type>, got: <value>` |
| CFG003 | Error | Value fails format check | `<NAME> has an invalid format: <detail>` |
| CFG004 | Warning | Deprecated variable is set | `<NAME> is deprecated and should be removed` |
| CFG005 | Warning | Unknown variable (strict) | `<NAME> is set but not declared in the schema` |
| CFG006 | Error | Schema parse error | `Schema file is not valid: <detail>` |
| CFG007 | Error | Duplicate variable name | `Variable <NAME> is declared more than once` |
| CFG008 | Error | Invalid variable name | `<NAME> is not a valid variable name (must match [A-Z][A-Z0-9_]*)` |
| CFG009 | Error | Empty required field | `ConfigVar.<field> must not be empty` |
| CFG010 | Error | Both deprecated and required | `<NAME> cannot be both required and deprecated` |

---

## 9. Schema Declaration Format

A project declares its configuration schema by providing a source file that zero-config can load. Two formats are supported.

### 9.1 Zero native format (`.0` file) — preferred

The Zero native format uses Zero source code to declare the schema. This is the idiomatic approach for projects already using Zero.

```zero
// config.0 — project configuration schema
use zero-config

pub let schema = AppConfig {
  name: "my-nextjs-app",
  version: "1.0.0",
  variables: [
    ConfigVar {
      name:        "DATABASE_URL",
      type:        ConfigType.Url,
      required:    true,
      description: "PostgreSQL connection string for the primary database",
      example:     "postgres://user:password@localhost:5432/appdb",
      default:     nil,
      deprecated:  false,
      tags:        ["database"]
    },
    ConfigVar {
      name:        "API_SECRET_KEY",
      type:        ConfigType.Secret,
      required:    true,
      description: "HMAC signing key for API authentication tokens",
      example:     "[generate-a-32-char-random-string]",
      default:     nil,
      deprecated:  false,
      tags:        ["auth", "security"]
    },
    ConfigVar {
      name:        "PORT",
      type:        ConfigType.Port,
      required:    false,
      description: "HTTP server listening port",
      example:     "3000",
      default:     "3000",
      deprecated:  false,
      tags:        []
    }
  ]
}
```

### 9.2 JSON format (`zero-config.json`) — portable fallback

For projects not using Zero (most projects initially), the JSON format is identical to the `inspect --json` `schema` object:

```json
{
  "name": "my-nextjs-app",
  "version": "1.0.0",
  "variables": [
    {
      "name": "DATABASE_URL",
      "type": "url",
      "required": true,
      "description": "PostgreSQL connection string for the primary database",
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

The JSON format supports all the same fields as the Zero native format. Behaviour is identical.

### 9.3 Schema auto-discovery

When `--schema` is not specified, zero-config searches for a schema file in this priority order:

1. `config.0` in the current working directory
2. `zero-config.0` in the current working directory
3. `zero-config.json` in the current working directory
4. `config/app-config.0` relative to CWD
5. `config/zero-config.json` relative to CWD

If no schema is found after all five locations, emit CFG000 and exit 3.

The first match wins. Search MUST NOT recurse into subdirectories beyond `config/`.

---

## 10. Skills System Integration

### 10.1 skill.json manifest

This file MUST exist at the package root. It is read by `zero skills get config`.

```json
{
  "name": "config",
  "version": "1.0.0",
  "description": "Typed, validated, agent-readable environment configuration for Zero applications",
  "author": "[owner]",
  "repository": "https://github.com/[owner]/zero-config",
  "license": "MIT",
  "keywords": ["config", "env", "environment", "configuration", "validation"],
  "capabilities": ["env"],
  "zero_version": ">=0.1.2",
  "exports": {
    "load": {
      "signature": "fun load(world: World, schema: AppConfig) -> AppConfig raises",
      "description": "Load and validate the application configuration. Returns the validated config or raises on error.",
      "effects": ["env.read"],
      "example": "let config = check zero_config.load(world, my_schema)"
    },
    "check": {
      "signature": "fun check(world: World, schema: AppConfig) -> CheckResult raises",
      "description": "Validate the current environment against the schema. Returns CheckResult with all diagnostics.",
      "effects": ["env.read"],
      "example": "let result = check zero_config.check(world, my_schema)"
    },
    "inspect": {
      "signature": "fun inspect(schema: AppConfig) -> InspectResult",
      "description": "Return the schema as a structured InspectResult. No environment access.",
      "effects": [],
      "example": "let docs = zero_config.inspect(my_schema)"
    },
    "generate": {
      "signature": "fun generate(schema: AppConfig) -> str",
      "description": "Generate a .env template string from the schema.",
      "effects": [],
      "example": "let template = zero_config.generate(my_schema)"
    }
  },
  "types": {
    "ConfigType": {
      "kind": "choice",
      "values": ["String", "Url", "Port", "Bool", "Int", "Secret", "Email", "Path", "Duration", "Json"],
      "description": "The set of recognized environment variable types"
    },
    "ConfigVar": {
      "kind": "shape",
      "fields": {
        "name": { "type": "str", "description": "Variable name. Must match [A-Z][A-Z0-9_]*" },
        "type": { "type": "ConfigType", "description": "Expected type" },
        "required": { "type": "bool", "description": "Whether the variable must be set" },
        "description": { "type": "str", "description": "Human and agent readable documentation" },
        "example": { "type": "str", "description": "A valid example value" },
        "default": { "type": "str?", "description": "Default value for generate output" },
        "deprecated": { "type": "bool", "description": "Whether this variable is deprecated" },
        "tags": { "type": "[str]", "description": "Optional grouping labels" }
      }
    },
    "AppConfig": {
      "kind": "shape",
      "fields": {
        "name": { "type": "str" },
        "version": { "type": "str" },
        "variables": { "type": "[ConfigVar]" }
      }
    }
  }
}
```

### 10.2 Expected `zero skills get config --full` output

When a developer or agent runs `zero skills get config --full` in a project with zero-config installed, they receive the complete `skill.json` content formatted as structured JSON. This is the primary agent discovery interface.

An agent receiving this output can:
- Know exactly which ConfigType values are valid
- Know all fields required to declare a ConfigVar
- Call `inspect` to get the project-specific schema
- Call `check` to validate the current environment
- Call `generate` to produce a template for a new environment

### 10.3 Installation and availability

At v1.0, zero-config is installed via:

```shell
# Option 1: Via Zero (native, recommended for Zero projects)
zero add zero-config

# Option 2: Via npm (for any project — wraps the native binary)
npm install -g zero-config-cli
# or without global install:
npx zero-config check --json
```

The npm wrapper (`zero-config-cli` package):
- Downloads the correct native binary for the current OS/arch on first run
- Passes all arguments through to the native binary
- Is NOT a Node.js reimplementation — it is a thin wrapper around the compiled Zero binary

---

## 11. File & Directory Structure

```
zero-config/
├── zero.json                     Package manifest
├── skill.json                    Skill documentation (§10.1)
├── README.md                     Project README — primary marketing asset
├── CHANGELOG.md                  Versioned change log
├── LICENSE                       MIT
├── SPEC.md                       This document
│
├── src/
│   ├── main.0                    CLI entry point — parses args, dispatches to commands
│   │
│   ├── schema/
│   │   ├── types.0               All type declarations (§4) — single source of truth
│   │   ├── registry.0            In-memory schema storage; exposes AppConfig
│   │   └── loader.0              Locates and parses schema files (§9.3)
│   │
│   ├── commands/
│   │   ├── check.0               check command (§5.2)
│   │   ├── inspect.0             inspect command (§5.3)
│   │   ├── generate.0            generate command (§5.4)
│   │   └── diff.0                diff command (§5.5)
│   │
│   ├── validation/
│   │   ├── validator.0           Orchestrates per-variable validation
│   │   ├── type_checks.0         Per-type validation: is_valid_url, is_valid_port, etc.
│   │   └── error_codes.0         Error code constants (CFG001–CFG010)
│   │
│   ├── output/
│   │   ├── json.0                Serializes result types to JSON strings (§6)
│   │   ├── text.0                Formats results as human-readable terminal output (§7)
│   │   └── template.0            Generates .env.template content (§7.4)
│   │
│   └── lib.0                     Public API — the importable library surface
│
├── examples/
│   ├── README.md                 Index of all examples
│   ├── nextjs/
│   │   ├── config.0              Schema for a typical Next.js app
│   │   ├── zero-config.json      Same schema in JSON format
│   │   └── README.md
│   ├── express/
│   │   ├── config.0
│   │   └── README.md
│   ├── docker/
│   │   ├── config.0
│   │   ├── Dockerfile            Shows zero-config check at container startup
│   │   └── README.md
│   └── github-actions/
│       ├── config.0
│       ├── .github/
│       │   └── workflows/
│       │       └── config-check.yml
│       └── README.md
│
├── tests/
│   ├── validation_test.0         Unit tests: one per ConfigType per valid/invalid case
│   ├── commands_test.0           Integration tests: each command against fixtures
│   ├── loader_test.0             Schema auto-discovery tests
│   └── fixtures/
│       ├── schemas/
│       │   ├── basic.json        Minimal schema (3 vars)
│       │   ├── full.json         All 10 types represented
│       │   ├── deprecated.json   Contains deprecated variables
│       │   └── invalid.json      Malformed schema for error path testing
│       ├── envs/
│       │   ├── valid.env         All required vars set correctly
│       │   ├── missing.env       Missing required vars
│       │   ├── wrong_types.env   Required vars set with wrong types
│       │   ├── deprecated.env    Includes deprecated variables
│       │   └── unknown.env       Includes undeclared variables
│       └── expected/             Golden JSON output files
│           ├── check_valid.json
│           ├── check_missing.json
│           ├── check_wrong_types.json
│           ├── check_deprecated_strict.json
│           ├── inspect_full.json
│           └── diff_dev_staging.json
│
└── npm/
    ├── package.json              npm wrapper package
    ├── index.js                  Wrapper: downloads binary, execs with passthrough args
    └── install.js                Post-install script: platform detection + binary download
```

---

## 12. Module Responsibilities

### 12.1 `src/main.0`

Single responsibility: parse CLI arguments and dispatch.

Does:
- Parse `world.args` to extract command name and flags
- Validate that command name is one of: `check`, `inspect`, `generate`, `diff`
- Pass the `--json` flag value down to command modules
- Call the appropriate command module's `run` function
- Handle `--version` and `--help` at the root level
- Write CFG000 to appropriate output and exit 3 if no command given

Does NOT:
- Contain any validation logic
- Contain any output formatting
- Access `world.env` directly

### 12.2 `src/schema/types.0`

Single responsibility: declare all types used across the project.

Does:
- Export all shapes and choices defined in §4
- Nothing else — no logic, no I/O

### 12.3 `src/schema/loader.0`

Single responsibility: locate and parse a schema file into an `AppConfig`.

Does:
- Implement the auto-discovery algorithm (§9.3)
- Parse `.0` schema files (extract the `schema` let binding)
- Parse `zero-config.json` files via `std.json`
- Return `AppConfig raises` — raises CFG006 on parse errors, CFG007/CFG008/CFG009/CFG010 on validation errors

Does NOT:
- Access the live environment
- Do any type checking of variable values

### 12.4 `src/validation/type_checks.0`

Single responsibility: implement `is_valid(value: str, type: ConfigType) -> bool`.

Exports one function per ConfigType:
```zero
pub fun is_valid_url(value: str) -> bool
pub fun is_valid_port(value: str) -> bool
pub fun is_valid_bool(value: str) -> bool
pub fun is_valid_int(value: str) -> bool
pub fun is_valid_email(value: str) -> bool
pub fun is_valid_path(value: str) -> bool
pub fun is_valid_duration(value: str) -> bool
pub fun is_valid_json(value: str) -> bool raises
// String and Secret: always valid — no check function needed
```

Each function MUST be pure — no I/O, no env access, deterministic.

### 12.5 `src/validation/validator.0`

Single responsibility: given an `AppConfig` and an env source, produce a `[ValidationError]`.

Does:
- Iterate over `schema.variables`
- For each variable: read from env source, call appropriate type checker, build `ValidationError` if needed
- Apply strict mode logic if flag is set
- Handle redaction of Secret-typed values

### 12.6 `src/output/json.0`

Single responsibility: serialize result types to JSON strings.

Must produce output exactly matching the contracts in §6. Each result type has a dedicated serialization function:

```zero
pub fun check_result_to_json(result: CheckResult) -> str
pub fun inspect_result_to_json(result: InspectResult) -> str
pub fun diff_result_to_json(result: DiffResult) -> str
pub fun error_to_json(code: str, message: str, hint: str) -> str
```

---

## 13. Implementation Phases

Build in strict phase order. A phase is complete only when all its tests pass.

### Phase 1 — Schema types + inspect (Day 2 target)

**Goal:** `zero-config inspect --json` produces correct output.

Files to create:
- `src/schema/types.0` — complete type declarations
- `src/schema/loader.0` — JSON format parsing only (skip .0 format for now)
- `src/output/json.0` — `inspect_result_to_json` only
- `src/commands/inspect.0` — full implementation
- `src/main.0` — skeleton: dispatch to inspect only
- `tests/fixtures/schemas/basic.json` — 3-variable schema
- `tests/fixtures/expected/inspect_basic.json` — golden output

**Acceptance test:**
```shell
echo '{}' > fake.env
zero-config inspect --json --schema tests/fixtures/schemas/basic.json \
  | diff - tests/fixtures/expected/inspect_basic.json
# exit 0
```

### Phase 2 — Validation + check (Day 3 target)

**Goal:** `zero-config check --json` produces correct output for all error cases.

Files to create:
- `src/validation/type_checks.0` — all 8 type check functions
- `src/validation/validator.0`
- `src/validation/error_codes.0`
- `src/commands/check.0`
- `src/output/json.0` — add `check_result_to_json`
- `src/output/text.0` — check text output
- `tests/fixtures/envs/valid.env`
- `tests/fixtures/envs/missing.env`
- `tests/fixtures/envs/wrong_types.env`
- `tests/fixtures/expected/check_valid.json`
- `tests/fixtures/expected/check_missing.json`
- `tests/fixtures/expected/check_wrong_types.json`
- `tests/validation_test.0`

**Acceptance tests:**
```shell
# Test valid env
zero-config check --json --schema tests/fixtures/schemas/full.json \
  --env-file tests/fixtures/envs/valid.env \
  | diff - tests/fixtures/expected/check_valid.json

# Test missing required vars
zero-config check --json --schema tests/fixtures/schemas/full.json \
  --env-file tests/fixtures/envs/missing.env \
  | diff - tests/fixtures/expected/check_missing.json
echo $?  # must be 1

# Test wrong types
zero-config check --json --schema tests/fixtures/schemas/full.json \
  --env-file tests/fixtures/envs/wrong_types.env \
  | diff - tests/fixtures/expected/check_wrong_types.json
```

### Phase 3 — Generate + diff (Day 3 target)

Files to create:
- `src/output/template.0`
- `src/commands/generate.0`
- `src/commands/diff.0`
- `src/output/json.0` — add `diff_result_to_json`
- `tests/fixtures/envs/deprecated.env`
- `tests/fixtures/envs/unknown.env`

**Acceptance tests:**
```shell
zero-config generate --stdout --schema tests/fixtures/schemas/full.json \
  > /tmp/generated.env.template
# Manual review: required vars present and uncommented, optional vars commented, deprecated marked

zero-config diff tests/fixtures/envs/valid.env tests/fixtures/envs/missing.env \
  --json --schema tests/fixtures/schemas/full.json \
  | diff - tests/fixtures/expected/diff_dev_staging.json
```

### Phase 4 — Schema auto-discovery + .0 format loader (Day 4 target)

**Goal:** Running `zero-config check` in a project directory with a `config.0` file works without `--schema`.

Files to update:
- `src/schema/loader.0` — add `.0` file parsing, add auto-discovery
- `src/main.0` — wire up auto-discovery
- `tests/loader_test.0`

### Phase 5 — Examples + npm wrapper (Day 4 target)

Files to create:
- `examples/nextjs/config.0` and `zero-config.json`
- `examples/github-actions/.github/workflows/config-check.yml`
- `npm/package.json`, `npm/index.js`, `npm/install.js`
- Binary build targets: macOS ARM64, macOS x64, Linux x64, Linux ARM64

### Phase 6 — Skill registration (Day 4–5 target)

Files to create:
- `skill.json` (§10.1)
- Test: `zero skills get config --full` returns correct output

---

## 14. Testing Strategy

### 14.1 Test types

**Unit tests** (`*_test.0`): Test individual functions in isolation with no I/O. Zero's `zero test` command runs these.

**Golden file tests**: Execute CLI commands against fixture inputs and diff against expected JSON output files. Fail if any byte differs. Run with `npm run test:golden` (shell script wrapping zero-config invocations).

**Conformance tests** (`conformance/`): Follow Zero's own conformance test pattern. Verify CLI contract (flags, exit codes, output shapes).

### 14.2 Type check test matrix

Every type check function MUST be tested against the following cases:

| Type | Valid inputs | Invalid inputs |
|------|-------------|----------------|
| Url | `https://example.com`, `postgres://user:pass@localhost:5432/db`, `redis://localhost:6379` | `ftp-invalid`, ``, `not-a-url`, `javascript:alert(1)` |
| Port | `1`, `80`, `443`, `3000`, `65535` | `0`, `65536`, `-1`, `abc`, `3000.5`, `` |
| Bool | `true`, `false`, `TRUE`, `FALSE`, `1`, `0`, `yes`, `no`, `YES`, `NO` | `yes-no`, `2`, `tru`, `` |
| Int | `0`, `-1`, `999999`, `2147483647` | `1.5`, `abc`, ``, `1e5` |
| Email | `user@example.com`, `a@b.co` | `@example.com`, `user@`, `userexample.com`, `` |
| Duration | `30s`, `5m`, `2h`, `1d`, `100s` | `30`, `5minutes`, `1.5h`, `` |
| Json | `{}`, `[]`, `"string"`, `42`, `true`, `null` | `{bad json}`, `undefined`, `` |
| Path | `./config`, `/etc/app`, `relative/path` | `` (only empty is invalid at v1) |

Secret and String: always valid. No test case for these beyond "non-empty works" and "empty string is valid".

### 14.3 Golden file generation

Golden files in `tests/fixtures/expected/` are generated once by running the CLI against the fixtures and saving output. They are committed to git. Any change to output format requires regenerating golden files with an explicit command:

```shell
npm run test:regenerate-goldens
```

This MUST be a conscious action, not an automatic step in the test suite.

### 14.4 Exit code tests

Every exit code (0–4) MUST have at least one test case. Exit codes are verified with `echo $?` in the shell test script.

---

## 15. Integration Reference

### 15.1 GitHub Actions

```yaml
# .github/workflows/config-check.yml
name: Config validation

on: [push, pull_request]

jobs:
  config-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install zero-config
        run: npm install -g zero-config-cli
      
      - name: Validate configuration schema
        run: zero-config check --json
        env:
          # Required variables must be set as secrets in GitHub
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          API_SECRET_KEY: ${{ secrets.API_SECRET_KEY }}
          SMTP_HOST: ${{ secrets.SMTP_HOST }}
          # Optional variables can be set inline
          PORT: "3000"
          DEBUG: "false"
```

**Behaviour:** The workflow fails if any required variable is missing or has an invalid type. The JSON output is captured in the action log and readable by GitHub Copilot / other AI tools in the workflow context.

### 15.2 Docker

```dockerfile
FROM node:22-alpine AS base

# Install zero-config
RUN npm install -g zero-config-cli

COPY . .

# Validate config at startup, fail fast with structured output
ENTRYPOINT ["sh", "-c", "zero-config check --json && exec node server.js"]
```

**Behaviour:** Container exits with code 1 before the application starts if configuration is invalid. The JSON output is captured in container logs and parseable by log aggregation tools.

### 15.3 Next.js (application integration)

```javascript
// lib/config.js
import { execSync } from 'child_process'

export function validateConfig() {
  try {
    const result = JSON.parse(
      execSync('zero-config check --json', { encoding: 'utf8' })
    )
    if (!result.ok) {
      console.error('Configuration errors:', result.diagnostics)
      process.exit(1)
    }
    return result
  } catch (e) {
    console.error('zero-config not installed. Run: npm install -g zero-config-cli')
    process.exit(1)
  }
}
```

Call `validateConfig()` in `next.config.js` or at the top of your server entry point.

### 15.4 Zero native application

```zero
// In a Zero application that imports zero-config as a dependency
use zero-config

pub fun main(world: World) -> Void raises {
  let config = check zero_config.load(world, my_schema)
  // config.database_url, config.port, etc. are now typed and validated
  check world.out.write("Config loaded: " + config.app_name + "\n")
}
```

---

## 16. Design Decision Record

### ADR-001: Two schema formats (Zero native + JSON)

**Date:** 2026-05-19  
**Status:** Accepted

**Context:** zero-config is a Zero skill, but most projects are not written in Zero. Building a Zero-only schema format would limit adoption to a tiny audience at launch.

**Decision:** Support both a Zero native format (`config.0`) and a portable JSON format (`zero-config.json`). JSON format is the escape hatch; Zero format is the idiomatic path. Both produce identical runtime behaviour.

**Consequences:** Loader module must handle two parsers. JSON format is spec-identical to the `inspect --json` output's `schema` object — so a project can generate its schema from an existing JSON format using `inspect --json | jq .schema > zero-config.json`.

---

### ADR-002: No network requests in validators

**Date:** 2026-05-19  
**Status:** Accepted

**Context:** Url validation could verify that a URL is reachable. Path validation could verify filesystem existence.

**Decision:** No network requests in any validation function. Type and format checks are structural only. Filesystem checks are opt-in via `--check-paths`.

**Consequences:** False positives possible (URL structurally valid but unreachable). This is acceptable — startup-time validation should be fast and hermetic. Reachability testing belongs in health check tooling, not config validation.

---

### ADR-003: Secrets are always redacted in output

**Date:** 2026-05-19  
**Status:** Accepted

**Context:** CLI output including secret values (API keys, passwords) in logs or CI output is a security risk.

**Decision:** Any variable with type `Secret` has its value replaced with the literal string `"[REDACTED]"` in ALL output — JSON and human-readable. This applies even when `--json` is used. There is no `--show-secrets` flag at v1.

**Consequences:** Validators still receive the actual value for type checking. The redaction happens only at the output serialization layer (`output/json.0` and `output/text.0`). Validator and type_checks modules always see real values.

---

### ADR-004: check exits 1 even with warnings only when --strict is set

**Date:** 2026-05-19  
**Status:** Accepted

**Context:** Should warnings alone cause a non-zero exit?

**Decision:** In default mode: only `Error` severity causes exit 1. Warnings alone produce exit 0. In `--strict` mode: both errors and warnings cause exit 1. Rationale: teams should be able to add warnings to a schema without immediately breaking CI.

---

### ADR-005: npm wrapper downloads pre-compiled binary

**Date:** 2026-05-19  
**Status:** Accepted

**Context:** Zero projects install with `zero add`. But most projects are not Zero projects.

**Decision:** Publish a separate `zero-config-cli` npm package that downloads the correct pre-compiled binary (from GitHub Releases) on install. The npm package contains no Zero source — it is a thin shell around the compiled binary.

**Consequences:** GitHub Releases MUST include binaries for: darwin-arm64, darwin-x64, linux-x64 (musl), linux-arm64 (musl). The install script must handle the case where the binary download fails (fallback error message with manual install instructions).

---

### ADR-006: generate has no --json flag

**Date:** 2026-05-19  
**Status:** Accepted

**Context:** Should `generate` support `--json` for machine-readable output?

**Decision:** No. The `generate` command produces a dotenv template — a human-editable text artifact. Agents that need to understand the schema use `inspect --json`. `generate` output is human-consumable by design.

**Consequences:** `generate` is the only command that ignores the global `--json` flag. Document this exception clearly in the CLI help text.

---

## 17. Open Questions & Constraints

### OQ-001: Zero skills system API is undocumented at v0.1.2

**Status:** Unresolved  
**Impact:** §10 (Skills System Integration)  
**Notes:** The `skill.json` format is inferred from the Zero repository's `skill-data/` directory structure. The exact schema that `zero skills get` expects has not been confirmed against the actual parser. Before Phase 6 (skill registration), examine `zero/skill-data/` in the Zero repo to confirm the expected format. If the format differs, update §10.1 and the ADR log.

**Fallback:** If the skills system does not support custom skills at v0.1.2, skip Phase 6. Add skill registration to the v1.1 roadmap. The CLI and library still deliver full value without it.

### OQ-002: Zero `.0` file parsing in loader.0

**Status:** Unresolved  
**Impact:** Phase 4 (Schema auto-discovery + .0 format)  
**Notes:** Parsing a `.0` file to extract a `let schema = AppConfig { ... }` binding requires either: (a) using `zero check --json` output as a structured parse source, or (b) writing a simple parser for the subset of Zero syntax used in config declarations. Option (a) is preferred — it uses Zero's own parser and avoids maintaining a separate parser.

**Constraint:** At v0.1.2, `zero` may not expose a programmatic AST API. If it doesn't, start with JSON-only schema format (§9.2) and defer `.0` parsing to v1.1.

### OQ-003: Cross-compilation target coverage

**Status:** Open  
**Impact:** Phase 5 (npm wrapper binaries)  
**Notes:** Zero's cross-compilation guide lists `linux-musl-x64` as a confirmed target. Confirm macOS targets (`darwin-arm64`, `darwin-x64`) are supported before building the release pipeline. If darwin targets are not supported at v0.1.2, release Linux only and add macOS to v1.1.

### OQ-004: `zero test` command behaviour

**Status:** Open  
**Impact:** §14 (Testing Strategy)  
**Notes:** Zero's testing documentation (zerolang.ai/testing) must be read before writing any `*_test.0` files. The test runner API and assertion primitives are not yet confirmed from this spec's research. Do not assume Jest/Vitest conventions apply.

---

## Appendix A: Complete example — Next.js app

This is the reference example that accompanies the Gumroad migration guide.

### A.1 Schema (`config.0`)

```zero
use zero-config

pub let schema = AppConfig {
  name: "my-nextjs-app",
  version: "1.0.0",
  variables: [
    ConfigVar {
      name:        "DATABASE_URL",
      type:        ConfigType.Url,
      required:    true,
      description: "PostgreSQL connection string. Used by Prisma and pg directly.",
      example:     "postgres://postgres:password@localhost:5432/myapp_dev",
      default:     nil,
      deprecated:  false,
      tags:        ["database"]
    },
    ConfigVar {
      name:        "NEXTAUTH_SECRET",
      type:        ConfigType.Secret,
      required:    true,
      description: "Secret used to sign NextAuth.js JWTs. Generate with: openssl rand -hex 32",
      example:     "[run: openssl rand -hex 32]",
      default:     nil,
      deprecated:  false,
      tags:        ["auth"]
    },
    ConfigVar {
      name:        "NEXTAUTH_URL",
      type:        ConfigType.Url,
      required:    true,
      description: "Canonical URL of the application. Used by NextAuth.js for redirects.",
      example:     "http://localhost:3000",
      default:     nil,
      deprecated:  false,
      tags:        ["auth"]
    },
    ConfigVar {
      name:        "NEXT_PUBLIC_API_URL",
      type:        ConfigType.Url,
      required:    false,
      description: "Public API base URL. Exposed to the browser. Must be HTTPS in production.",
      example:     "https://api.myapp.com",
      default:     "http://localhost:3000/api",
      deprecated:  false,
      tags:        ["public"]
    },
    ConfigVar {
      name:        "REDIS_URL",
      type:        ConfigType.Url,
      required:    false,
      description: "Redis URL for rate limiting and session caching. Uses in-memory store if absent.",
      example:     "redis://localhost:6379",
      default:     nil,
      deprecated:  false,
      tags:        ["cache"]
    },
    ConfigVar {
      name:        "RESEND_API_KEY",
      type:        ConfigType.Secret,
      required:    false,
      description: "Resend API key for transactional email. Email is disabled if absent.",
      example:     "re_xxxxxxxxxxxxxxxxxxxx",
      default:     nil,
      deprecated:  false,
      tags:        ["email"]
    },
    ConfigVar {
      name:        "NODE_ENV",
      type:        ConfigType.String,
      required:    false,
      description: "Node.js environment. Controls error verbosity and optimisation flags.",
      example:     "production",
      default:     "development",
      deprecated:  false,
      tags:        []
    }
  ]
}
```

### A.2 Generated `.env.template`

```dotenv
# zero-config template
# Schema: my-nextjs-app v1.0.0
# Generated: 2026-05-22T14:30:00Z

# ──────────────────────────────────────────────────────
# REQUIRED
# ──────────────────────────────────────────────────────

# DATABASE_URL (url) — database
# PostgreSQL connection string. Used by Prisma and pg directly.
# Example: postgres://postgres:password@localhost:5432/myapp_dev
DATABASE_URL=

# NEXTAUTH_SECRET (secret) — auth
# Secret used to sign NextAuth.js JWTs.
# Generate with: openssl rand -hex 32
NEXTAUTH_SECRET=

# NEXTAUTH_URL (url) — auth
# Canonical URL of the application. Used by NextAuth.js for redirects.
# Example: http://localhost:3000
NEXTAUTH_URL=

# ──────────────────────────────────────────────────────
# OPTIONAL
# ──────────────────────────────────────────────────────

# NEXT_PUBLIC_API_URL (url) — public — default: http://localhost:3000/api
# Public API base URL. Must be HTTPS in production.
NEXT_PUBLIC_API_URL=http://localhost:3000/api

# REDIS_URL (url) — cache
# Redis URL for rate limiting. Uses in-memory store if absent.
# REDIS_URL=redis://localhost:6379

# RESEND_API_KEY (secret) — email
# Resend API key. Email is disabled if absent.
# RESEND_API_KEY=

# NODE_ENV (string) — default: development
NODE_ENV=development
```

---

*This document is the authoritative specification for zero-config v1.0. Any implementation decision not covered here should be brought back to this document as a new section or ADR entry before implementation begins.*

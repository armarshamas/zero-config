# zero-config

Typed, validated, agent-readable environment configuration for Zero applications.

`zero-config` is a Zero skill library and CLI tool that adds a typed, documented, agent-readable schema layer to application environment configuration. It wraps Zero's built-in `std.env` module with structured declarations, validation, and machine-readable output.

## Key Features

- **Typed Schema Declaration**: Define your environment variables using Zero's native type system.
- **Automated Validation**: Check your live environment against the schema with clear, actionable error messages.
- **Agent Interface**: All commands emit structured JSON, allowing AI agents to reason about and configure your application.
- **Template Generation**: Automatically create `.env.template` files documented with types and examples.
- **Environment Diffing**: Compare configuration across different environments (e.g., development vs. staging).

## Quick Start

### Installation

```shell
# Via npm
npm install -g zero-config-cli

# Via Zero
zero add zero-config
```

### Usage

1. Create a `config.0` or `zero-config.json` file in your project root.
2. Run `zero-config check` to validate your environment.
3. Run `zero-config inspect` to see your schema documentation.
4. Run `zero-config generate` to create a `.env.template`.

## Documentation

For full documentation, see [SPEC.md](SPEC.md).

## License

MIT

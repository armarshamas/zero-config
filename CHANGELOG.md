# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-05-19

### Added
- Initial release of `zero-config` v1.0.0.
- Implemented `check`, `inspect`, `generate`, and `diff` CLI commands.
- Support for 10 configuration types (`String`, `Url`, `Port`, `Bool`, `Int`, `Secret`, `Email`, `Path`, `Duration`, `Json`).
- Built-in validation engine with JSON output contracts for AI agent readability.
- Schema auto-discovery for `zero-config.json`.
- Strict mode environment variable checking.
- Automated generation of `.env.template` files.
- Exported Zero library API via `lib.0`.
- Distribution via npm (`zero-config-cli`).
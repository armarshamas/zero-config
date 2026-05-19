FROM node:22-alpine AS base

# Install zero-config
RUN npm install -g zero-config-cli

COPY . .

# Validate config at startup, fail fast with structured output
ENTRYPOINT ["sh", "-c", "zero-config check --json && exec node server.js"]
# Actions Module

This directory contains the implementation of the Semantic Actions system for agent-browser.

## Architecture

The Semantic Actions system consists of several core modules:

### Core Modules (To Be Implemented)

- **types.ts** - Core type definitions and interfaces
- **vars.ts** - Variable interpolation and expression evaluation system
- **validator.ts** - YAML schema validation using Zod
- **loader.ts** - Action definition file loader
- **registry.ts** - Action registry with indexing and merging
- **executor.ts** - Action execution engine
- **version.ts** - Component version detection and management
- **selectors.ts** - Selector resolution with fallback chains
- **index.ts** - Public API exports

## Implementation Status

This is the foundation directory structure. Implementation will proceed according to the plan defined in [docs/plan.md](../../docs/plan.md).

See the implementation plan for PR breakdown and task tracking.

## Dependencies

- **yaml** (^2.3.0) - YAML parsing
- **zod** (^3.22.0) - Schema validation
- **semver** (^7.5.0) - Version comparison

## Design

For detailed design documentation, see:
- [Design Document](../../docs/design-v2.md)
- [Implementation Plan](../../docs/plan.md)
- [Conventions](../../docs/conventions.md)

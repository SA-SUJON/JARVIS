# JARVIS MARK_05 Architecture

MARK_05 is a clean architectural generation of JARVIS.

## Core Principles

1. One orchestration brain.
2. Tools are explicit capabilities.
3. Every privileged action passes through policy.
4. Agents do not bypass the core.
5. Providers are interchangeable.
6. Python is a runtime subsystem, not a second orchestration brain.
7. Every important action is observable and testable.

## Execution Pipeline

USER
  ↓
INTENT
  ↓
PLANNER
  ↓
POLICY
  ↓
ROUTER
  ↓
AGENT
  ↓
TOOL
  ↓
VERIFICATION
  ↓
MEMORY / EVENT
  ↓
RESPONSE

## Core Modules

- Orchestrator
- Planner
- Router
- Policy
- Tasks
- Memory
- Events

## Runtime Modules

- Python runtime
- Voice runtime
- Vision runtime

## External Capabilities

- AI providers
- Browser
- Windows system
- Filesystem
- ADB
- GitHub
- Image generation
- Telemetry

## Authority Levels

0 - Conversation
1 - Search / information retrieval
2 - Application control
3 - File modification
4 - System command execution
5 - Administrative / security operations

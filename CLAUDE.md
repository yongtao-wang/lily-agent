# CLAUDE.md

Project context lives in [AGENTS.md](AGENTS.md). Read that first — it's the agent-neutral entry point and covers what this project is, how to run it, the code map, and conventions.

## Claude-Code-specific notes

- **Plan files.** The plan from the original build session is at `/Users/yongtao/.claude/plans/build-app-based-on-memoized-gray.md`. Subsequent plans for this project should go in the same directory (`~/.claude/plans/`).

- **Auto-memory.** Project and user memories accumulate at `/Users/yongtao/.claude/projects/-Users-yongtao-Codes-lily-agent/memory/`. Check `MEMORY.md` there before re-asking the user about preferences or project facts you might already know.

- **Permissions are pre-allowed.** `.claude/settings.local.json` allows `Bash`, `Edit`, `Write` without prompts and has `defaultMode: "acceptEdits"`. You should be able to work without permission friction. If you do hit a prompt, check that file first.

- **Test recipes** are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). The development guide includes copy-pasteable curl commands for each of the 13 acceptance criteria.

- **No emojis** in code or docs unless explicitly asked — matches Yongtao's standing preference and matches the existing files.

- **Comment-light code by design.** Don't add JSDoc or explanatory comments unless the *why* is genuinely non-obvious. The `docs/` tree is the source of truth for design rationale.

## Quick start for a new Claude Code session

```bash
cd /Users/yongtao/Codes/lily-agent
cat AGENTS.md          # orient
ls docs/               # pick the deep-dive you need
npm run dev            # if you need to test
```

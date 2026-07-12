# KimiFlare VHS Demos

This directory contains [VHS](https://github.com/charmbracelet/vhs) `.tape` files for recording terminal demos of KimiFlare.

## Prerequisites

```bash
# macOS
brew install charmbracelet/tap/vhs

# Or via Go
go install github.com/charmbracelet/vhs@latest
```

## Recording a Demo

```bash
# Record a single demo
vhs demos/onboarding.tape

# Record all demos
vhs demos/*.tape

# Or use the npm script
npm run record-demos
```

## Available Demos

| Tape File | Focus | Output |
|-----------|-------|--------|
| `onboarding.tape` | First-run TUI experience | `docs/demos/onboarding.gif` |
| `permission-modal.tape` | Smart permission modal with inline feedback | `docs/demos/permission-modal.gif` |
| `cost-tracking.tape` | `/cost` command with gateway-confirmed totals | `docs/demos/cost-tracking.gif` |
| `plan-mode.tape` | Research-only plan mode blocking mutations | `docs/demos/plan-mode.gif` |
| `multi-model.tape` | Switching between AI models | `docs/demos/multi-model.gif` |

## Tips

- **Themes**: All tapes use `Catppuccin Mocha` for consistent dark branding.
- **Sizing**: 1200×700 at 14px font renders well on retina and scales cleanly.
- **Speed**: `Set TypingSpeed 50ms` feels natural; adjust per demo.
- **Looping GIFs**: VHS outputs loop automatically. Keep final sleeps ≥2s so the loop point isn't jarring.
- **Regenerating**: After UI changes, re-run `npm run record-demos` and commit the new GIFs.

## CI Automation

A GitHub Action can regenerate GIFs on release tags:

```yaml
# .github/workflows/record-demos.yml
name: Record Demos
on:
  push:
    tags: ['v*']
jobs:
  record:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: charmbracelet/vhs-action@v2
      - run: vhs demos/*.tape
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "chore: regenerate demo recordings"
```

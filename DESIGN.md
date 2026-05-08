# Kimiflare TUI Design System

## Overview

A terminal interface for Kimiflare that feels warm, calm, and editorial — like a well-designed native app that happens to live in your terminal. Designed by Quoc Huy, bybrandr.com.

The guiding principle is **generous whitespace with minimal chrome**: every element breathes, borders are thin and warm, rounded corners soften every container, and the UI steps back so the conversation takes center stage.

## Philosophy

| Principle | How it shows up |
|---|---|
| **Warmth over coldness** | Earthy tones, soft grays, no harsh black-on-white. Interface feels like paper, not glass. |
| **Rounded everything** | `╭─╮│╰╯` box-drawing exclusively. Sharp corners `┌─┐│└─┘` never appear. |
| **Whitespace as structure** | Padding is structural. Elements float in space rather than boxing each other in. |
| **Two-tone interaction** | Selected items get a filled background. Unselected items are bare. No underline, no bold gimmicks. |
| **Content-first** | Status bar is one quiet line. Chat has no borders. Overlays float centered. The AI's words are the hero. |

## Colors

### Default Theme: Kimiflare

The default theme borrows warmth from earthy palettes — cream surfaces, brown text, soft accents.

| Role | Hex | Usage |
|---|---|---|
| `surface` | `#2b2118` | Terminal background (warm dark brown) |
| `surface-raised` | `#362a1e` | Overlay backgrounds, slightly lifted |
| `on-surface` | `#e8ddd0` | Primary text — cream |
| `on-surface-dim` | `#9a8e80` | Secondary text, hints |
| `primary` | `#c4a574` | Accent — warm gold |
| `on-primary` | `#2b2118` | Text on primary fill |
| `secondary` | `#8aaa9e` | Secondary accent — sage |
| `error` | `#d4827a` | Error states — muted terracotta |
| `warn` | `#d4b070` | Warnings — muted amber |
| `success` | `#8aaa9e` | Success — sage |
| `border` | `#4a3f35` | Thin borders |
| `border-subtle` | `#3a3128` | Very faint borders |

### Theme Compatibility

The semantic token structure maps to all 14 built-in themes. Themes only override hex values — never structural roles. A Nord or Catppuccin theme will still feel "kimiflare-like" because the layout, spacing, and border philosophy remain.

## Borders & Corners

**Only rounded box-drawing characters are used throughout the entire interface.**

| Element | Characters | Weight |
|---|---|---|
| Overlays (palette, help, modals) | `╭──────────╮` `│          │` `╰──────────╯` | Single, thin |
| Inline panels | Same | Single, thin |
| Separators | `─` | Thin |
| Picker dropdowns | Same rounded set | Single, thin |

Sharp corners (`┌─┐│└─┘`) and heavy borders (`┏━┓┃┗━┛`) are forbidden.

## Spacing

| Token | Chars | Usage |
|---|---|---|
| `xs` | 1 | Tight internal gaps |
| `sm` | 2 | Default padding inside overlays |
| `md` | 4 | Generous padding — welcome, modals |
| `lg` | 6 | Major section breaks |

Whitespace is not an afterthought — it is the primary layout tool. Overlays have generous internal padding. Chat messages have breathing room between turns.

## Components

### Status Bar

One quiet line at the bottom. No frame. No border.

```
  edit  ·  kimi-k2.6  ·  medium  ·  main                      ctx 12%  ·  $0.001  ·  ~/project
```

- Left: mode badge (bare text, no brackets), model, effort, git branch — spaced with `·`
- Right: context %, cost, directory — aligned to terminal width
- Color: all `on-surface-dim` except mode name in `primary`
- No spinner icon — just text: `generating · 12s`

### Input Field

No border. No prompt symbol clutter. Just a caret.

```
  │ Explain the auth flow in this repo █
```

- `│` left margin (2ch indent) in `border` color
- Inverted block cursor `█` in `primary` color
- Text in `on-surface`

When picker active, dropdown appears directly below with rounded border:

```
    │ @
    ╭──────────────────────────╮
    │  src/app.tsx             │
    │  src/ui/chat.tsx         │
    │  @: mention a commit     │
    ╰──────────────────────────╯
```

### Command Palette (Ctrl+O)

Centered overlay, floating above chat history.

```
                                ╭──────────────────────────────╮
                                │  >                           │
                                │                              │
                                │  mode    use rush            │
                                │  mode    use large           │
                                │  mode    use deep            │
                                │  thread  switch              │
                                │  thread  new                 │
                                │  memory  stats               │
                                │                              │
                                ╰──────────────────────────────╯
```

- Rounded corners, thin border
- `>` as search prompt
- Items: noun (dim) + verb (normal)
- Selected item: background fill in `surface-raised`, or `primary` text
- No heavy chrome. Floats like a sheet of paper.

### Shortcuts Overlay (?)

Same centered overlay style.

```
                        ╭──────────────────────────────────────╮
                        │  Ctrl+O   command palette            │
                        │  Ctrl+R   toggle reasoning           │
                        │  ↑↓       history                    │
                        │  Tab      navigate messages          │
                        │  @ /      mention files/commands     │
                        │  Enter    submit                     │
                        │  Ctrl+C   interrupt / exit           │
                        │  Shift+↹  cycle mode                 │
                        │                                      │
                        ╰──────────────────────────────────────╯
```

- Keys aligned in a column, descriptions follow
- Hints in `on-surface-dim`
- Escape or `?` to dismiss

### Welcome Screen

When no conversation exists:

```




                      ╭────────────────────────╮
                      │                        │
                      │       kimiflare        │
                      │                        │
                      │   Ready when you are.  │
                      │                        │
                      │  › Explain this repo   │
                      │  › Find and fix a bug  │
                      │  › Refactor a file     │
                      │                        │
                      │   Type a message or    │
                      │   Ctrl+O for commands  │
                      │                        │
                      ╰────────────────────────╯



```

- Centered rounded panel — like a card
- Product name in `primary`, bold
- Suggestions as simple list with `›` bullets
- Hint text in `on-surface-dim`
- No ASCII art, no animation — clean typography

### Chat History

Messages have no borders. They breathe.

```
  hello world

  This is the assistant response. It spans naturally across
  the terminal width with soft wrapping.

  read:src/app.tsx
  ╭────────────────────────────────────────────────────────────────╮
  │  import React from "react";                                    │
  │  import { Box, Text } from "ink";                              │
  ╰────────────────────────────────────────────────────────────────╯

─────────────────────────────────────────────────────────────────────

  next user message
```

- User: left-aligned, bare text, `on-surface`
- Assistant: indented 2ch, bare text, `on-surface`
- Tool call: `tool-name:args` in `secondary`, no border
- Tool output: inline or in thin rounded panel if >2 lines
- Turn separator: 80ch of `─` in `border`
- Streaming: italic indicator at end of line

### Permission Modal

Centered, minimal.

```
                      ╭────────────────────────────╮
                      │  Allow bash?               │
                      │                            │
                      │  rm -rf node_modules       │
                      │                            │
                      │  Yes(once)   Yes(always)   │
                      │  Show        No            │
                      │                            │
                      ╰────────────────────────────╯
```

- No heavy header. Question in `on-surface`.
- Arguments in `on-surface-dim` italics.
- Actions as simple row or list. Selected has background fill.

### Error / Info Modal

```
                      ╭────────────────────────────╮
                      │  Out of Credits            │
                      │                            │
                      │  Add credits to keep       │
                      │  using Kimiflare.          │
                      │                            │
                      │  Add Credits    Retry      │
                      │  Copy           Dismiss    │
                      │                            │
                      ╰────────────────────────────╯
```

- Same minimal card style
- Error header in `error` but not loud
- Actions in a clean grid

## Typography

Terminals have one font. Hierarchy comes from weight, color, and spacing.

| Role | Weight | Color | Usage |
|---|---|---|---|
| Brand | Bold | `primary` | kimiflare header |
| Body | Normal | `on-surface` | Chat, descriptions |
| Meta | Normal | `on-surface-dim` | Hints, timestamps, secondary |
| Label | Bold | `on-surface` | Command names in palette |
| Code | Normal | `secondary` | File paths, inline code |
| Accent | Normal | `primary` | Selected items, active modes |

## Layout Rules

1. **No element touches the screen edge.** Default 2ch margin on left, right calculated from terminal width.
2. **Overlays are centered horizontally** and vertically in upper-middle third.
3. **Max overlay width: 64ch** — comfortable reading width.
4. **Status bar is always last line** — single row, full width, no border.
5. **Input sits above status bar** with 1ch gap.

## Do's and Don'ts

### Do
- Use `╭─╮│╰╯` exclusively. No sharp corners anywhere.
- Keep the status bar to exactly one line of `on-surface-dim` text.
- Let chat messages breathe — no borders around individual messages.
- Center overlays — they should float like cards, not box the screen.
- Use generous padding inside overlays (md = 4ch).
- Make selected items visibly filled — bare vs filled is the primary affordance.

### Don't
- Use `┌─┐│└─┘` or `┏━┓┃┗━┛` — sharp/heavy corners break the warm feel.
- Stack status bar into multiple lines.
- Show permanent static hints — hints should be contextual and dismissible.
- Use ASCII art or animation on the welcome screen — clean typography only.
- Box every element — only overlays and multi-line code blocks get borders.

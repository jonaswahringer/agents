# skills
Skills I wanted to exist but didn't. Structured, formatted, and specified to my own liking.

---

## Installing

Skills live in `~/.agents/skills/`, the harness-agnostic location other agents read from. Claude Code discovers skills in `~/.claude/skills/`, so each skill gets two links: repo → `~/.agents/skills/`, then `~/.agents/skills/` → `~/.claude/skills/`.

```sh
ln -sfn "$(pwd)/<skill>" ~/.agents/skills/<skill>
ln -sfn "../../.agents/skills/<skill>" ~/.claude/skills/<skill>
```

All of them:

```sh
for s in proper-commits work-smart-not-hard nice-to-read; do
  ln -sfn "$(pwd)/$s" ~/.agents/skills/$s
  ln -sfn "../../.agents/skills/$s" ~/.claude/skills/$s
done
```

---

### Skills I still want

- teach — a customized matt-pocock/teach skill that is based on the knowledge-tree idea and a improved EITMLIF-variant
- get-it-going — for deep thinking sessions, where the agent focuses on getting the most out of the human as opposed to the other way around
- plan — the agent encourages the human to think as much as possible, creating a plan only from all the snippets/articles/paragraphs the human writes themselves

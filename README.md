# skills
Skills I wanted to exist but didn't. Structured, formatted, and specified to my own liking.

---

## Installing

Agents/harnesses discover skills in `~/.claude/skills/` (or a project's `.claude/skills/`). Symlink a skill from this repo to make it available:

```sh
ln -s "$(pwd)/<skill>" ~/.claude/skills/<skill>
```

Per skill:

```sh
ln -s "$(pwd)/proper-commits" ~/.claude/skills/proper-commits
ln -s "$(pwd)/work-smart-not-hard" ~/.claude/skills/work-smart-not-hard
ln -s "$(pwd)/nice-to-read" ~/.claude/skills/nice-to-read
```

---

More ideas:
- teaj a customized matt-pocock/teach skill that is based on the knowledge-tree idea and a improved EITMLIF-variant
- get-it-going skill for deep thinking sessions, where the agent focuses on getting the most out of the human as opposed to the other way around
- plan skill where the agent encourages the human to think as much as possible, creating a plan only from all the snippets/articles/paragraphs the human writes themselves

<!-- Copy to <project>/.delta-flume/vessels/README.md when the project's first instance is set up. Replace every <placeholder>; text after "for example" inside one only shows the kind of value. Remove the comments. Write names of env vars and secrets only, never their values. -->

# Vessels in <project>

This project runs [delta-flume](https://github.com/jonaswahringer/delta-flume) vessels. Each file in a type folder is one instance; its front matter says whether it is active or paused. This file holds what only vessels need to run. What every agent needs is in [AGENTS.md](../../AGENTS.md).

## Instances

<!-- One row per instance. Status stays in the instance file. -->

| Instance | Trigger | Runs on |
|---|---|---|
| [<type>/<instance>](<type>/<instance>.md) | <schedule the runtime takes as written, for example every Monday at 06:00> | <machine and runtime, for example a scheduled task on the build server> |

## Run

<!-- The prompt every instance's trigger runs. Setup copies it into each trigger and fills in {type} and {instance}, so keep those two as they are. It only points to files on the main branch, so editing those files changes the next run without touching a trigger. -->

```
Run vessel instance {type}/{instance} in <repository, for example owner/name>.
Read from <main branch, for example origin/main>: .delta-flume/vessels/{type}/{instance}.md,
.delta-flume/vessels/README.md, AGENTS.md and https://github.com/jonaswahringer/delta-flume/blob/main/vessels/{type}.md.
If its status is paused, stop and report that. Otherwise follow them. Never merge.
```

## Secrets

<!-- One row per env var or secret a vessel needs beyond AGENTS.md. Write "None" if AGENTS.md covers them. -->

| Name | Comes from | Used by |
|---|---|---|
| `<NAME>` | <where it is set, for example the CLI's login on the machine that runs the vessel> | <instances, or every instance> |

Never give an agent: <credentials that must stay out of reach, or "nothing beyond the above">.

## <type>/<instance>

<!-- One section per instance that needs more than AGENTS.md gives it: its own commands, steps and prerequisites. Leave out an instance that needs nothing more. -->

<commands, steps and prerequisites only this instance uses>

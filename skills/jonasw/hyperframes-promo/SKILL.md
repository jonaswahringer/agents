---
name: hyperframes-promo

description: Create product promo and marketing videos with the official HyperFrames skills, discuss storyboard and scenery with the user, and deliver verified MP4s through comms over Tailscale.

---

# HyperFrames promo

Turn a product URL or supplied product brief into an editable HyperFrames project,
a verified MP4, and preview frames. Use the official HyperFrames skills for
authoring and rendering. This skill adds the creative discussion, output defaults,
and delivery through `comms`.

## Defaults and scope

- Use `marketing/` at the product project's root, creating it if missing. Put each
  video project and all its artifacts in `marketing/<product>-promo/`.
  Honor an explicit location from the user.
- Default to a 15-second, 1920×1080, **60 fps** linear video with seekable animations.
  Honor an explicitly requested duration, size, or frame rate.
- Keep the first version silent unless the user requests audio.
- Use restrained motion, clear typography, and real product screens. Keep the
  product readable at the final viewing size.
- Render and deliver the full-quality MP4 at the chosen frame rate. Do not
  automatically create compressed, lower-resolution, or lower-fps copies, including
  draft videos. Create a bandwidth-saving version only when the user requests one,
  for example because their network is slow. Keep the original alongside it.

## 1. Inspect and discuss

The official skills come from
[HeyGen's HyperFrames repository](https://github.com/heygen-com/hyperframes),
under `skills/`. Ensure they are available before starting intake or authoring.
This custom skill supplements those skills; it does not replace them.

For a standalone installation with missing skills, install the core set and the
product promo workflow using the official CLI:

```sh
npx hyperframes skills update product-launch-video
```

For an existing standalone installation, run `npx hyperframes skills check --json`.
If the core set is incomplete, a required skill is stale, or the promo workflow is
missing, run the update command above. It downloads from the official repository
and installs the named workflow alongside the core skills.

If HyperFrames is installed as a plugin, use the bundled skills and its plugin
manager's update flow instead. Do not run standalone skill installation or update
commands against a plugin installation. Read its
`hyperframes/references/plugin-installation.md` before running setup commands.

After setup, read the installed official `hyperframes` entry skill first, then
follow its `product-launch-video` route and load domain skills as needed.
Read `hyperframes-core` before writing composition HTML and `hyperframes-cli`
before running checks or rendering. Report any setup failure and stop dependent
work rather than substituting a workflow from memory.

Use the official intake conversation to gather these details once. Reuse answers
and project preferences already supplied:

- Product URL or provided source material.
- Audience and one concrete outcome the product should deliver.
- Approved claims and the exact final call to action.
- Brand asset folder, or use the website's branding.
- Storyboard ideas, scenery or background preferences, visual references, and
  anything the user wants included or avoided.
- Viewing context, such as a desktop landing page or a phone feed, when it affects
  readability or the requested format.

Inspect the website before choosing the story or visual direction. Capture real
product screens, the logo, colors, and typography. Record the source of each claim
in the brief, using supplied facts or visible product evidence. Do not invent
metrics, testimonials, UI states, or capabilities. If capture fails or product
access is unavailable, report the gap and ask for usable source material before
building scenes that depend on it.

Use the available user-input tool to ask concise clarification questions and
invite storyboard and scenery ideas before building. Use an asynchronous tool
when inspection and planning can continue while waiting. If no user-input tool
is available, ask in chat. Offer a few concrete directions grounded in the product,
such as a close-up of its UI, a device on a desk, or a brand-colored background.
Explain how each direction supports the benefit. Ask only about missing decisions;
do not repeat the official interview or previously answered questions.

Wait for answers that determine the story, claims, or creative direction. If the
user explicitly delegates those choices, choose a direction and record it. Keep
the 60 fps default without asking about it unless the user raises delivery size or
playback constraints.

## 2. Set up the project and write the storyboard

Resolve the product project's root from the user's context. If no root is known
and the current folder is inside its Git repository, use
`git rev-parse --show-toplevel` rather than placing `marketing/` in a nested working
directory. Reuse or create `<project-root>/marketing/`, then initialize the video
project inside it. This location takes precedence over the official workflow's
default `videos/` path. Run subsequent commands from the video project's folder,
so captures, assets, compositions, renders, and previews stay together.

**Media files are gitignored by default.** Read
[the reusable media ignore block](references/media-gitignore.md) and add missing
rules to the product project's root `.gitignore` before capturing or generating
media. Preserve existing rules and verify representative media paths with
`git check-ignore -v`. Keep briefs, storyboards, composition HTML, configuration,
and verification records available to Git. If the user chooses a different output
folder, adapt the block's `/marketing/` prefix to that folder.

Ignore rules do not remove files already tracked by Git. Report any tracked media
and leave it tracked unless the user requests a change. If the project has no Git
repository, save the ignore block there for future use and report that Git ignore
behavior could not be verified.

Save the settled inputs and output settings in `BRIEF.md`, using the official
brief contract. Initialize the separate project according to the official flow;
do not populate a folder before an initializer that requires it to be empty.

Write a short `STORYBOARD.md` before building. For the default 15-second cut:

| Time | Story | Visual purpose |
| --- | --- | --- |
| 0–3 seconds | Introduce the problem or desired outcome. | Make one clear point with concise copy and a relevant product or context image. |
| 3–11 seconds | Show the product delivering that outcome. | Use real screens and a focused demonstration the viewer can follow. |
| 11–15 seconds | Hold the exact final action. | Show the CTA and brand clearly, leaving enough still time to read. |

For another duration, adapt the timing while preserving a readable demonstration
and ending. For each scene, name the screen or asset, on-screen copy, scenery,
motion, and evidence supporting any claim. Keep the CTA legible through the final
frame rather than fading it out early.

Show the proposed storyboard and invite changes to the story, scenery, and pacing.
Reuse the user's earlier direction or instruction to proceed; do not add another
approval gate when those choices are already settled. A request to build and export
a first draft authorizes that draft's local render.

## 3. Build and verify

Follow the official workflow for composition structure, captured assets, branding,
and deterministic, seekable animation. Use local assets so the editable project
can render again. Keep all project assets and outputs inside its folder.

Set **60 fps explicitly** in the project's render settings and render invocation,
unless the user requested another rate. Check the installed CLI's documented
options rather than guessing flags. Do not use a quality preset that silently
reduces frame rate or resolution. Choose an MP4 encoding suitable for browser
playback, preferably H.264.

Run the official HyperFrames lint and check commands. Inspect representative
rendered frames from the opening, demonstration, transitions, CTA hold, and last
frame. Check typography, product readability at the intended viewing size,
cropping, brand fidelity, timing, and blank or clipped frames. Fix observed defects
and repeat the affected checks.

Export the MP4 to `renders/video.mp4`. Verify the exported file with a media probe
such as `ffprobe`, not just project configuration. Confirm resolution, actual frame
rate, duration within one frame of the target, codec, and the absence of an audio
stream for a silent cut. A default 15-second cut at 60 fps should contain 900 frames.
Inspect frames extracted from the exported MP4, including its last decoded frame,
to verify the ending and the readable CTA hold. Keep a few preview PNGs in
`renders/previews/`.

Record verification results and any failed or skipped checks in the project.
If a required check cannot run, state the limitation without calling the output
fully verified.

## 4. Upload with comms and deliver

**Use `comms` to upload the exported video so the user can play and download it
over Tailscale.** A path or localhost link on the Mac mini does not make the video
accessible from the user's MacBook or iPhone.

Read the agents repository's [comms instructions](../../../tools/comms/README.md).
Locate that repository through `agents source` if its location is not already
known. If the installed source snapshot lacks `tools/comms`, locate the agents
development checkout that runs the configured service and read its comms README.
Use its existing configured service and saved Postplan credentials. From
the repository's `tools/comms` directory, run:

```sh
bun run publish-media "/absolute/path/to/project/marketing/product-promo/renders/video.mp4"
```

The uploader also accepts `POSTPLAN_API_URL` and `POSTPLAN_API_KEY`. Never print
credentials or put them in the project. Preserve the returned `publicUrl`,
`mediaUrl`, and `downloadUrl` in the delivery record. Verify the returned player
and media URLs through the configured Tailscale address; check the media size and
type without downloading the whole video when possible. Report a reachable link
only after upload and verification succeed. State that the links require Tailscale
access. Upload requested alternate versions through `comms` too.

If `comms` is unavailable, credentials are missing, the upload exceeds the service
limit, or verification fails, keep the full-quality local deliverables and report
the exact blocker. Ask for the missing setup or a delivery decision. Do not silently
compress the video, reduce fps, claim it is uploaded, or start a replacement server.

Deliver:

- The editable project folder, including brief, storyboard, assets, and compositions.
- The MP4's local path and verified Tailscale player and download links.
- A few preview frames and their local paths.
- A short check report with actual duration, resolution, fps, ending verification,
  and any failed or skipped checks.

State which machine holds the files. Distinguish the hosted video links from the
editable project and preview files that remain on that machine. Tell the user that
media files are gitignored by default, so committing and pulling the editable
project does not transfer those files to another machine.

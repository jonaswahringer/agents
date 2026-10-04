# Media ignore block

Git uses glob patterns, not regular expressions. Copy this block into the product
project's root `.gitignore`. It works with any repository name and ignores media
at any depth under that root's `marketing/` folder. Character classes match mixed
case extensions. Brace lists such as `*.{mp4,mov}` do not work in `.gitignore`.

```gitignore
# Marketing media stays on the rendering machine or in comms.
/marketing/**/*.[mM][pP]4
/marketing/**/*.[mM]4[vV]
/marketing/**/*.[mM][oO][vV]
/marketing/**/*.[wW][eE][bB][mM]
/marketing/**/*.[mM][kK][vV]
/marketing/**/*.[aA][vV][iI]
/marketing/**/*.[mM][pP]3
/marketing/**/*.[mM]4[aA]
/marketing/**/*.[wW][aA][vV]
/marketing/**/*.[aA][aA][cC]
/marketing/**/*.[fF][lL][aA][cC]
/marketing/**/*.[oO][gG][gG]
/marketing/**/*.[oO][pP][uU][sS]
/marketing/**/*.[pP][nN][gG]
/marketing/**/*.[jJ][pP][gG]
/marketing/**/*.[jJ][pP][eE][gG]
/marketing/**/*.[wW][eE][bB][pP]
/marketing/**/*.[aA][vV][iI][fF]
/marketing/**/*.[gG][iI][fF]
/marketing/**/*.[bB][mM][pP]
/marketing/**/*.[tT][iI][fF]
/marketing/**/*.[tT][iI][fF][fF]
/marketing/**/*.[sS][vV][gG]
/marketing/**/*.[wW][oO][fF][fF]
/marketing/**/*.[wW][oO][fF][fF]2
/marketing/**/*.[tT][tT][fF]
/marketing/**/*.[oO][tT][fF]
```

The block covers common video, audio, image, and font formats. Add a scoped rule
when the project uses another media format. It leaves source and metadata files
such as `.html`, `.js`, `.json`, and `.md` available to Git. Avoid ignoring the
entire `marketing/` folder, which would also hide the editable project.

Verify the actual paths after applying the rules. Existing negation rules or
nested `.gitignore` files can change the result:

```sh
git check-ignore -v -- marketing/product-promo/renders/video.mp4
git check-ignore -v -- marketing/product-promo/renders/previews/ending.png
```

These rules apply to untracked files. Do not automatically untrack existing media
or force-add ignored files. Keep ignored assets on the rendering machine, publish
the MP4 through `comms`, and explain that Git alone will not move the media to a
different machine.

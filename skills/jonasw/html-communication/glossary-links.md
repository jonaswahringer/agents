# Glossary links

Turns every glossary term in the document into a link to its definition, highlights the words it lands on the way a find bar does, and shows a floating "↩ Back to “term”" button that returns the reader to the exact scroll position and link they came from. Esc and the browser's Back button do the same. Works from `file://`; falls back to an in-memory stack if `history.pushState` is blocked.

## Writing the glossary

- Mark each definition with `data-gloss`; the script creates every link. Keep the glossary entry as the single place a term is defined.
- Add aliases for plurals and common short forms (`development build|development builds|dev build`).
- Leave out aliases that are ordinary words in the document (e.g. `profile`, `key`), or every occurrence becomes a link.
- Name the term inside its own entry, in the term cell, the `<dt>`, or the opening words. An entry that never writes its term out is a defect: either the entry is labelled wrong, or the reader's word belongs in `data-gloss` as an alias. Fix the entry; don't lean on the fallback.
- Under the glossary heading, tell the reader underlined terms link there and how to return (Back button, Esc, or browser back).

## The highlight

Clicking a term scrolls to its entry and marks the term text inside it with a soft amber highlight and a hairline edge, like a Cmd+F hit in Preview. The box stays until the reader jumps somewhere else, presses Esc, or clicks anywhere in the page — it does not fade on a timer, so the reader can look away and still find their place.

Coming back highlights the link the reader left from, so both ends of the jump are marked the same way. Opening the document at `#g-term` highlights that entry on load, which makes a shared deep link land on the words, not the row.

An entry that never writes its term out has nothing to mark, so the whole entry gets a tint and a bar down its edge. Treat that as a sign the glossary is wrong: a reader who clicked “TestFlight” landed on an entry that never says TestFlight.

Any in-page `<a href="#...">` that points at a `data-gloss` entry gets the same jump, highlight, and Back button, so a hand-written link into the glossary behaves like a generated one.

## Contract

| Attribute | Where | Meaning |
|---|---|---|
| `data-gloss="Term\|alias\|alias"` | Any element holding one definition (`tr`, `li`, `div`, `dt`) | First name is canonical and becomes the id (`g-term`) unless the element already has an `id`. Matching is case-insensitive, whole words, longest name first. |
| `data-gloss-root` | Optional, one element | Only text inside it gets linked. Default: `<body>`. |
| `data-gloss-skip` | Optional, any element | Never link text inside it. |
| `data-manual` | Optional, on the `<script>` | Don't auto-run; call `GlossaryLinks.init({ root, skip })` yourself. |

Never linked: `a, code, pre, kbd, script, style, textarea, button, h1–h6, th, nav`, and a term inside its own entry.

The script wraps the first occurrence of the term inside its own entry in `<span class="gloss-term">` so it has something to highlight. An entry that never spells the term out falls back to the tint and edge bar, and the script logs a console warning naming the entry so the glossary can be fixed.

Theme hooks: `--accent` (underline), `--bg`, `--fg`, `--line` (button), and the highlight set `--gloss-hit`, `--gloss-hit-fg`, `--gloss-hit-ring`, `--gloss-hit-soft`, `--gloss-hit-bar`, `--gloss-hit-focus`. They come from [theme.css](theme.css) or the project brand file; each also has a literal fallback in the CSS below, so the script works on its own.

## HTML

```html
<main data-gloss-root>
  <p>Use a development build when you need custom native code.</p>

  <h2 id="glossary">Glossary</h2>
  <table>
    <tr><th>Term</th><th>Meaning</th></tr>
    <tr data-gloss="Development build|development builds|dev build">
      <td>Development build</td><td>Your app compiled with expo-dev-client.</td>
    </tr>
    <tr data-gloss="Custom native code|native code|native module|native modules">
      <td>Custom native code</td><td>Code that isn't JavaScript and isn't bundled in Expo Go.</td>
    </tr>
  </table>
</main>
<!-- paste the <script> from the JS section just before </body> -->
```

A definition list works too:

```html
<dl>
  <div data-gloss="TestFlight"><dt>TestFlight</dt><dd>Apple's beta channel.</dd></div>
</dl>
```

## CSS

```css
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
[data-gloss] { scroll-margin-top: 1.25rem; }
.gloss-link { color: inherit; text-decoration: underline dotted; text-decoration-color: var(--accent, currentColor); text-decoration-thickness: 1.5px; text-underline-offset: 3px; }
.gloss-link:hover, .gloss-link:focus-visible { text-decoration-style: solid; }
.gloss-back { position: fixed; right: 16px; bottom: 16px; z-index: 10; font: inherit; font-size: 0.9rem; padding: 8px 14px; border-radius: 999px; border: 1px solid var(--line, #ccc); background: var(--bg, #fff); color: var(--fg, #111); box-shadow: 0 2px 10px rgba(0,0,0,.18); cursor: pointer; }
.gloss-back[hidden] { display: none; }
/* the find-bar hit: a soft marker around the words, not the row */
.gloss-hit { background: var(--gloss-hit, #fde9ab); color: var(--gloss-hit-fg, #241a00); padding: .05em .2em; margin: 0 -.2em; border-radius: 4px; box-shadow: 0 0 0 1px var(--gloss-hit-ring, rgba(191,140,20,.35)); text-decoration-color: var(--gloss-hit-ring, rgba(191,140,20,.35)); -webkit-box-decoration-break: clone; box-decoration-break: clone; }
/* an entry that never writes its term out: a tint and a bar down its edge */
.gloss-hit-entry, .gloss-hit-entry > * { background-color: var(--gloss-hit-soft, rgba(253,233,171,.45)); }
.gloss-hit-entry { box-shadow: inset 3px 0 0 var(--gloss-hit-bar, #e0ad35); border-radius: 4px; padding-inline-start: .5rem; margin-inline-start: -.5rem; }
tr.gloss-hit-entry { box-shadow: none; padding: 0; margin: 0; }
tr.gloss-hit-entry > :first-child { box-shadow: inset 3px 0 0 var(--gloss-hit-bar, #e0ad35); }
/* the jump moves focus, so keep the focus ring in the same family as the marker */
.gloss-hit:focus-visible, .gloss-hit-entry:focus-visible { outline: 2px solid var(--gloss-hit-focus, #a87500); outline-offset: 2px; }
@media (prefers-reduced-motion: no-preference) {
  .gloss-hit { animation: gloss-pop .45s ease-out; }
  @keyframes gloss-pop { from { box-shadow: 0 0 0 1px var(--gloss-hit-ring, rgba(191,140,20,.35)), 0 0 0 9px var(--gloss-hit-soft, rgba(253,233,171,.45)); } }
}
```

## JS

```html
<script>
/* glossary-links: links glossary terms, highlights the words a jump lands on, and adds a "Back" return. */
(() => {
  const SKIP = 'a, code, pre, kbd, script, style, textarea, button, h1, h2, h3, h4, h5, h6, th, nav, [data-gloss-skip]';
  const slug = s => 'g-' + s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alts = names => names.slice().sort((a, b) => b.length - a.length).map(esc).join('|');
  const wordRe = (names, flags) => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alts(names)})(?![\\p{L}\\p{N}_])`, flags);
  const hashId = url => { try { return decodeURIComponent(url.hash.slice(1)); } catch { return url.hash.slice(1); } };

  // Wrap the term where it is written inside its own entry, so a jump can highlight the words themselves.
  function wrapTerm(entry, names) {
    const re = wordRe(names, 'iu');
    const walker = document.createTreeWalker(entry, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.parentElement.closest('script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const m = re.exec(node.nodeValue);
      if (!m) continue;
      const hit = node.splitText(m.index);
      hit.splitText(m[0].length);
      const span = document.createElement('span');
      span.className = 'gloss-term';
      hit.replaceWith(span);
      span.append(hit);
      return span;
    }
    return null;
  }

  function init({ root = document.querySelector('[data-gloss-root]') || document.body, skip = SKIP } = {}) {
    // 1. Collect entries: <el data-gloss="Term|alias|alias">
    const entries = new Map();
    const terms = new WeakMap();
    for (const entry of document.querySelectorAll('[data-gloss]')) {
      const names = entry.dataset.gloss.split('|').map(s => s.trim()).filter(Boolean);
      if (!names.length) continue;
      if (!entry.id) entry.id = slug(names[0]);
      for (const n of names) entries.set(n.toLowerCase(), entry);
      const term = wrapTerm(entry, names);
      if (!term) console.warn(`[glossary-links] "${names[0]}" is never written out in its own entry (#${entry.id}); marking the whole entry`);
      terms.set(entry, term);
    }
    if (!entries.size) return;
    const pattern = wordRe([...entries.keys()], 'giu');

    // 2. Wrap every match in prose text with a link (never inside skipped elements or its own entry)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.parentElement.closest(skip) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let count = 0;
    for (const node of nodes) {
      const text = node.nodeValue;
      const own = node.parentElement.closest('[data-gloss]');
      let m, last = 0, frag = null;
      pattern.lastIndex = 0;
      while ((m = pattern.exec(text))) {
        const entry = entries.get(m[0].toLowerCase());
        if (entry === own) continue;
        frag ??= document.createDocumentFragment();
        frag.append(text.slice(last, m.index));
        const a = document.createElement('a');
        a.href = '#' + entry.id;
        a.className = 'gloss-link';
        a.id = 'gl-' + ++count;
        a.textContent = m[0];
        frag.append(a);
        last = m.index + m[0].length;
      }
      if (frag) { frag.append(text.slice(last)); node.replaceWith(frag); }
    }

    // 3. Highlight what the jump lands on, remember where the reader was, offer a way back
    const stack = [];
    let lit = [];
    const clear = () => { for (const [el, cls] of lit) el.classList.remove(cls); lit = []; };
    const light = (el, cls) => {
      el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); // restart the animation
      lit.push([el, cls]);
    };
    const lightEntry = entry => { const t = terms.get(entry); light(t || entry, t ? 'gloss-hit' : 'gloss-hit-entry'); };
    const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'gloss-back', hidden: true });
    document.body.append(btn);
    const sync = () => {
      const top = stack.at(-1);
      btn.hidden = !top;
      if (top) btn.textContent = `↩ Back to “${top.label}”`;
    };
    const restore = () => {
      const s = stack.pop();
      if (!s) return;
      const go = () => window.scrollTo({ left: s.x, top: s.y, behavior: 'instant' });
      go();
      requestAnimationFrame(go); // override any browser scroll on history traversal
      clear();
      const link = document.getElementById(s.linkId);
      if (link) { link.focus({ preventScroll: true }); light(link, 'gloss-hit'); }
      sync();
    };

    document.addEventListener('click', e => {
      if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest('a[href^="#"]');
      const target = a && document.getElementById(hashId(a));
      if (!target?.matches('[data-gloss]')) { if (!e.target.closest('.gloss-back')) clear(); return; }
      e.preventDefault();
      clear();
      if (!a.id) a.id = 'gl-' + ++count;
      stack.push({ x: scrollX, y: scrollY, linkId: a.id, label: a.textContent.trim(), viaHistory: false });
      try { history.pushState({ glossDepth: stack.length }, '', a.hash); stack.at(-1).viaHistory = true; } catch {}
      if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
      target.scrollIntoView({ block: 'start' });
      target.focus({ preventScroll: true });
      lightEntry(target);
      sync();
    });
    btn.addEventListener('click', () => (stack.at(-1)?.viaHistory ? history.back() : restore()));
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (stack.length) { e.preventDefault(); btn.click(); }      // back first
      else if (lit.length) { e.preventDefault(); clear(); }       // then dismiss the highlight
    });
    window.addEventListener('popstate', e => {
      const depth = e.state?.glossDepth ?? 0;
      if (stack.length > depth) { stack.length = depth + 1; restore(); }
    });

    // Opened at #g-term: highlight it, so a shared link lands on the words
    const start = document.getElementById(hashId(location));
    if (start?.matches('[data-gloss]')) lightEntry(start);
  }

  window.GlossaryLinks = { init };
  if (!document.currentScript?.hasAttribute('data-manual')) {
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', () => init()) : init();
  }
})();
</script>
```

## Known limits

- Terms split across inline elements (e.g. `<strong>Expo</strong> Go`) are neither linked nor highlighted.
- An entry that never writes its term out falls back to the tint and edge bar, and warns in the console. That is a glossary to fix, not a supported style.
- Every occurrence is linked; dense documents may want fewer aliases.
- The highlight marks the entry you jumped to, not every occurrence in the document.
- Needs a browser with regex lookbehind (Safari 16.4+, Chrome 62+, Firefox 78+).

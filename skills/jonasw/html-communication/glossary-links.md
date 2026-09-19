# Glossary links

Turns every glossary term in the document into a link to its definition, highlights the definition, and shows a floating "↩ Back to “term”" button that returns the reader to the exact scroll position and link they came from. Esc and the browser's Back button do the same. Works from `file://`; falls back to an in-memory stack if `history.pushState` is blocked.

## Writing the glossary

- Mark each definition with `data-gloss`; the script creates every link. Keep the glossary entry as the single place a term is defined.
- Add aliases for plurals and common short forms (`development build|development builds|dev build`).
- Leave out aliases that are ordinary words in the document (e.g. `profile`, `key`), or every occurrence becomes a link.
- Under the glossary heading, tell the reader underlined terms link there and how to return (Back button, Esc, or browser back).

## Contract

| Attribute | Where | Meaning |
|---|---|---|
| `data-gloss="Term\|alias\|alias"` | Any element holding one definition (`tr`, `li`, `div`, `dt`) | First name is canonical and becomes the id (`g-term`) unless the element already has an `id`. Matching is case-insensitive, whole words, longest name first. |
| `data-gloss-root` | Optional, one element | Only text inside it gets linked. Default: `<body>`. |
| `data-gloss-skip` | Optional, any element | Never link text inside it. |
| `data-manual` | Optional, on the `<script>` | Don't auto-run; call `GlossaryLinks.init({ root, skip })` yourself. |

Never linked: `a, code, pre, kbd, script, style, textarea, button, h1–h6, th, nav`, and a term inside its own entry.

Theme hooks: `--accent` (underline), `--bg`, `--fg`, `--line` (button), and `--gloss-flash` (highlight). They come from [theme.css](theme.css) or the project brand file; each also has a literal fallback in the CSS below, so the script works on its own.

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
[data-gloss] { scroll-margin-top: 16px; }
.gloss-link { color: inherit; text-decoration: underline dotted; text-decoration-color: var(--accent, currentColor); text-decoration-thickness: 1.5px; text-underline-offset: 3px; }
.gloss-link:hover, .gloss-link:focus-visible { text-decoration-style: solid; }
.gloss-back { position: fixed; right: 16px; bottom: 16px; z-index: 10; font: inherit; font-size: 0.9rem; padding: 8px 14px; border-radius: 999px; border: 1px solid var(--line, #ccc); background: var(--bg, #fff); color: var(--fg, #111); box-shadow: 0 2px 10px rgba(0,0,0,.18); cursor: pointer; }
.gloss-back[hidden] { display: none; }
.gloss-flash { animation: gloss-flash 1.6s ease-out; }
@keyframes gloss-flash { from { background-color: var(--gloss-flash, rgba(255,196,0,.45)); } to { background-color: transparent; } }
```

## JS

```html
<script>
/* glossary-links: turns glossary terms into links and adds a "Back" return. */
(() => {
  const SKIP = 'a, code, pre, kbd, script, style, textarea, button, h1, h2, h3, h4, h5, h6, th, nav, [data-gloss-skip]';
  const slug = s => 'g-' + s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function init({ root = document.querySelector('[data-gloss-root]') || document.body, skip = SKIP } = {}) {
    // 1. Collect entries: <el data-gloss="Term|alias|alias">
    const entries = new Map();
    for (const entry of document.querySelectorAll('[data-gloss]')) {
      const names = entry.dataset.gloss.split('|').map(s => s.trim()).filter(Boolean);
      if (!names.length) continue;
      if (!entry.id) entry.id = slug(names[0]);
      for (const n of names) entries.set(n.toLowerCase(), entry);
    }
    if (!entries.size) return;
    const alts = [...entries.keys()].sort((a, b) => b.length - a.length).map(esc).join('|');
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alts})(?![\\p{L}\\p{N}_])`, 'giu');

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

    // 3. Jump to the entry, remember where the reader was, offer a way back
    const stack = [];
    const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'gloss-back', hidden: true });
    document.body.append(btn);
    const flash = el => { el.classList.remove('gloss-flash'); void el.offsetWidth; el.classList.add('gloss-flash'); };
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
      const link = document.getElementById(s.linkId);
      if (link) { link.focus({ preventScroll: true }); flash(link); }
      sync();
    };

    document.addEventListener('click', e => {
      const a = e.target.closest('a.gloss-link');
      if (!a || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = document.getElementById(a.hash.slice(1));
      if (!target) return;
      e.preventDefault();
      stack.push({ x: scrollX, y: scrollY, linkId: a.id, label: a.textContent, viaHistory: false });
      try { history.pushState({ glossDepth: stack.length }, '', a.hash); stack.at(-1).viaHistory = true; } catch {}
      if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
      target.scrollIntoView({ block: 'start' });
      target.focus({ preventScroll: true });
      flash(target);
      sync();
    });
    btn.addEventListener('click', () => (stack.at(-1)?.viaHistory ? history.back() : restore()));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && stack.length) { e.preventDefault(); btn.click(); } });
    window.addEventListener('popstate', e => {
      const depth = e.state?.glossDepth ?? 0;
      if (stack.length > depth) { stack.length = depth + 1; restore(); }
    });
  }

  window.GlossaryLinks = { init };
  if (!document.currentScript?.hasAttribute('data-manual')) {
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', () => init()) : init();
  }
})();
</script>
```

## Known limits

- Terms split across inline elements (e.g. `<strong>Expo</strong> Go`) are not matched.
- Every occurrence is linked; dense documents may want fewer aliases.
- Needs a browser with regex lookbehind (Safari 16.4+, Chrome 62+, Firefox 78+).

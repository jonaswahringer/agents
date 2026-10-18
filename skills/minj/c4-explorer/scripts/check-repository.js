(async () => {
  const root = document.getElementById('c4-explorer'), checks = [];
  const assert = (value, message) => { if (!value) throw new Error(message); checks.push(message); };
  const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const trails = new Map();
  function walk(id, trail) {
    if (trails.has(id)) return;
    trails.set(id, trail);
    for (const item of c4ModelSource.getView(id).nodes) if (item.childView) walk(item.childView, [...trail, { id: item.childView, name: item.name, via: item.id }]);
  }
  walk(c4ModelSource.root(), c4ModelSource.rootTrail());
  assert(root.querySelector('[data-action="sample"]').hidden, 'Repository output hides synthetic sample controls');
  for (const [id, trail] of trails) {
    await c4Explorer.navigate(id, { trail, animate: false }); await settle();
    const view = c4ModelSource.getView(id);
    const visited = new Set();
    for (;;) {
      assert(document.documentElement.scrollWidth <= innerWidth, id + ': no horizontal page overflow');
      const nodes = [...root.querySelectorAll('.c4-node')];
      assert(nodes.length <= 12, id + ': node budget holds');
      for (const element of nodes) {
        visited.add(element.dataset.nodeId);
        assert(element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight, id + ': content fits ' + element.dataset.nodeId);
      }
      const next = root.querySelector('[data-action="next"]');
      if (next.disabled) break;
      next.click(); await settle();
    }
    assert(visited.size === view.nodes.length, id + ': every element reachable by paging');
    const about = root.querySelector('[data-action="view-details"]'); about.focus(); about.click(); await settle();
    const dialog = root.querySelector('dialog');
    assert(dialog.open && dialog.querySelector('.c4-evidence details'), id + ': scope evidence is inspectable');
    dialog.querySelector('details').open = true;
    assert(dialog.querySelector('pre code').textContent.length > 0, id + ': evidence has embedded source text');
    dialog.querySelector('[data-action="close-inspector"]').click(); await settle();
    assert(document.activeElement === about, id + ': scope dialog restores focus');
    await c4Explorer.navigate(id, { trail, animate: false }); await settle();
    const child = root.querySelector('[data-inspect-id]');
    if (child) {
      child.focus(); child.click(); await settle();
      assert(dialog.open && c4Explorer.inspect().viewId === id, id + ': a parent can be inspected without drilling down');
      dialog.querySelector('[data-action="close-inspector"]').click(); await settle();
    }
    const relation = root.querySelector('[data-edge-id]');
    if (relation) {
      relation.focus(); relation.click(); await settle();
      assert(dialog.open && dialog.querySelector('.c4-evidence details'), id + ': relationship evidence is inspectable');
      dialog.querySelector('[data-action="close-inspector"]').click(); await settle();
    }
    const leaf = [...root.querySelectorAll('.c4-node')].find(element => !view.nodes.find(item => item.id === element.dataset.nodeId).childView);
    if (leaf) {
      leaf.focus(); leaf.click(); await settle();
      assert(dialog.open && dialog.querySelector('.c4-evidence details'), id + ': leaf evidence is inspectable');
      const box = dialog.getBoundingClientRect();
      assert(box.left >= 0 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1, id + ': inspector fits viewport');
      assert(![...dialog.querySelectorAll('pre')].some(pre => pre.scrollWidth > pre.clientWidth), id + ': source snippets wrap');
      dialog.querySelector('[data-action="close-inspector"]').click(); await settle();
      assert(document.activeElement.dataset.nodeId === leaf.dataset.nodeId, id + ': leaf focus returns');
    }
  }
  const targetView = [...trails.keys()].map(id => c4ModelSource.getView(id)).find(view => view.abstraction === 'code' && view.nodes.length);
  const match = targetView && c4ModelSource.search(targetView.nodes[0].name, 'demo', 8).find(item => item.viewId === targetView.id);
  if (match) {
    await c4Explorer.navigate(match.viewId, { trail: match.trail, focusId: match.id, animate: false }); await settle();
    assert(c4Explorer.inspect().selected === match.id, 'Search locates an implementation symbol');
    root.querySelector('[data-action="back"]').click(); await settle();
    assert(c4Explorer.inspect().viewId === match.trail[match.trail.length - 2].id, 'Back returns to semantic parent');
  }
  await c4Explorer.navigate(c4ModelSource.root(), { trail: c4ModelSource.rootTrail(), animate: false });
  return { passed: checks.length, width: innerWidth, views: trails.size };
})()

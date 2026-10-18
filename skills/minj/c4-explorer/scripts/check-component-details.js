(async () => {
  const root = document.getElementById('c4-explorer');
  const checks = [];
  const assert = (value, message) => { if (!value) throw new Error(message); checks.push(message); };
  const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const componentTrail = C4DemoSource.search('Checkout controller', 'demo', 8)[0].trail;
  for (const id of ['controller', 'checkout', 'repository', 'publisher']) {
    await c4Demo.navigate('components', { trail: componentTrail, animate: false });
    const component = root.querySelector('[data-node-id="' + id + '"]'); component.focus(); component.click(); await settle();
    assert(c4Demo.inspect().viewId === 'code-' + id, id + ' opens its code-level view');
    assert(root.dataset.abstraction === 'code', id + ' identifies the L4 abstraction');
    assert(root.querySelector('.c4-boundary-label').textContent.includes('Component boundary'), id + ' decomposes a component, not the whole API');
    assert(root.querySelector('.c4-uml-members code'), id + ' displays actual illustrative members, not just a UML icon');
    assert([...root.querySelectorAll('.c4-node')].every(node => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight), id + ' code members fit their diagram elements');
    const view = C4DemoSource.getView(c4Demo.inspect().viewId);
    assert([...root.querySelectorAll('.c4-edge-annotation')].every(group => [...group.querySelectorAll('text:not(.c4-edge-protocol)')].map(text => text.textContent).join(' ') === view.edges.find(edge => edge.id === group.dataset.relationshipId).label), id + ' shows complete relationship intent labels');
    const leaf = root.querySelector('.c4-node[data-c4-type="class"]'); leaf.focus(); leaf.click(); await settle();
    const dialog = root.querySelector('.c4-inspector');
    assert(dialog && dialog.open, id + ' opens a visible native detail dialog');
    const box = dialog.getBoundingClientRect();
    assert(box.top >= -1 && box.bottom <= innerHeight + 1 && box.left >= 0 && box.right <= innerWidth, id + ' details are inside the visible viewport');
    assert(box.width >= Math.min(900, innerWidth - 24) - 1, id + ' modal uses the available width for rich details');
    assert(dialog.querySelector('.c4-inspector-implementation') && dialog.querySelector('.c4-inspector-connections'), id + ' modal has information and visualization regions');
    const related = view.edges.filter(edge => edge.from === leaf.dataset.nodeId || edge.to === leaf.dataset.nodeId);
    const peers = [...dialog.querySelectorAll('[data-peer-id]')];
    assert(peers.length === Math.min(6, related.length) && peers.every(peer => related.some(edge => edge.from === peer.dataset.peerId || edge.to === peer.dataset.peerId)), id + ' dependency visualization uses actual model relationships within its display budget');
    assert(dialog.scrollWidth <= dialog.clientWidth, id + ' modal content fits without horizontal scrolling');
    assert(dialog.contains(document.activeElement), id + ' moves keyboard focus into the inspector');
    assert(dialog.textContent.includes('Technology') && dialog.textContent.includes('TypeScript'), id + ' inspector includes implementation details');
    dialog.dispatchEvent(new Event('cancel', { cancelable: true })); await settle();
    assert(!dialog.open && c4Demo.inspect().viewId === 'code-' + id, id + ' dismisses details without leaving the code view');
    assert(document.activeElement.dataset.nodeId === leaf.dataset.nodeId, id + ' restores focus to the selected class');
    root.querySelector('[data-action="back"]').click(); await settle();
    assert(c4Demo.inspect().viewId === 'components' && document.activeElement.dataset.nodeId === id, id + ' returns to its parent component');
  }
  await c4Demo.navigate('components', { trail: componentTrail, animate: false });
  const db = root.querySelector('[data-node-id="db"]'); db.focus(); db.click(); await settle();
  assert(root.querySelector('.c4-inspector').open, 'An external dependency opens details without inventing a lower C4 level');
  root.querySelector('[data-action="close-inspector"]').click(); await settle();
  assert(!root.querySelector('.c4-inspector').open && document.activeElement.dataset.nodeId === 'db', 'Closing dependency details restores focus');
  return { passed: checks.length, checks, viewport: innerWidth };
})()

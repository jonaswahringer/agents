const assert = require('node:assert/strict');
const path = require('node:path');
require(path.join(__dirname, '../assets/explorer.js'));
require(path.join(__dirname, '../assets/demo.js'));
const { validateView, projectView, layoutView, wrapText, LIMITS } = globalThis.C4Explorer;
const source = globalThis.C4DemoSource;
const demoViews = ['context', 'containers', 'components', 'code-controller', 'code-checkout', 'code-repository', 'code-publisher'];

for (const id of [...demoViews, 'scale', ...Array.from({ length: 400 }, (_, i) => 'scale-' + i)]) {
  const view = validateView(source.getView(id));
  for (const size of [6, 12, 100]) {
    let count = 0;
    const first = projectView(view, 0, size);
    for (let page = 0; page < first.pages; page++) {
      const result = projectView(view, page, size);
      count += result.nodes.length;
      assert.ok(result.nodes.length <= LIMITS.nodes);
      assert.ok(result.edges.length <= LIMITS.edges);
      assert.equal(result.edges.length + result.omitted + result.outside, view.edges.length);
      assert.ok(result.edges.every(edge => result.nodes.some(n => n.id === edge.from) && result.nodes.some(n => n.id === edge.to)));
    }
    assert.equal(count, view.nodes.length, 'Paging must visit every element exactly once');
  }
}
assert.equal(source.count('scale'), 10400);
const target = source.search('System 400 / Service 25', 'scale', 8);
assert.equal(target.length, 1);
assert.equal(target[0].viewId, 'scale-399');
assert.equal(target[0].id, 's399-24');
assert.equal(source.search('system', 'scale', 8).length, 8);
assert.equal(projectView(source.getView('scale'), 9999).page, 33);

assert.throws(() => validateView({ id: 'bad', nodes: [{ id: 'same', name: 'A' }, { id: 'same', name: 'B' }], edges: [] }));
assert.throws(() => validateView({ id: 'bad', nodes: [], edges: [{ id: 'e', from: 'missing', to: 'missing', label: 'Calls' }] }));
assert.throws(() => validateView({ id: 'bad', nodes: [], edges: [], flows: [{ id: 'f', name: 'Flow', edges: ['missing'] }] }));

const dense = { id: 'dense', nodes: Array.from({ length: 12 }, (_, i) => ({ id: String(i), name: 'Node ' + i, type: 'component', tech: 'Synthetic' })), edges: [] };
for (const from of dense.nodes) for (const to of dense.nodes) if (from !== to) dense.edges.push({ id: from.id + '-' + to.id, from: from.id, to: to.id, label: 'Calls' });
dense.flows = [{ id: 'f', name: 'Flow', edges: ['11-10'] }];
validateView(dense);
const projected = projectView(dense, 0, 12, 'f');
assert.equal(projected.edges.length, 36);
assert.equal(projected.omitted, 96);
assert.equal(projected.edges[0].id, '11-10', 'Selected flow edges take priority over other edges');
const controller = new AbortController(); controller.abort();
assert.throws(() => source.getView('context', { signal: controller.signal }), { name: 'AbortError' });
for (const width of [320, 480, 728]) {
  for (const id of demoViews) {
    const view = source.getView(id), layout = layoutView(view, view.nodes, width);
    for (const item of view.nodes) {
      const box = layout.boxes.get(item.id);
      assert.ok(box.x >= 0 && box.x + box.w <= width, 'All shapes stay inside the viewport');
      if (view.scope) {
        if (item.external) assert.ok(box.y > layout.boundary.y + layout.boundary.h, 'External dependencies must be outside the containment boundary');
        else assert.ok(box.y >= layout.boundary.y && box.y + box.h <= layout.boundary.y + layout.boundary.h, 'Internal elements must be inside the containment boundary');
      } else assert.equal(layout.boundary, null);
    }
  }
}
assert.equal(source.getView('containers').nodes.find(n => n.id === 'db').shape, source.getView('components').nodes.find(n => n.id === 'db').shape, 'Database identity and shape persist across levels');
assert.throws(() => validateView({ id: 'wrong-level', scope: { name: 'A system', type: 'system' }, nodes: [{ id: 'wrong', name: 'Wrong', type: 'component', tech: 'TypeScript' }], edges: [] }));
assert.throws(() => validateView({ id: 'untyped', nodes: [{ id: 'unknown', name: 'Unknown' }], edges: [] }));
assert.throws(() => validateView({ id: 'no-tech', nodes: [{ id: 'app', name: 'Application', type: 'container' }], edges: [] }));
assert.throws(() => validateView({ id: 'wrong-scope', abstraction: 'component', scope: { name: 'A system', type: 'system' }, nodes: [], edges: [] }));
assert.throws(() => validateView({ id: 'wrong-context', abstraction: 'context', nodes: [{ id: 'app', name: 'Application', type: 'container', tech: 'TypeScript' }], edges: [] }));
for (const component of source.getView('components').nodes.filter(node => node.type === 'component')) {
  assert.ok(component.childView, 'Every demo component has a code-level drill-down');
  const view = source.getView(component.childView);
  assert.equal(view.abstraction, 'code');
  assert.equal(view.scope.type, 'component');
  assert.equal(view.scope.id, component.id);
  assert.ok(view.nodes.some(node => (node.methods || []).length), 'Code views include meaningful operations');
}
for (const label of ['Submits a checkout request', 'Implements persistence contract', 'AReallyLongUnbrokenIdentifier']) {
  const wrapped = wrapText(label, 12);
  assert.equal(wrapped.join('').replace(/\s/g, ''), label.replace(/\s/g, ''), 'Relationship wrapping preserves all intent text');
  assert.ok(wrapped.every(line => line.length <= 12));
}
console.log('Passed: 408 typed views, all four C4 levels, paging and budgets, relationships, search, cancellation, containment at three widths, member data, and complete label wrapping.');

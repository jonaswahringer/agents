(function (global) {
  'use strict';
  function createSource(model) {
    const text = (value, field, empty = false) => {
      if (typeof value !== 'string' || (!empty && !value.trim())) throw new Error(field + ' must be a ' + (empty ? '' : 'nonempty ') + 'string.');
    };
    if (!model || model.schemaVersion !== 1 || !Array.isArray(model.views) || !model.evidence || Array.isArray(model.evidence) || typeof model.evidence !== 'object' || !model.snapshot) throw new Error('A repository model needs schemaVersion 1, views, evidence, and snapshot.');
    for (const field of ['name', 'root', 'note']) text(model[field], field);
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(model.snapshot.revision)) throw new Error('snapshot.revision must be a full Git SHA.');
    const date = new Date(model.snapshot.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(model.snapshot.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== model.snapshot.date) throw new Error('snapshot.date must be a valid YYYY-MM-DD date.');
    text(model.snapshot.workingTree, 'snapshot.workingTree');
    for (const [id, item] of Object.entries(model.evidence)) {
      if (!item || typeof item !== 'object') throw new Error('Invalid evidence entry: ' + id);
      text(item.path, 'Evidence path'); text(item.reason, 'Evidence reason');
      if (!Number.isInteger(item.line) || item.line < 1 || (item.endLine !== undefined && (!Number.isInteger(item.endLine) || item.endLine < item.line))) throw new Error('Evidence ranges must use positive one-based line numbers.');
    }
    const views = new Map(), identity = new Map();
    const proof = item => {
      if (!['observed', 'inferred', 'configured', 'unknown'].includes(item.assessment)) throw new Error('Every architectural claim needs an assessment.');
      if (!Array.isArray(item.evidence) || !item.evidence.length || item.evidence.some(id => !Object.hasOwn(model.evidence, id))) throw new Error('Every architectural claim needs valid evidence references.');
      if (item.assessment !== 'observed') text(item.rationale, 'Interpretation rationale');
    };
    for (const view of model.views) {
      if (!view || typeof view !== 'object') throw new Error('Views must be objects.');
      if (views.has(view.id)) throw new Error('View ids must be unique.');
      for (const field of ['id', 'name', 'abstraction', 'level', 'boundary']) text(view[field], 'View ' + field);
      text(view.description, 'View description', true);
      if (view.scope) for (const field of ['id', 'name', 'type']) text(view.scope[field], 'Scope ' + field);
      global.C4Explorer.validateView(view); proof(view);
      for (const item of [...view.nodes, ...view.edges, ...(view.flows || [])]) proof(item);
      for (const item of view.nodes) {
        for (const field of ['id', 'name', 'kind']) text(item[field], 'Element ' + field);
        text(item.description, 'Element description', true);
        if (item.tech !== undefined) text(item.tech, 'Element technology');
        if (item.external !== undefined && typeof item.external !== 'boolean') throw new Error('external must be a boolean.');
        const signature = JSON.stringify([item.name, item.type, item.tech || '', item.type === 'container' ? item.shape || 'application' : '']);
        if (identity.has(item.id) && identity.get(item.id) !== signature) throw new Error('Logical identity must remain stable across views: ' + item.id);
        identity.set(item.id, signature);
      }
      for (const item of view.edges) {
        for (const field of ['id', 'from', 'to', 'label', 'protocol']) text(item[field], 'Relationship ' + field);
        if (item.async !== undefined && typeof item.async !== 'boolean') throw new Error('async must be a boolean.');
      }
      for (const item of view.flows || []) for (const field of ['id', 'name', 'description']) text(item[field], 'Flow ' + field);
      views.set(view.id, view);
    }
    if (!views.has(model.root)) throw new Error('The root view must exist.');
    const trails = new Map();
    const walk = (id, trail, ancestors) => {
      if (ancestors.has(id)) throw new Error('Decomposition cannot cycle.');
      if (trails.has(id)) return;
      trails.set(id, trail);
      const next = new Set([...ancestors, id]);
      for (const item of views.get(id).nodes) if (item.childView) {
        const child = views.get(item.childView);
        if (!child || !child.scope || child.scope.id !== item.id || child.scope.type !== item.type || child.scope.name !== item.name || (child.scope.tech || '') !== (item.tech || '')) throw new Error('A child view must decompose its linked element with matching identity: ' + item.id);
        walk(child.id, [...trail, { id: child.id, name: item.name, via: item.id }], next);
      }
    };
    walk(model.root, [{ id: model.root, name: model.name }], new Set());
    if (trails.size !== views.size) throw new Error('Every view must be reachable from the root.');
    const index = model.views.flatMap(view => view.nodes.map(item => ({
      id: item.id, name: item.name, viewId: view.id, location: view.level + ' / ' + view.name,
      trail: trails.get(view.id), text: [item.name, item.description, item.tech, ...(item.evidence || []).map(id => model.evidence[id].path)].join(' ').toLowerCase()
    })));
    return {
      samples: false, evidence: model.evidence, snapshot: model.snapshot,
      codeNote: 'Selected implementation symbols from the recorded repository snapshot. Source excerpts support the model; this is a static inspection.',
      root: () => model.root, rootTrail: () => trails.get(model.root), count: () => index.length,
      getView(id, { signal } = {}) {
        if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (!views.has(id)) throw new Error('Unknown view: ' + id);
        return views.get(id);
      },
      search(query, sample, limit = 8) {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean), matches = [];
        const size = Math.max(0, Math.min(8, Math.floor(Number(limit) || 0)));
        if (!words.length || !size) return matches;
        for (const entry of index) {
          if (words.every(word => entry.text.includes(word))) matches.push(entry);
          if (matches.length >= size) break;
        }
        return matches;
      }
    };
  }
  global.C4RepositoryModel = { createSource };
})(globalThis);

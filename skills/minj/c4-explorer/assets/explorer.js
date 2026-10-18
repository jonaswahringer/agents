(function (global) {
  'use strict';
  const LIMITS = Object.freeze({ nodes: 12, edges: 36, results: 8 });
  const TYPE_LABELS = Object.freeze({ person: 'Person', system: 'Software system', container: 'Container', component: 'Component', class: 'Class', interface: 'Interface', function: 'Function' });
  const CODE_TYPES = ['class', 'interface', 'function'];

  function wrapText(text, limit) {
    const lines = []; let line = '';
    for (let word of String(text).trim().split(/\s+/)) {
      if (line && line.length + word.length + 1 > limit) { lines.push(line); line = ''; }
      while (word.length > limit) { lines.push(word.slice(0, limit)); word = word.slice(limit); }
      if (word) line = line ? line + ' ' + word : word;
    }
    if (line) lines.push(line);
    return lines;
  }

  function validateView(view) {
    if (!view || !view.id || !Array.isArray(view.nodes) || !Array.isArray(view.edges)) throw new Error('A view needs an id, nodes, and edges.');
    const ids = new Set();
    if (view.abstraction) {
      const scopeTypes = { context: null, landscape: null, container: 'system', component: 'container', code: 'component' };
      if (!Object.hasOwn(scopeTypes, view.abstraction)) throw new Error('Unknown C4 diagram abstraction.');
      const expected = scopeTypes[view.abstraction];
      if (expected ? !view.scope || view.scope.type !== expected : Boolean(view.scope)) throw new Error('The diagram abstraction and its scope must agree.');
    }
    if (view.scope && (!view.scope.name || !['system', 'container', 'component'].includes(view.scope.type))) throw new Error('A containment boundary needs a name and a system, container, or component type.');
    for (const node of view.nodes) {
      if (!node.id || !node.name || ids.has(node.id)) throw new Error('Node ids must be unique and names must be present.');
      if (!Object.hasOwn(TYPE_LABELS, node.type)) throw new Error('Every element needs an explicit C4 type.');
      if (['context', 'landscape'].includes(view.abstraction) && !['person', 'system'].includes(node.type)) throw new Error('Context and landscape views show people and software systems.');
      if (node.shape && (node.type !== 'container' || !['application', 'database', 'queue'].includes(node.shape))) throw new Error('Container shapes are application, database, or queue.');
      if (['container', 'component', ...CODE_TYPES].includes(node.type) && !node.tech) throw new Error('Containers, components, and code elements need an explicit technology.');
      if (CODE_TYPES.includes(node.type) && view.abstraction !== 'code') throw new Error('Code elements belong in a code-level view.');
      for (const field of ['attributes', 'methods']) if (node[field] && (!Array.isArray(node[field]) || node[field].some(value => typeof value !== 'string'))) throw new Error('Code members must be arrays of strings.');
      if (view.scope && !node.external) {
        const allowed = view.scope.type === 'system' ? ['container'] : view.scope.type === 'container' ? ['component'] : CODE_TYPES;
        if (!allowed.includes(node.type)) throw new Error('Elements must match their containing C4 abstraction.');
      }
      ids.add(node.id);
    }
    const edges = new Set();
    for (const edge of view.edges) {
      if (!edge.id || edges.has(edge.id) || !ids.has(edge.from) || !ids.has(edge.to) || !edge.label) throw new Error('Relationships need unique ids, local endpoints, and intent labels.');
      if (edge.from === edge.to) throw new Error('Self-loop routing is not supported; describe this behavior in element details.');
      if (edge.relation && !['dependency', 'realization'].includes(edge.relation)) throw new Error('Supported code relationships are dependency and realization.');
      if (edge.relation && view.abstraction !== 'code') throw new Error('UML-style code relationships belong in code views.');
      if (edge.relation === 'realization' && (view.nodes.find(node => node.id === edge.from).type !== 'class' || view.nodes.find(node => node.id === edge.to).type !== 'interface')) throw new Error('A realization points from a class toward its implemented interface.');
      edges.add(edge.id);
    }
    const flows = new Set();
    if (view.flows !== undefined && !Array.isArray(view.flows)) throw new Error('Flows must be an array.');
    for (const flow of view.flows || []) {
      if (!flow.id || flows.has(flow.id) || !flow.name || !Array.isArray(flow.edges) || flow.edges.some(id => !edges.has(id)) || new Set(flow.edges).size !== flow.edges.length) throw new Error('Flows need unique ids and nonrepeated relationships in their view.');
      flows.add(flow.id);
    }
    return view;
  }

  function layoutView(view, nodes, width) {
    const columns = width < 450 ? 1 : 2, gapX = 96, gapY = 80, padding = 18;
    const cellWidth = (width - padding * 2 - gapX * (columns - 1)) / columns;
    const boxes = new Map(), groups = [];
    const internal = view.scope ? nodes.filter(item => !item.external) : nodes;
    const external = view.scope ? nodes.filter(item => item.external) : [];
    let y = view.scope && internal.length ? 52 : 8, row = 0;
    const heightOf = item => {
      if (!CODE_TYPES.includes(item.type)) return item.type === 'person' ? 228 : item.type === 'system' ? 196 : item.type === 'component' ? 170 : item.shape === 'queue' ? 170 : 184;
      const characters = Math.max(8, Math.floor((cellWidth - 36) / 6.6));
      const members = [...(item.attributes || []), ...(item.methods || [])].slice(0, 6);
      const lines = members.reduce((sum, member) => sum + wrapText(member, characters).length, 0);
      const nameLines = Math.ceil(item.name.length / Math.max(8, Math.floor((cellWidth - 36) / 8.4)));
      return 196 + lines * 18 + Math.max(0, nameLines - 1) * 19;
    };
    function place(items, name, isExternal) {
      if (!items.length) return;
      groups.push({ name, external: isExternal, ids: items.map(item => item.id) });
      for (let index = 0; index < items.length; index += columns) {
        const peers = items.slice(index, index + columns);
        const rowHeight = Math.max(...peers.map(heightOf));
        peers.forEach((item, col) => {
          const h = heightOf(item), w = item.type === 'person' ? Math.min(220, cellWidth) : cellWidth;
          boxes.set(item.id, { x: padding + col * (cellWidth + gapX) + (cellWidth - w) / 2, y: y + (rowHeight - h) / 2, w, h, row, col });
        });
        y += rowHeight + gapY; row++;
      }
      y -= gapY;
    }
    place(internal, view.scope ? TYPE_LABELS[view.scope.type] + ': ' + view.scope.name : 'People and software systems', false);
    const boundary = view.scope && internal.length ? { x: 0, y: 4, w: width, h: y + 14 } : null;
    let externalLabelY;
    if (external.length) {
      externalLabelY = y + 28;
      if (internal.length) y += gapY + 60;
      else { externalLabelY = 0; y = 30; }
      place(external, 'Outside ' + view.scope.name, true);
    }
    return { boxes, groups, boundary, externalLabelY, columns, gapY, height: Math.max(1, y + 20) };
  }

  function projectView(view, page = 0, size = LIMITS.nodes, flowId = '') {
    size = Math.max(1, Math.min(LIMITS.nodes, Math.floor(size) || LIMITS.nodes));
    const pages = Math.max(1, Math.ceil(view.nodes.length / size));
    page = Math.max(0, Math.min(pages - 1, Math.floor(page) || 0));
    const nodes = view.nodes.slice(page * size, (page + 1) * size);
    const ids = new Set(nodes.map(node => node.id));
    const local = view.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to));
    const flow = (view.flows || []).find(item => item.id === flowId);
    const active = new Set(flow ? flow.edges : []);
    const ordered = [...local].sort((a, b) => Number(active.has(b.id)) - Number(active.has(a.id)));
    return { nodes, edges: ordered.slice(0, LIMITS.edges), page, pages, flow,
      outside: view.edges.length - local.length, omitted: Math.max(0, local.length - LIMITS.edges) };
  }

  function mount(root, source) {
    const $ = selector => root.querySelector(selector);
    const elements = { stage: $('.c4-stage'), nodes: $('.c4-nodes'), edges: $('.c4-edges'), scope: $('.c4-scope'), boundaries: $('.c4-boundaries'),
      heading: $('h2'), breadcrumb: $('.c4-breadcrumb'), search: $('input'), results: $('.c4-results'),
      flow: $('select'), detail: $('.c4-detail'), relations: $('.c4-relations ol'), inspector: $('.c4-inspector') };
    const NS = 'http://www.w3.org/2000/svg';
    const instance = 'c4-' + Math.random().toString(36).slice(2);
    elements.results.id = instance + '-results';
    elements.search.setAttribute('aria-controls', elements.results.id);
    $('.c4-inspector-header h3').id = instance + '-inspector-title';
    elements.inspector.setAttribute('aria-labelledby', instance + '-inspector-title');
    const pages = new Map();
    const motion = global.matchMedia('(prefers-reduced-motion: reduce)');
    let view, trail = [], page = 0, flowId = '', sample = 'demo', sequence = 0, controller, selected = '';
    let animations = [], resizeFrame = 0, destroyed = false, searchSequence = 0;
    let inspectorReturnId = '', inspectorReturnElement;
    const events = new AbortController();
    const listen = (target, event, handler) => target.addEventListener(event, handler, { signal: events.signal });
    const node = (tag, className, value) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (value !== undefined) element.textContent = value;
      return element;
    };
    const svg = (tag, attrs) => {
      const element = document.createElementNS(NS, tag);
      for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
      return element;
    };
    function evidenceBlock(item) {
      const section = node('section', 'c4-evidence');
      section.append(node('h4', '', 'Evidence and interpretation'));
      if (item.assessment) section.append(node('p', '', item.assessment + (item.rationale ? ' · ' + item.rationale : '')));
      for (const id of item.evidence || []) {
        const proof = source.evidence && source.evidence[id];
        if (!proof) continue;
        const details = node('details');
        details.append(node('summary', '', proof.path + ':' + proof.line + (proof.endLine > proof.line ? '–' + proof.endLine : '')));
        details.append(node('p', '', proof.reason));
        if (proof.excerpt) { const pre = node('pre'); pre.append(node('code', '', proof.excerpt)); details.append(pre); }
        if (proof.sha256) details.append(node('small', '', 'File SHA-256: ' + proof.sha256));
        section.append(details);
      }
      return section;
    }
    function inspectView(origin) {
      const blocks = [node('p', '', view.description || '')];
      if (view.coverage) blocks.push(node('p', '', view.coverage));
      if (source.snapshot) blocks.push(node('p', '', 'Source snapshot: ' + source.snapshot.revision + ' · ' + source.snapshot.date + '. Static inspection; runtime behavior was not exercised.'));
      blocks.push(evidenceBlock(view));
      const flow = (view.flows || []).find(item => item.id === flowId);
      if (flow) blocks.push(node('h4', '', flow.name), node('p', '', flow.description || ''), evidenceBlock(flow));
      showInspector(view.name, blocks, origin);
    }
    function shapeOf(item, w, h) {
      const drawing = svg('svg', { class: 'c4-node-shape', viewBox: '0 0 ' + w + ' ' + h, 'aria-hidden': 'true', preserveAspectRatio: 'none' });
      const shape = (tag, attrs) => drawing.append(svg(tag, { class: 'c4-shape-fill', ...attrs }));
      if (item.type === 'person') {
        shape('circle', { cx: w / 2, cy: 23, r: 21 });
        shape('path', { d: 'M1 ' + (h - 1) + ' V81 Q1 54 ' + w / 2 + ' 54 Q' + (w - 1) + ' 54 ' + (w - 1) + ' 81 V' + (h - 1) + ' Z' });
      } else if (item.shape === 'database') {
        shape('path', { d: 'M1 18 C1 -4 ' + (w - 1) + ' -4 ' + (w - 1) + ' 18 V' + (h - 18) + ' C' + (w - 1) + ' ' + (h + 4) + ' 1 ' + (h + 4) + ' 1 ' + (h - 18) + ' Z' });
        drawing.append(svg('ellipse', { class: 'c4-shape-line', cx: w / 2, cy: 18, rx: w / 2 - 1, ry: 16 }));
      } else if (item.shape === 'queue') {
        shape('rect', { x: 1, y: 1, width: w - 2, height: h - 2, rx: 23 });
        drawing.append(svg('path', { class: 'c4-shape-line', d: 'M' + (w - 23) + ' 1 C' + (w - 50) + ' 1 ' + (w - 50) + ' ' + (h - 1) + ' ' + (w - 23) + ' ' + (h - 1) }));
      } else if (item.type === 'component') {
        shape('rect', { x: 10, y: 1, width: w - 11, height: h - 2, rx: 1 });
        for (const y of [22, 47]) shape('rect', { x: 1, y, width: 19, height: 13 });
      } else {
        shape('rect', { x: 1, y: 1, width: w - 2, height: h - 2, rx: item.type === 'system' ? 2 : 6 });
        if (item.type === 'container') {
          drawing.append(svg('path', { class: 'c4-shape-line', d: 'M1 25 H' + (w - 1) }));
          for (const x of [12, 21, 30]) drawing.append(svg('circle', { class: 'c4-chrome-dot', cx: x, cy: 13, r: 2 }));
        }
      }
      return drawing;
    }
    const announce = text => { $('.c4-live').textContent = text; };
    const describe = (title, text) => { elements.detail.replaceChildren(node('strong', '', title), node('p', '', text)); };
    function showInspector(title, blocks, origin, returnId) {
      inspectorReturnId = returnId || ''; inspectorReturnElement = document.activeElement;
      $('.c4-inspector-header h3').textContent = title;
      $('.c4-inspector-body').replaceChildren(...blocks);
      elements.inspector.showModal();
      const rect = elements.inspector.getBoundingClientRect();
      elements.inspector.style.left = Math.max(12, (innerWidth - rect.width) / 2) + scrollX + 'px';
      elements.inspector.style.top = Math.max(12, Math.min(origin.top, innerHeight - rect.height - 12)) + scrollY + 'px';
      $('[data-action="close-inspector"]').focus({ preventScroll: true });
      elements.inspector.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }
    function dependencyMap(item, relationships) {
      const figure = node('figure', 'c4-inspector-map');
      figure.setAttribute('aria-label', 'Dependency neighborhood of ' + item.name + ' in ' + view.name);
      figure.append(node('figcaption', '', 'Dependency neighborhood'));
      const visible = relationships.slice(0, 6);
      const peers = (edges, incoming) => {
        const group = node('div', 'c4-map-peers');
        for (const edge of edges) {
          const peer = view.nodes.find(node => node.id === (incoming ? edge.from : edge.to));
          const box = node('div', 'c4-map-peer');
          box.dataset.peerId = peer.id;
          const name = node('strong');
          peer.name.split(/(?<=[a-z0-9])(?=[A-Z])/).forEach((part, index) => { if (index) name.append(node('wbr')); name.append(document.createTextNode(part)); });
          box.append(name, node('small', '', TYPE_LABELS[peer.type]), node('span', '', edge.label));
          group.append(box);
        }
        return group;
      };
      const incoming = visible.filter(edge => edge.to === item.id);
      const outgoing = visible.filter(edge => edge.from === item.id);
      const arrow = () => { const element = node('div', 'c4-map-arrow', '↓'); element.setAttribute('aria-hidden', 'true'); return element; };
      if (incoming.length) figure.append(node('div', 'c4-map-direction', 'Incoming'), peers(incoming, true), arrow());
      const selected = node('div', 'c4-map-selected');
      selected.append(node('strong', '', item.name), node('small', '', TYPE_LABELS[item.type] + ' · selected'));
      figure.append(selected);
      if (outgoing.length) figure.append(arrow(), node('div', 'c4-map-direction', 'Outgoing'), peers(outgoing, false));
      if (!relationships.length) figure.append(node('p', 'c4-map-note', 'No relationships are modeled for this element in the current view.'));
      if (relationships.length > visible.length) figure.append(node('p', 'c4-map-note', (relationships.length - visible.length) + ' additional relationships are listed below.'));
      figure.append(node('p', 'c4-map-note', 'Arrows follow dependency direction. Only relationships in the current view are shown.'));
      return figure;
    }
    function inspectItem(item, origin) {
      const overview = node('section', 'c4-inspector-overview');
      overview.append(node('p', 'c4-inspector-type', TYPE_LABELS[item.type] + ' · ' + item.kind), node('p', '', item.description));
      const metadata = node('dl', 'c4-inspector-metadata');
      const property = (label, value) => { metadata.append(node('dt', '', label), node('dd', '', value)); };
      if (item.tech) property('Technology', item.tech);
      if (item.owner) property('Owner', item.owner);
      property('Scope', view.name);
      property('Location', item.external ? 'Outside the current boundary' : 'Inside the current scope');
      overview.append(metadata);
      if (item.evidence && item.evidence.length) overview.append(evidenceBlock(item));
      const columns = node('div', 'c4-inspector-columns');
      const implementation = node('section', 'c4-inspector-implementation');
      implementation.setAttribute('aria-label', 'Element information');
      implementation.append(node('h4', '', CODE_TYPES.includes(item.type) ? 'Implementation' : 'Element information'), overview);
      for (const [key, title] of [['attributes', 'Attributes'], ['methods', 'Operations']]) {
        if (!(item[key] || []).length) continue;
        implementation.append(node('h4', '', title));
        const list = node('ul', 'c4-inspector-members');
        for (const member of item[key].slice(0, 64)) { const entry = node('li'); entry.append(node('code', '', member)); list.append(entry); }
        if (item[key].length > 64) list.append(node('li', '', (item[key].length - 64) + ' more members omitted from this inspector.'));
        implementation.append(list);
      }
      const dependencies = view.edges.filter(edge => edge.from === item.id || edge.to === item.id);
      const connections = node('section', 'c4-inspector-connections');
      connections.setAttribute('aria-label', 'Relationships in this view');
      connections.append(node('h4', '', 'Relationships in this view'), dependencyMap(item, dependencies));
      if (dependencies.length) {
        const list = node('ul', 'c4-inspector-relationships');
        for (const edge of dependencies.slice(0, LIMITS.edges)) {
          const entry = node('li');
          entry.append(node('strong', '', view.nodes.find(node => node.id === edge.from).name + ' → ' + view.nodes.find(node => node.id === edge.to).name), node('span', '', edge.label), node('small', '', edge.relation === 'realization' ? 'Interface realization' : edge.protocol || 'Dependency'));
          if (edge.evidence && edge.evidence.length) entry.append(evidenceBlock(edge));
          list.append(entry);
        }
        if (dependencies.length > LIMITS.edges) list.append(node('li', '', (dependencies.length - LIMITS.edges) + ' more relationships omitted.'));
        connections.append(list);
      }
      columns.append(implementation, connections);
      const blocks = [columns];
      blocks.push(node('p', 'c4-inspector-note', CODE_TYPES.includes(item.type) ? (source.codeNote || 'Illustrative code model, not generated from source. This symbol has no further drill-down.') : 'This is a detail inspector, not another C4 abstraction level.'));
      showInspector(item.name, blocks, origin, item.id);
    }
    listen(elements.inspector, 'cancel', event => { event.preventDefault(); elements.inspector.close(); });
    listen(elements.inspector, 'close', () => {
      const target = inspectorReturnId ? [...elements.nodes.querySelectorAll('[data-node-id]')].find(element => element.dataset.nodeId === inspectorReturnId) : inspectorReturnElement;
      if (!destroyed && target && target.isConnected) target.focus({ preventScroll: true });
    });
    const cancelAnimation = () => {
      animations.forEach(animation => animation.cancel()); animations = [];
      root.querySelectorAll('.c4-transition').forEach(element => element.remove());
    };
    function transition(origin, direction) {
      cancelAnimation();
      if (motion.matches) return;
      const rect = elements.stage.getBoundingClientRect();
      const x = origin ? origin.left + origin.width / 2 - rect.left : rect.width / 2;
      const y = origin ? origin.top + origin.height / 2 - rect.top : rect.height / 2;
      elements.nodes.style.transformOrigin = x + 'px ' + y + 'px';
      const scale = direction === 'up' ? 1.035 : .955;
      animations.push(elements.nodes.animate([{ opacity: .1, transform: 'scale(' + scale + ')' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: 340, easing: 'cubic-bezier(.2,.75,.25,1)' }));
      animations.push(elements.edges.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 110 }));
      if (!origin || direction === 'up') return;
      const scope = elements.scope.getBoundingClientRect();
      const ghost = node('div', 'c4-transition');
      Object.assign(ghost.style, { left: '0', top: '0', width: scope.width + 'px', height: scope.height + 'px' });
      elements.scope.append(ghost);
      const animation = ghost.animate([
        { transform: 'translate(' + (origin.left - scope.left) + 'px,' + (origin.top - scope.top) + 'px) scale(' + origin.width / scope.width + ',' + origin.height / scope.height + ')', opacity: .8 },
        { transform: 'translate(0,0) scale(1,1)', opacity: 0 }
      ], { duration: 400, easing: 'cubic-bezier(.2,.75,.25,1)' });
      animations.push(animation);
      animation.finished.then(() => ghost.remove()).catch(() => {});
    }

    function render() {
      if (!view || destroyed) return;
      cancelAnimationFrame(resizeFrame); resizeFrame = 0;
      const start = performance.now();
      const width = elements.stage.clientWidth;
      if (width <= 0) return;
      lastWidth = width;
      const columns = width < 450 ? 1 : 2;
      const size = columns === 1 ? 6 : LIMITS.nodes;
      if (selected) {
        const index = view.nodes.findIndex(item => item.id === selected);
        if (index >= 0) page = Math.floor(index / size);
      }
      const projection = projectView(view, page, size, flowId);
      page = projection.page; pages.set(view.id, page);
      const layout = layoutView(view, projection.nodes, width);
      const { boxes, gapY } = layout;
      const boundaryNodes = document.createDocumentFragment();
      if (layout.boundary) {
        const boundary = node('div', 'c4-boundary c4-boundary--' + view.scope.type);
        const label = node('div', 'c4-boundary-label');
        label.append(node('strong', '', view.scope.name), node('span', '', '[' + TYPE_LABELS[view.scope.type] + ' boundary' + (view.scope.tech ? ' · ' + view.scope.tech : '') + ']'));
        boundary.append(label);
        Object.assign(boundary.style, { left: '0', top: layout.boundary.y + 'px', width: width + 'px', height: layout.boundary.h + 'px' });
        boundaryNodes.append(boundary);
      }
      if (layout.externalLabelY !== undefined) {
        const label = node('div', 'c4-external-label', 'External dependencies'); label.style.top = layout.externalLabelY + 'px'; boundaryNodes.append(label);
      }
      elements.boundaries.replaceChildren(boundaryNodes);
      const flowEdges = new Set(projection.flow ? projection.flow.edges : []);
      const flowNodes = new Set(view.edges.filter(edge => flowEdges.has(edge.id)).flatMap(edge => [edge.from, edge.to]));
      const nodes = document.createDocumentFragment();
      const nodeGroups = new Map();
      for (const group of layout.groups) {
        const element = node('div', 'c4-node-group'); element.setAttribute('role', 'group'); element.setAttribute('aria-label', group.name);
        group.ids.forEach(id => nodeGroups.set(id, element)); nodes.append(element);
      }
      projection.nodes.forEach(item => {
        const box = boxes.get(item.id);
        const childLabel = item.childLabel || ({ system: 'containers', container: 'components', component: 'code' })[item.type] || 'scope';
        const shape = item.type === 'container' ? item.shape || 'application' : '';
        const button = node('button', 'c4-node c4-node--' + item.type + (shape ? ' c4-node--' + shape : '') + (item.childView ? ' is-primary' : '') + (item.external ? ' is-external' : '') +
          (flowId && !flowNodes.has(item.id) ? ' is-dim' : '') + (selected === item.id ? ' is-selected' : ''));
        button.type = 'button'; button.dataset.nodeId = item.id;
        if (!item.childView) button.setAttribute('aria-haspopup', 'dialog');
        button.dataset.c4Type = item.type;
        button.setAttribute('aria-label', item.name + ', ' + TYPE_LABELS[item.type] + ', ' + item.kind + (item.tech ? ', ' + item.tech : '') + '. ' + item.description + (item.childView ? ' Explore ' + childLabel : ' Show details'));
        Object.assign(button.style, { left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' });
        button.append(shapeOf(item, box.w, box.h), node('strong', 'c4-node-name', item.name),
          node('span', 'c4-kind', '[' + TYPE_LABELS[item.type] + (item.tech ? ': ' + item.tech : '') + ']'), node('span', 'c4-node-description', item.description));
        if (CODE_TYPES.includes(item.type)) {
          const members = node('span', 'c4-uml-members'); let remaining = 6;
          for (const key of ['attributes', 'methods']) {
            const section = node('span', 'c4-uml-' + key);
            const visible = (item[key] || []).slice(0, remaining); remaining -= visible.length;
            for (const member of visible) section.append(node('code', '', member));
            if (visible.length) members.append(section);
          }
          const omitted = (item.attributes || []).length + (item.methods || []).length - (6 - remaining);
          if (omitted) members.append(node('span', '', '+' + omitted + ' members in inspector'));
          button.append(members);
        }
        button.append(node('span', 'c4-node-bottom', item.childView ? 'Explore ' + childLabel + ' ↗' : 'Inspect details'));
        nodeGroups.get(item.id).append(button);
        if (item.childView && item.evidence && item.evidence.length) {
          const details = node('button', 'c4-evidence-action', 'Details'); details.type = 'button'; details.dataset.inspectId = item.id;
          details.setAttribute('aria-label', 'Details and evidence for ' + item.name);
          Object.assign(details.style, { left: box.x + box.w - 76 + 'px', top: box.y + box.h - 33 + 'px' });
          nodeGroups.get(item.id).append(details);
        }
      });
      elements.nodes.replaceChildren(nodes);
      const totalHeight = layout.height;
      elements.stage.style.height = totalHeight + 'px';
      elements.nodes.style.height = totalHeight + 'px';
      elements.edges.setAttribute('viewBox', '0 0 ' + Math.max(1, width) + ' ' + totalHeight);
      const defs = svg('defs', {});
      for (const active of [false, true]) {
        const marker = svg('marker', { id: instance + (active ? '-active' : '-arrow'), viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
        marker.append(svg('path', { d: 'M0 0 L8 4 L0 8 Z', fill: active ? 'var(--c4-accent)' : 'var(--c4-muted)' })); defs.append(marker);
      }
      for (const relation of ['dependency', 'realization']) {
        const marker = svg('marker', { id: instance + '-' + relation, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' });
        marker.append(svg('path', { d: relation === 'realization' ? 'M1 1 L9 5 L1 9 Z' : 'M2 1 L9 5 L2 9', fill: relation === 'realization' ? 'var(--c4-bg)' : 'none', stroke: 'var(--c4-muted)', 'stroke-width': 1.2 })); defs.append(marker);
      }
      const paths = document.createDocumentFragment(); paths.append(defs);
      projection.edges.forEach(edge => {
        const a = boxes.get(edge.from), b = boxes.get(edge.to);
        const active = flowEdges.has(edge.id);
        let d, labelX, labelY;
        if (a.row === b.row) {
          const forward = b.x > a.x, ax = forward ? a.x + a.w : a.x, bx = forward ? b.x : b.x + b.w;
          const cy = a.y + a.h / 2;
          d = 'M' + ax + ' ' + cy + ' H' + bx; labelX = (ax + bx) / 2; labelY = cy;
        } else if (a.col === b.col) {
          const down = b.y > a.y, ax = a.x + a.w / 2, ay = down ? a.y + a.h : a.y, by = down ? b.y : b.y + b.h;
          // Long links run beside the column so they never pass through intervening cards.
          const adjacent = Math.abs(b.row - a.row) === 1;
          const lane = columns === 1 ? width - 5 : a.col === 0 ? a.x + a.w + 18 : a.x - 18;
          d = adjacent ? 'M' + ax + ' ' + ay + ' V' + by : 'M' + ax + ' ' + ay + ' v' + (down ? 20 : -20) + ' H' + lane + ' V' + (by + (down ? -20 : 20)) + ' H' + ax + ' V' + by;
          labelX = ax; labelY = adjacent ? (ay + by) / 2 : by + (down ? -gapY / 2 : gapY / 2);
        } else {
          const down = b.y > a.y, ax = a.x + a.w / 2, bx = b.x + b.w / 2;
          const ay = down ? a.y + a.h : a.y, by = down ? b.y : b.y + b.h;
          const midY = ay + (down ? gapY / 2 : -gapY / 2), lane = (width / 2);
          d = 'M' + ax + ' ' + ay + ' V' + midY + ' H' + lane + ' V' + (by + (down ? -gapY / 2 : gapY / 2)) + ' H' + bx + ' V' + by;
          labelX = lane; labelY = midY;
        }
        paths.append(svg('path', { d, class: 'c4-edge' + (edge.async || edge.relation ? ' is-async' : '') + (active ? ' is-active' : flowId ? ' is-dim' : ''),
          'marker-end': 'url(#' + instance + (edge.relation ? '-' + edge.relation : active ? '-active' : '-arrow') + ')' }));
        const step = projection.flow ? projection.flow.edges.indexOf(edge.id) + 1 : 0;
        if (step > 0 || !flowId) {
          const horizontal = a.row === b.row, limit = horizontal ? 12 : 28;
          const intent = step > 0 ? [String(step)] : wrapText(edge.label, limit);
          const protocol = !flowId && edge.protocol ? wrapText(edge.protocol, limit) : [];
          const lines = [...intent, ...protocol], labelHeight = lines.length * 14 + 8;
          const labelWidth = Math.min(horizontal ? 80 : 220, Math.max(20, Math.max(...lines.map(line => line.length)) * 5.5 + 12));
          const group = svg('g', { class: 'c4-edge-annotation', 'data-relationship-id': edge.id });
          group.append(svg('rect', { x: labelX - labelWidth / 2, y: labelY - labelHeight / 2, width: labelWidth, height: labelHeight, rx: 4, class: 'c4-edge-back' }));
          lines.forEach((line, index) => {
            const label = svg('text', { x: labelX, y: labelY - labelHeight / 2 + 14 + index * 14, class: 'c4-edge-label' + (index >= intent.length ? ' c4-edge-protocol' : '') });
            label.textContent = line; group.append(label);
          });
          paths.append(group);
        }
      });
      elements.edges.replaceChildren(paths);
      $('.c4-count').textContent = view.nodes.length ? (page * size + 1) + '–' + Math.min((page + 1) * size, view.nodes.length) + ' of ' + view.nodes.length + ' elements' : 'No elements';
      $('.c4-page-number').textContent = (page + 1) + ' / ' + projection.pages;
      $('[data-action="previous"]').disabled = page === 0;
      $('[data-action="next"]').disabled = page === projection.pages - 1;
      const extra = projection.outside + ' connections outside this page' + (projection.omitted ? ' · ' + projection.omitted + ' local connections omitted by render budget' : '');
      $('.c4-relations summary').textContent = view.edges.length + ' relationships · ' + extra;
      const relationList = document.createDocumentFragment();
      const lookup = new Map(view.nodes.map(item => [item.id, item]));
      // The accessible list is paged too; a dense view cannot silently mount thousands of buttons.
      const listEdges = projection.flow ? projection.flow.edges.map(id => view.edges.find(edge => edge.id === id)) : view.edges;
      const listLimit = LIMITS.edges;
      listEdges.slice(0, listLimit).forEach((edge, index) => {
        const li = node('li'); const button = node('button'); button.type = 'button'; button.dataset.edgeId = edge.id;
        button.append(node('span', '', (projection.flow ? (index + 1) + '. ' : '') + lookup.get(edge.from).name + ' → ' + lookup.get(edge.to).name),
          node('small', '', edge.label + ' · ' + edge.protocol + (edge.async ? ' · asynchronous' : '')));
        li.append(button); relationList.append(li);
      });
      if (listEdges.length > listLimit) relationList.append(node('li', '', (listEdges.length - listLimit) + ' more relationships. Partition this scope or query an endpoint neighborhood.'));
      elements.relations.replaceChildren(relationList);
      if (projection.flow) describe(projection.flow.name, projection.flow.description + ' Numbered arrows match the ordered relationships below.');
      else if (!selected) describe(view.prompt || 'Explore this scope', view.coverage || (view.scope ? 'The dashed boundary contains ' + (view.scope.type === 'system' ? 'deployable containers' : view.scope.type === 'container' ? 'implementation components' : 'code elements') + '. External dependencies sit outside it.' : 'People interact with software systems. Open a system to explore its containers.'));
      const keys = new Map();
      for (const item of projection.nodes) {
        const key = item.type === 'container' ? item.shape || 'application' : item.type;
        if (!keys.has(key)) keys.set(key, item);
      }
      const legend = $('.c4-key'); legend.replaceChildren();
      for (const [key, item] of keys) {
        const entry = node('span', 'c4-key-item c4-node--' + item.type);
        const icon = svg('svg', { class: 'c4-key-icon', viewBox: '0 0 28 24', 'aria-hidden': 'true' });
        const mark = (tag, attrs) => icon.append(svg(tag, { class: 'c4-shape-fill', ...attrs }));
        if (key === 'person') { mark('circle', { cx: 14, cy: 5, r: 4 }); mark('path', { d: 'M5 23 V16 Q5 11 14 11 Q23 11 23 16 V23 Z' }); }
        else if (key === 'database') { mark('path', { d: 'M2 5 C2 0 26 0 26 5 V19 C26 24 2 24 2 19 Z' }); icon.append(svg('ellipse', { class: 'c4-shape-line', cx: 14, cy: 5, rx: 12, ry: 4 })); }
        else if (key === 'queue') { mark('rect', { x: 1, y: 4, width: 26, height: 17, rx: 6 }); icon.append(svg('path', { class: 'c4-shape-line', d: 'M22 4 C14 4 14 21 22 21' })); }
        else if (key === 'component') { mark('rect', { x: 6, y: 2, width: 21, height: 21 }); for (const y of [6, 15]) mark('rect', { x: 1, y, width: 10, height: 5 }); }
        else { mark('rect', { x: 1, y: 2, width: 26, height: 21, rx: key === 'system' || CODE_TYPES.includes(key) ? 1 : 3 }); if (key === 'application' || CODE_TYPES.includes(key)) icon.append(svg('path', { class: 'c4-shape-line', d: 'M1 8 H27' })); }
        entry.append(icon, node('span', '', ({ application: 'Application', database: 'Data store', queue: 'Message broker' })[key] || TYPE_LABELS[item.type])); legend.append(entry);
      }
      if (projection.nodes.some(item => item.external)) legend.append(node('span', 'c4-key-external', 'Gray = outside the current scope'));
      legend.append(node('span', 'c4-key-external', view.abstraction === 'code' ? 'UML-style: + public · - private · dashed open arrow = dependency · hollow triangle = interface realization' : 'Dashed arrow = asynchronous interaction'));
      $('.c4-metrics').textContent = projection.nodes.length + ' nodes mounted · ' + source.count(sample).toLocaleString() + ' indexed · ' + (performance.now() - start).toFixed(1) + ' ms DOM update';
      return projection;
    }

    function header() {
      elements.heading.textContent = view.name;
      root.dataset.abstraction = view.abstraction || '';
      $('.c4-eyebrow').textContent = view.level;
      $('.c4-description').textContent = view.description;
      $('.c4-scope-label').textContent = view.boundary;
      const back = $('[data-action="back"]');
      const parent = trail[trail.length - 2];
      back.hidden = !parent;
      back.disabled = !parent;
      $('.c4-back-destination').textContent = parent ? parent.name : '';
      back.setAttribute('aria-label', parent ? 'Back to parent: ' + parent.name : 'Back to parent');
      const sampleButton = $('[data-action="sample"]');
      sampleButton.hidden = source.samples === false;
      sampleButton.textContent = sample === 'demo' ? 'Try 10,400 elements' : 'Return to commerce demo';
      const viewDetails = $('[data-action="view-details"]');
      if (viewDetails) viewDetails.hidden = !source.evidence;
      elements.breadcrumb.replaceChildren();
      trail.forEach((entry, index) => {
        if (index) elements.breadcrumb.append(node('span', '', '›'));
        const button = node('button', '', entry.name); button.type = 'button'; button.dataset.crumb = index;
        if (index === trail.length - 1) button.setAttribute('aria-current', 'page');
        elements.breadcrumb.append(button);
      });
      elements.flow.replaceChildren();
      const all = node('option', '', 'All relationships'); all.value = ''; elements.flow.append(all);
      for (const flow of view.flows || []) { const option = node('option', '', flow.name); option.value = flow.id; elements.flow.append(option); }
      elements.flow.disabled = !(view.flows || []).length;
      elements.relations.parentElement.open = false;
    }

    async function navigate(id, options = {}) {
      if (destroyed) return;
      const ticket = ++sequence;
      if (controller) controller.abort(); controller = new AbortController();
      root.setAttribute('aria-busy', 'true');
      const focusWasInside = root.contains(document.activeElement);
      try {
        const loaded = validateView(await source.getView(id, { signal: controller.signal }));
        if (destroyed || ticket !== sequence) return;
        if (loaded.id !== id) throw new Error('The provider returned a different scope.');
        view = loaded; trail = options.trail || [...trail, { id, name: view.name }];
        if (elements.inspector.open) elements.inspector.close();
        flowId = ''; selected = options.focusId || ''; page = pages.get(id) || 0;
        if (selected) { const index = view.nodes.findIndex(item => item.id === selected); if (index >= 0) page = Math.floor(index / (elements.stage.clientWidth < 450 ? 6 : LIMITS.nodes)); }
        elements.search.value = ''; elements.results.hidden = true; ++searchSequence;
        header(); cancelAnimation(); render();
        if (options.animate !== false) transition(options.origin, options.direction);
        if (selected) { const item = view.nodes.find(item => item.id === selected); if (item) describe(item.name, item.description + (item.tech ? ' Technology: ' + item.tech + '.' : '')); }
        if (focusWasInside) {
          const target = [...elements.nodes.querySelectorAll('[data-node-id]')].find(element => element.dataset.nodeId === (options.focusId || options.restoreId));
          (target || elements.heading).focus({ preventScroll: true });
        }
        announce(view.name + '. ' + view.level + '. ' + view.nodes.length + ' elements.');
      } catch (error) {
        if (!destroyed && ticket === sequence && error.name !== 'AbortError') { describe('Could not open this scope', error.message); announce('Could not open this scope.'); }
      } finally { if (ticket === sequence) root.removeAttribute('aria-busy'); }
    }

    function up() {
      if (trail.length < 2) return;
      const child = trail[trail.length - 1]; const next = trail.slice(0, -1);
      navigate(next[next.length - 1].id, { trail: next, direction: 'up', restoreId: child.via });
    }
    listen(root, 'click', event => {
      const button = event.target.closest('button'); if (!button || !root.contains(button)) return;
      if (button.dataset.inspectId) {
        const item = view.nodes.find(item => item.id === button.dataset.inspectId);
        inspectItem(item, button.getBoundingClientRect());
      } else if (button.dataset.action === 'view-details') inspectView(button.getBoundingClientRect());
      else if (button.dataset.nodeId) {
        const item = view.nodes.find(item => item.id === button.dataset.nodeId);
        if (item.childView) navigate(item.childView, { trail: [...trail, { id: item.childView, name: item.name, via: item.id }], origin: button.getBoundingClientRect() });
        else { const origin = button.getBoundingClientRect(); selected = item.id; flowId = ''; elements.flow.value = ''; render(); describe(item.name, item.description + (item.tech ? ' Technology: ' + item.tech + '.' : '') + (item.owner ? ' Owner: ' + item.owner + '.' : '')); inspectItem(item, origin); }
      } else if (button.dataset.crumb !== undefined) {
        const next = trail.slice(0, Number(button.dataset.crumb) + 1); navigate(next[next.length - 1].id, { trail: next, direction: 'up' });
      } else if (button.dataset.result !== undefined) {
        const result = searchResults[Number(button.dataset.result)];
        navigate(result.viewId, { trail: result.trail, focusId: result.id });
      } else if (button.dataset.edgeId) {
        const edge = view.edges.find(item => item.id === button.dataset.edgeId);
        describe(edge.label, view.nodes.find(item => item.id === edge.from).name + ' → ' + view.nodes.find(item => item.id === edge.to).name + '. ' + edge.protocol + (edge.async ? ', asynchronous.' : ', synchronous.'));
        if (edge.evidence && edge.evidence.length) showInspector(edge.label, [node('p', '', edge.protocol + (edge.async ? ' · asynchronous' : '')), evidenceBlock(edge)], button.getBoundingClientRect());
      } else if (button.dataset.action === 'close-inspector') elements.inspector.close();
      else if (button.dataset.action === 'back') up();
      else if (button.dataset.action === 'sample') {
        sample = sample === 'demo' ? 'scale' : 'demo'; navigate(source.root(sample), { trail: source.rootTrail(sample) });
      } else if (['previous', 'next'].includes(button.dataset.action)) {
        page += button.dataset.action === 'next' ? 1 : -1; selected = ''; cancelAnimation(); render(); announce('Page ' + (page + 1));
      }
    });
    listen(root, 'keydown', event => { if (event.key === 'Escape' && !elements.inspector.open) { event.preventDefault(); if (!elements.results.hidden) { elements.results.hidden = true; elements.search.focus(); } else up(); } });
    listen(elements.flow, 'change', () => { flowId = elements.flow.value; selected = ''; cancelAnimation(); render(); announce(flowId ? 'Flow highlighted. Open relationships for ordered steps.' : 'All relationships shown.'); });
    let searchResults = [];
    listen(elements.search, 'input', async () => {
      const query = elements.search.value.trim(); const ticket = ++searchSequence;
      if (!query) { elements.results.hidden = true; return; }
      try {
        const results = await source.search(query, sample, LIMITS.results);
        if (ticket !== searchSequence || destroyed) return;
        searchResults = results.slice(0, LIMITS.results); elements.results.replaceChildren(); elements.results.hidden = false;
        for (const [index, result] of searchResults.entries()) {
          const li = node('li'), button = node('button'); button.type = 'button'; button.dataset.result = index;
          button.append(node('span', '', result.name), node('small', '', result.location)); li.append(button); elements.results.append(li);
        }
        if (!searchResults.length) elements.results.append(node('li', 'c4-empty', 'No matching elements.'));
        announce(searchResults.length + ' results shown, maximum ' + LIMITS.results + '.');
      } catch (error) { if (!destroyed && ticket === searchSequence) announce('Search failed: ' + error.message); }
    });
    let lastWidth = elements.stage.clientWidth;
    const observer = new ResizeObserver(entries => {
      const width = entries[0].contentRect.width;
      if (Math.abs(width - lastWidth) < 1) return;
      lastWidth = width; cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => { cancelAnimation(); render(); });
    });
    observer.observe(elements.stage);
    navigate(source.root(sample), { trail: source.rootTrail(sample), animate: false });
    return { navigate, inspect: () => ({ viewId: view && view.id, page, trail: [...trail], sample, flowId, selected }),
      destroy() { destroyed = true; ++sequence; ++searchSequence; if (controller) controller.abort(); if (elements.inspector.open) elements.inspector.close(); events.abort(); observer.disconnect(); cancelAnimationFrame(resizeFrame); cancelAnimation(); root.removeAttribute('aria-busy'); } };
  }
  global.C4Explorer = Object.freeze({ LIMITS, validateView, projectView, layoutView, wrapText, mount });
})(typeof window === 'undefined' ? globalThis : window);

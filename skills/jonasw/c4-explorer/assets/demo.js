(function (global) {
  'use strict';
  const item = (id, name, kind, description, extra = {}) => ({ id, name, kind, description, ...extra });
  const edge = (id, from, to, label, protocol, async = false) => ({ id, from, to, label, protocol, async });
  const shopper = item('shopper', 'Customer', 'Person', 'Browses products and places orders.', { type: 'person', external: true });
  const payment = item('payments', 'Payment provider', 'External software system', 'Authorizes payments and reports settlement.', { type: 'system', external: true, owner: 'Payment partner' });
  const views = {
    context: {
      id: 'context', abstraction: 'context', name: 'Commerce platform', level: 'L1 / System context', boundary: 'People and software systems · No implementation detail at this level',
      description: 'Follow a purchase from the customer to the systems that support it.', prompt: 'Start with the Commerce platform block',
      nodes: [shopper, item('commerce', 'Commerce platform', 'Software system', 'Sells products and fulfills customer orders.', { type: 'system', childView: 'containers', childLabel: 'containers', owner: 'Commerce' }), payment,
        item('email', 'Email provider', 'External software system', 'Delivers receipts and shipping updates.', { type: 'system', external: true })],
      edges: [edge('shop', 'shopper', 'commerce', 'Browses and purchases products', 'HTTPS'), edge('pay', 'commerce', 'payments', 'Authorizes customer payments', 'HTTPS / JSON'), edge('notify', 'commerce', 'email', 'Sends order receipts', 'HTTPS API', true)],
      flows: [{ id: 'purchase', name: 'Place an order', description: 'The customer buys a product, payment is authorized, and a receipt is sent.', edges: ['shop', 'pay', 'notify'] }]
    },
    containers: {
      id: 'containers', abstraction: 'container', scope: { id: 'commerce', name: 'Commerce platform', type: 'system' }, name: 'Commerce platform', level: 'L2 / Containers', boundary: 'Inside one software system · Applications, data stores, and a message broker',
      description: 'Applications and data stores inside the platform, plus its payment dependency.', prompt: 'Open Order API to inspect its components',
      nodes: [item('web', 'Storefront', 'Web application', 'Serves the shopping experience.', { type: 'container', shape: 'application', tech: 'Next.js / TypeScript' }),
        item('api', 'Order API', 'API application', 'Validates checkout and accepts orders.', { type: 'container', shape: 'application', childView: 'components', childLabel: 'components', owner: 'Checkout team', tech: 'Node.js / TypeScript' }),
        item('bus', 'Order events', 'Message broker', 'Buffers order events for fulfillment.', { type: 'container', shape: 'queue', tech: 'Kafka' }),
        item('db', 'Order database', 'Data store', 'Stores orders and their payment state.', { type: 'container', shape: 'database', tech: 'PostgreSQL' }),
        item('worker', 'Fulfillment worker', 'Worker application', 'Reserves inventory and coordinates payment.', { type: 'container', shape: 'application', tech: 'Node.js' }), payment],
      edges: [edge('request', 'web', 'api', 'Submits a checkout request', 'HTTPS / JSON'), edge('write', 'api', 'db', 'Persists the pending order', 'SQL / TLS'),
        edge('publish', 'api', 'bus', 'Publishes OrderPlaced', 'Kafka', true), edge('consume', 'bus', 'worker', 'Delivers OrderPlaced', 'Kafka', true),
        edge('charge', 'worker', 'payments', 'Authorizes the payment', 'HTTPS / JSON'), edge('update', 'worker', 'db', 'Records fulfillment and payment status', 'SQL / TLS')],
      flows: [{ id: 'checkout', name: 'Place an order', description: 'Request → persist → publish → consume → authorize → update. Publishing reliability is omitted from this small demo.', edges: ['request', 'write', 'publish', 'consume', 'charge', 'update'] }]
    },
    components: {
      id: 'components', abstraction: 'component', scope: { id: 'api', name: 'Order API', type: 'container', tech: 'Node.js / TypeScript' }, name: 'Order API', level: 'L3 / Components', boundary: 'Inside one container · Components are implementation responsibilities, not deployable services',
      description: 'Responsibilities inside one deployable application, with its data dependencies.', prompt: 'Select a component for its responsibility and technology',
      nodes: [item('controller', 'Checkout controller', 'HTTP adapter', 'Validates the request shape and calls checkout.', { type: 'component', tech: 'TypeScript / HTTP', childView: 'code-controller', childLabel: 'code' }),
        item('checkout', 'Checkout service', 'Application service', 'Checks the basket and creates a pending order.', { type: 'component', tech: 'TypeScript', owner: 'Checkout team', childView: 'code-checkout', childLabel: 'code' }),
        item('repository', 'Order repository', 'Data adapter', 'Maps orders to persistent database records.', { type: 'component', tech: 'TypeScript / SQL', childView: 'code-repository', childLabel: 'code' }),
        item('publisher', 'Event publisher', 'Messaging adapter', 'Publishes OrderPlaced after order creation.', { type: 'component', tech: 'TypeScript / Kafka client', childView: 'code-publisher', childLabel: 'code' }),
        item('db', 'Order database', 'Data store', 'Stores the order records.', { type: 'container', shape: 'database', external: true, tech: 'PostgreSQL' }),
        item('bus', 'Order events', 'Message broker', 'Carries OrderPlaced to fulfillment.', { type: 'container', shape: 'queue', external: true, tech: 'Kafka' })],
      edges: [edge('invoke', 'controller', 'checkout', 'Requests checkout', 'In-process call'), edge('save', 'checkout', 'repository', 'Saves the pending order', 'In-process call'),
        edge('sql', 'repository', 'db', 'Inserts the order record', 'SQL / TLS'), edge('emit', 'checkout', 'publisher', 'Requests OrderPlaced publication', 'In-process call'),
        edge('kafka', 'publisher', 'bus', 'Publishes OrderPlaced', 'Kafka', true)],
      flows: [{ id: 'create', name: 'Create an order', description: 'Adapters isolate HTTP, SQL, and messaging from the application service.', edges: ['invoke', 'save', 'sql', 'emit', 'kafka'] }]
    }
  };
  const code = (id, name, description, attributes, methods, extra = {}) => item(id, name, 'Illustrative TypeScript symbol', description, { type: 'class', tech: 'TypeScript', attributes, methods, ...extra });
  const contract = (id, name, description, methods, extra = {}) => code(id, name, description, [], methods, { type: 'interface', ...extra });
  const dependency = (id, from, to, label, relation = 'dependency') => ({ ...edge(id, from, to, label, 'TypeScript'), relation });
  const checkoutPort = contract('checkout-port', 'CheckoutPort', 'Defines the checkout operation exposed by the application component.', ['+ checkout(basket): OrderId']);
  const repositoryPort = contract('repository-port', 'OrderRepositoryPort', 'Defines order persistence operations.', ['+ save(order): Promise<void>']);
  function codeView(componentId, nodes, edges) {
    const component = views.components.nodes.find(node => node.id === componentId);
    const id = 'code-' + componentId;
    views[id] = { id, abstraction: 'code', name: component.name, level: 'L4 / Code / UML-style example',
      scope: { id: componentId, name: component.name, type: 'component', tech: component.tech },
      boundary: 'Inside one component · Classes, interfaces, selected attributes, and operations',
      description: '',
      prompt: 'Select a class or interface to inspect its details', nodes, edges };
  }
  codeView('controller', [
    code('checkout-controller', 'CheckoutController', 'Adapts HTTP requests to the checkout application port.', ['- checkout: CheckoutPort'], ['+ post(request): HttpResponse']),
    code('request-validator', 'RequestValidator', 'Parses and validates incoming request data.', [], ['+ parse(body): CheckoutRequest']),
    code('checkout-request', 'CheckoutRequest', 'Carries validated checkout input.', ['+ basketId: string', '+ customerId: string'], []),
    { ...checkoutPort, external: true }
  ], [dependency('validate-request', 'checkout-controller', 'request-validator', 'Validates request input'), dependency('parse-request', 'request-validator', 'checkout-request', 'Creates validated request'), dependency('delegate-checkout', 'checkout-controller', 'checkout-port', 'Delegates checkout')]);
  codeView('checkout', [
    code('checkout-service', 'CheckoutService', 'Coordinates basket validation and order persistence.', ['- orders: OrderRepositoryPort'], ['+ checkout(basket): OrderId']),
    code('basket-policy', 'BasketPolicy', 'Checks whether the basket can be ordered.', [], ['+ validate(basket): void']),
    code('order', 'Order', 'Represents an order waiting for fulfillment.', ['+ id: OrderId', '+ status: OrderStatus'], ['+ create(basket): Order']),
    checkoutPort, { ...repositoryPort, external: true }
  ], [dependency('check-basket', 'checkout-service', 'basket-policy', 'Validates the basket'), dependency('create-order', 'checkout-service', 'order', 'Creates a pending order'), dependency('implement-checkout', 'checkout-service', 'checkout-port', 'Implements checkout contract', 'realization'), dependency('save-order', 'checkout-service', 'repository-port', 'Persists the pending order')]);
  codeView('repository', [
    code('postgres-repository', 'PostgresOrderRepository', 'Persists orders through SQL statements.', ['- mapper: OrderMapper'], ['+ save(order): Promise<void>']),
    code('order-mapper', 'OrderMapper', 'Maps the domain order into a persistence record.', [], ['+ toRecord(order): OrderRecord']),
    code('order-record', 'OrderRecord', 'Contains the fields stored in the orders table.', ['+ id: string', '+ status: string'], []), repositoryPort
  ], [dependency('map-order', 'postgres-repository', 'order-mapper', 'Maps an order for storage'), dependency('create-record', 'order-mapper', 'order-record', 'Creates a database record'), dependency('implement-repository', 'postgres-repository', 'repository-port', 'Implements persistence contract', 'realization')]);
  codeView('publisher', [
    code('kafka-publisher', 'KafkaOrderPublisher', 'Serializes an order event and publishes it to Kafka.', ['- serializer: EventSerializer'], ['+ publish(event): Promise<void>']),
    code('event-serializer', 'EventSerializer', 'Encodes an event for transport.', [], ['+ encode(event): Uint8Array']),
    code('order-placed', 'OrderPlaced', 'Carries order identity and the time it was created.', ['+ orderId: OrderId', '+ occurredAt: Date'], []),
    contract('publisher-port', 'OrderEventPublisherPort', 'Defines publication of order events.', ['+ publish(event): Promise<void>'])
  ], [dependency('serialize-event', 'kafka-publisher', 'event-serializer', 'Serializes an order event'), dependency('encode-fields', 'event-serializer', 'order-placed', 'Reads event fields'), dependency('implement-publisher', 'kafka-publisher', 'publisher-port', 'Implements publication contract', 'realization')]);
  const roots = { demo: [{ id: 'context', name: 'Commerce' }], scale: [{ id: 'scale', name: 'Scale lab' }] };
  const paths = {
    context: roots.demo,
    containers: [...roots.demo, { id: 'containers', name: 'Commerce platform', via: 'commerce' }],
    components: [...roots.demo, { id: 'containers', name: 'Commerce platform', via: 'commerce' }, { id: 'components', name: 'Order API', via: 'api' }]
  };
  for (const component of views.components.nodes.filter(node => node.childView)) paths[component.childView] = [...paths.components, { id: component.childView, name: component.name, via: component.id }];
  const demoIndex = Object.values(views).flatMap(view => view.nodes.map(node => ({ id: node.id, name: node.name, viewId: view.id, trail: paths[view.id], location: view.level + ' / ' + view.name, text: (node.name + ' ' + node.type + ' ' + node.kind + ' ' + (node.tech || '') + ' ' + node.description).toLowerCase() })));
  const scaleIndex = [];
  const systemName = n => 'System ' + String(n + 1).padStart(3, '0');
  const serviceName = (system, service) => systemName(system) + ' / Service ' + String(service + 1).padStart(2, '0');
  for (let system = 0; system < 400; system++) {
    scaleIndex.push({ id: 'system-' + system, name: systemName(system), viewId: 'scale', trail: roots.scale, location: 'Landscape / 400 software systems', text: systemName(system).toLowerCase() });
    for (let service = 0; service < 25; service++) {
      const name = serviceName(system, service);
      scaleIndex.push({ id: 's' + system + '-' + service, name, viewId: 'scale-' + system,
        trail: [...roots.scale, { id: 'scale-' + system, name: systemName(system), via: 'system-' + system }], location: 'L2 / ' + systemName(system), text: name.toLowerCase() });
    }
  }
  function scaleView(id) {
    if (id === 'scale') return {
      id, abstraction: 'landscape', name: 'Scale lab', level: 'System landscape / Synthetic fixture', boundary: '400 software systems · 25 containers per system · Views generated on demand',
      description: '10,400 indexed elements. Search “System 400 / Service 25” to jump across the hierarchy.', prompt: 'A bounded view of a much larger model',
      nodes: Array.from({ length: 400 }, (_, index) => item('system-' + index, systemName(index), 'Software system', 'Synthetic system containing 25 application containers.', { type: 'system', childView: 'scale-' + index, childLabel: '25 containers' })),
      edges: Array.from({ length: 399 }, (_, index) => edge('landscape-' + index, 'system-' + index, 'system-' + (index + 1), 'Calls the next system', 'HTTPS / JSON'))
    };
    const system = Number(id.slice(6));
    if (!/^scale-\d+$/.test(id) || system < 0 || system >= 400) throw new Error('Unknown synthetic scope.');
    return { id, abstraction: 'container', scope: { id: 'system-' + system, name: systemName(system), type: 'system' }, name: systemName(system), level: 'L2 / Containers / Synthetic fixture', boundary: 'Container view · ' + systemName(system),
      description: '25 generated containers. Page limits apply to both diagram nodes and relationship controls.', prompt: 'Select a container or move between pages',
      nodes: Array.from({ length: 25 }, (_, service) => item('s' + system + '-' + service, 'Service ' + String(service + 1).padStart(2, '0'), 'Service application', 'Fixture container for navigation and rendering checks.', { type: 'container', shape: 'application', tech: 'Synthetic fixture' })),
      edges: Array.from({ length: 24 }, (_, index) => edge('call-' + index, 's' + system + '-' + index, 's' + system + '-' + (index + 1), 'Passes work to the next service', 'HTTPS / JSON')) };
  }
  const source = {
    root: sample => sample === 'scale' ? 'scale' : 'context',
    rootTrail: sample => roots[sample], count: sample => sample === 'scale' ? scaleIndex.length : demoIndex.length,
    getView(id, { signal } = {}) { if (signal && signal.aborted) throw new DOMException('Cancelled', 'AbortError'); return views[id] || scaleView(id); },
    search(query, sample, limit) { const words = query.toLowerCase().split(/\s+/).filter(Boolean); const results = []; for (const entry of sample === 'scale' ? scaleIndex : demoIndex) { if (words.every(word => entry.text.includes(word))) results.push(entry); if (results.length >= limit) break; } return results; }
  };
  global.C4DemoSource = source;
  if (typeof document !== 'undefined') global.c4Demo = global.C4Explorer.mount(document.getElementById('c4-explorer'), source);
})(typeof window === 'undefined' ? globalThis : window);

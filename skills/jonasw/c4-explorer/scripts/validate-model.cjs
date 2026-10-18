#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
require('../assets/explorer.js');
require('../assets/model.js');
try {
  if (Number(process.versions.node.split('.')[0]) < 18) throw new Error('Node.js 18 or newer is required.');
  const input = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : fs.readFileSync(0, 'utf8');
  const model = JSON.parse(input);
  const source = C4RepositoryModel.createSource(model);
  console.log(`Valid: ${model.views.length} views, ${source.count()} element appearances.`);
} catch (error) {
  console.error('Invalid C4 model: ' + error.message);
  process.exitCode = 1;
}

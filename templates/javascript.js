'use strict';

const language = { id: 'javascript', label: 'JavaScript', languageId: 'javascript', extension: 'js' };

function template(problem) {
  const title = problem && problem.title ? problem.title : 'VJudge Problem';
  const id = problem && problem.id ? problem.id : 'unknown';
  return `// VJudge ${id}: ${title}\nconst readline = require('readline');\n\nconst rl = readline.createInterface({ input: process.stdin });\n\nrl.on('line', (line) => {\n  const [a, b] = line.trim().split(/\\s+/).map(Number);\n  if (Number.isFinite(a) && Number.isFinite(b)) {\n    console.log(a + b);\n  }\n});\n`;
}

module.exports = { language, template };

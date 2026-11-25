'use strict';

const language = { id: 'typescript', label: 'TypeScript', languageId: 'typescript', extension: 'ts' };

function template(problem) {
  const title = problem && problem.title ? problem.title : 'VJudge Problem';
  const id = problem && problem.id ? problem.id : 'unknown';
  return `// VJudge ${id}: ${title}\nimport * as readline from 'readline';\n\nconst rl = readline.createInterface({ input: process.stdin });\n\nrl.on('line', (line: string): void => {\n  const parts = line.trim().split(/\\s+/).map(Number);\n  if (parts.length >= 2 && parts.every((value) => Number.isFinite(value))) {\n    console.log(parts[0] + parts[1]);\n  }\n});\n`;
}

module.exports = { language, template };

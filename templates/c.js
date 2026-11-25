'use strict';

const language = { id: 'c', label: 'C', languageId: 'c', extension: 'c' };

function template(problem) {
  const title = problem && problem.title ? problem.title : 'VJudge Problem';
  const id = problem && problem.id ? problem.id : 'unknown';
  return `/* VJudge ${id}: ${title} */\n#include <stdio.h>\n\nint main(void) {\n    long long a, b;\n    while (scanf(\"%lld %lld\", &a, &b) == 2) {\n        printf(\"%lld\\n\", a + b);\n    }\n    return 0;\n}\n`;
}

module.exports = { language, template };

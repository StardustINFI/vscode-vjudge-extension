'use strict';

const language = { id: 'cpp', label: 'C++', languageId: 'cpp', extension: 'cpp' };

function template(problem) {
  const title = problem && problem.title ? problem.title : 'VJudge Problem';
  const id = problem && problem.id ? problem.id : 'unknown';
  return `// VJudge ${id}: ${title}\n#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    long long a, b;\n    while (cin >> a >> b) {\n        cout << a + b << '\\n';\n    }\n    return 0;\n}\n`;
}

module.exports = { language, template };

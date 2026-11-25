'use strict';

const language = { id: 'go', label: 'Go', languageId: 'go', extension: 'go' };

function template(problem) {
  const title = problem && problem.title ? problem.title : 'VJudge Problem';
  const id = problem && problem.id ? problem.id : 'unknown';
  return `// VJudge ${id}: ${title}\npackage main\n\nimport (\n    \"bufio\"\n    \"fmt\"\n    \"os\"\n)\n\nfunc main() {\n    scanner := bufio.NewScanner(os.Stdin)\n    scanner.Buffer(make([]byte, 1024*1024), 1024*1024)\n    for scanner.Scan() {\n        var a, b int\n        if _, err := fmt.Sscan(scanner.Text(), &a, &b); err == nil {\n            fmt.Println(a + b)\n        }\n    }\n}\n`;
}

module.exports = { language, template };

'use strict';

const language = { id: 'java', label: 'Java', languageId: 'java', extension: 'java' };

function template(problem) {
  const title = problem && problem.title ? problem.title : 'VJudge Problem';
  const id = problem && problem.id ? problem.id : 'unknown';
  return `// VJudge ${id}: ${title}\nimport java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner scanner = new Scanner(System.in);\n        while (scanner.hasNextLong()) {\n            long a = scanner.nextLong();\n            long b = scanner.nextLong();\n            System.out.println(a + b);\n        }\n        scanner.close();\n    }\n}\n`;
}

module.exports = { language, template };

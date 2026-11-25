'use strict';

const language = { id: 'python', label: 'Python', languageId: 'python', extension: 'py' };

function template(problem) {
  const title = problem && problem.title ? problem.title : 'VJudge Problem';
  const id = problem && problem.id ? problem.id : 'unknown';
  return `# VJudge ${id}: ${title}\nimport sys\n\n\ndef main() -> None:\n    for line in sys.stdin:\n        parts = line.split()\n        if len(parts) >= 2:\n            print(int(parts[0]) + int(parts[1]))\n\n\nif __name__ == "__main__":\n    main()\n`;
}

module.exports = { language, template };

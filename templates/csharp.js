'use strict';

const language = { id: 'csharp', label: 'C#', languageId: 'csharp', extension: 'cs' };

function template(problem) {
  const title = problem && problem.title ? problem.title : 'VJudge Problem';
  const id = problem && problem.id ? problem.id : 'unknown';
  return `// VJudge ${id}: ${title}\nusing System;\nusing System.IO;\n\nclass Program\n{\n    static void Main()\n    {\n        using var reader = new StreamReader(Console.OpenStandardInput());\n        string? line;\n        while ((line = reader.ReadLine()) is not null)\n        {\n            var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);\n            if (parts.Length >= 2 && long.TryParse(parts[0], out var a) && long.TryParse(parts[1], out var b))\n            {\n                Console.WriteLine(a + b);\n            }\n        }\n    }\n}\n`;
}

module.exports = { language, template };

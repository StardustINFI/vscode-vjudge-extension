'use strict';

const language = { id: 'rust', label: 'Rust', languageId: 'rust', extension: 'rs' };

function template(problem) {
  const title = problem && problem.title ? problem.title : 'VJudge Problem';
  const id = problem && problem.id ? problem.id : 'unknown';
  return `// VJudge ${id}: ${title}\nuse std::io::{self, BufRead};\n\nfn main() {\n    let stdin = io::stdin();\n    for line in stdin.lock().lines() {\n        let line = line.expect(\"failed to read line\");\n        let values: Vec<i64> = line\n            .split_whitespace()\n            .filter_map(|value| value.parse::<i64>().ok())\n            .collect();\n        if values.len() >= 2 {\n            println!(\"{}\", values[0] + values[1]);\n        }\n    }\n}\n`;
}

module.exports = { language, template };

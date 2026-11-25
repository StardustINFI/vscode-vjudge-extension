'use strict';

const language = { id: 'ruby', label: 'Ruby', languageId: 'ruby', extension: 'rb' };

function template(problem) {
  const title = problem && problem.title ? problem.title : 'VJudge Problem';
  const id = problem && problem.id ? problem.id : 'unknown';
  return `# VJudge ${id}: ${title}\nARGF.each_line do |line|\n  values = line.split.map(&:to_i)\n  puts values[0] + values[1] if values.length >= 2\nend\n`;
}

module.exports = { language, template };

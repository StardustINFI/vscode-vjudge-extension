'use strict';

const modules = [
  require('./cpp'),
  require('./c'),
  require('./java'),
  require('./python'),
  require('./javascript'),
  require('./typescript'),
  require('./go'),
  require('./rust'),
  require('./ruby'),
  require('./csharp')
];

const LANGUAGES = modules.map((module) => module.language);
const languageMap = new Map(LANGUAGES.map((language) => [language.id.toLowerCase(), language]));
const moduleMap = new Map(modules.map((module) => [module.language.id.toLowerCase(), module]));
const documentMap = new Map(LANGUAGES.map((language) => [language.languageId.toLowerCase(), language]));

function getLanguage(id) {
  return languageMap.get(String(id || '').toLowerCase()) || LANGUAGES[0];
}

function getTemplate(id, problem) {
  const language = getLanguage(id);
  const code = moduleMap.get(language.id).template(problem);
  // 移除模板首行的题号注释（//、# 或 /* */ 形式），提交代码里不需要它
  return code.replace(/^[ \t]*(?:\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)[ \t]*\r?\n/, '');
}

function languageForDocument(documentLanguageId) {
  const key = String(documentLanguageId || '').toLowerCase();
  return documentMap.get(key) || languageMap.get(key) || LANGUAGES[0];
}

module.exports = { LANGUAGES, getLanguage, getTemplate, languageForDocument };

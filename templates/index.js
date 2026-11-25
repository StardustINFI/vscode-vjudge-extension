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
  return moduleMap.get(language.id).template(problem);
}

function languageForDocument(documentLanguageId) {
  const key = String(documentLanguageId || '').toLowerCase();
  return documentMap.get(key) || languageMap.get(key) || LANGUAGES[0];
}

module.exports = { LANGUAGES, getLanguage, getTemplate, languageForDocument };

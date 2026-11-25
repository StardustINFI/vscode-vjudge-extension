'use strict';

const vscode = require('vscode');

const SECRETS = Object.freeze({
  username: 'vjudge.username',
  password: 'vjudge.password',
  cookies: 'vjudge.cookies',
  currentUser: 'vjudge.currentUser'
});

class Store {
  constructor(context) {
    this.context = context;
  }

  isMockMode() {
    if (process.env.VJUDGE_MOCK !== undefined) {
      return /^(1|true|yes|on)$/i.test(process.env.VJUDGE_MOCK.trim());
    }
    return vscode.workspace.getConfiguration('vjudge').get('mockMode', false) === true;
  }

  async setMockMode(enabled) {
    await vscode.workspace.getConfiguration('vjudge').update(
      'mockMode',
      Boolean(enabled),
      vscode.ConfigurationTarget.Global
    );
  }

  async saveCredentials(username, password) {
    await Promise.all([
      this.context.secrets.store(SECRETS.username, username),
      this.context.secrets.store(SECRETS.password, password)
    ]);
  }

  async getCredentials() {
    const [username, password] = await Promise.all([
      this.context.secrets.get(SECRETS.username),
      this.context.secrets.get(SECRETS.password)
    ]);
    return { username, password };
  }

  async saveCookies(cookies) {
    await this.context.secrets.store(SECRETS.cookies, JSON.stringify(cookies || {}));
  }

  async getCookies() {
    const raw = await this.context.secrets.get(SECRETS.cookies);
    if (!raw) {
      return {};
    }
    try {
      const cookies = JSON.parse(raw);
      return cookies && typeof cookies === 'object' && !Array.isArray(cookies) ? cookies : {};
    } catch {
      await this.context.secrets.delete(SECRETS.cookies);
      return {};
    }
  }

  async setCurrentUser(user) {
    await this.context.secrets.store(SECRETS.currentUser, JSON.stringify(user));
  }

  async getCurrentUser() {
    const raw = await this.context.secrets.get(SECRETS.currentUser);
    if (!raw) {
      return undefined;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  async clearSession() {
    await Promise.all([
      this.context.secrets.delete(SECRETS.cookies),
      this.context.secrets.delete(SECRETS.currentUser)
    ]);
  }

  async clearCredentials() {
    await Promise.all([
      this.context.secrets.delete(SECRETS.username),
      this.context.secrets.delete(SECRETS.password),
      this.context.secrets.delete(SECRETS.cookies),
      this.context.secrets.delete(SECRETS.currentUser)
    ]);
  }

  get(key, defaultValue) {
    return this.context.globalState.get(`vjudge.${key}`, defaultValue);
  }

  async set(key, value) {
    await this.context.globalState.update(`vjudge.${key}`, value);
  }

  draftKey(problemId) {
    return `vjudge.draft.${encodeURIComponent(String(problemId))}`;
  }

  async saveDraft(problemId, language, code) {
    const draft = { problemId: String(problemId), language, code, updatedAt: Date.now() };
    await this.context.workspaceState.update(this.draftKey(problemId), draft);
    return draft;
  }

  getDraft(problemId) {
    return this.context.workspaceState.get(this.draftKey(problemId));
  }

  listDrafts() {
    return this.context.workspaceState.keys()
      .filter((key) => key.startsWith('vjudge.draft.'))
      .map((key) => this.context.workspaceState.get(key))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteDraft(problemId) {
    await this.context.workspaceState.update(this.draftKey(problemId), undefined);
  }

  async setLastSubmission(problemId, submission) {
    const key = `lastSubmission.${String(problemId)}`;
    const all = this.get('lastSubmissions', {});
    all[key] = submission;
    await this.set('lastSubmissions', all);
  }

  getLastSubmission(problemId) {
    return this.get('lastSubmissions', {})[`lastSubmission.${String(problemId)}`];
  }
}

module.exports = { Store, SECRETS };

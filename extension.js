'use strict';

const vscode = require('vscode');
const { Store } = require('./lib/store');
const { RealClient } = require('./lib/client');
const { MockClient } = require('./mock/data');
const { CommandManager } = require('./lib/commands');
const { GroupTree } = require('./views/groupTree');
const { ContestTree } = require('./views/contestTree');
const { ContestProblemTree } = require('./views/contestProblemTree');
const { FavoriteTree } = require('./views/favoriteTree');
const { SubmitTree } = require('./views/submitTree');
const { UserTree } = require('./views/userTree');

function activate(context) {
  const outputChannel = vscode.window.createOutputChannel('VJudge');
  const store = new Store(context);
  const realClient = new RealClient({ store, outputChannel });
  const mockClient = new MockClient({ store, outputChannel });
  const getClient = () => store.isMockMode() ? mockClient : realClient;
  const eventBus = new vscode.EventEmitter();

  const group = new GroupTree(getClient, eventBus);
  const contest = new ContestTree(getClient, group, eventBus);
  const contestProblems = new ContestProblemTree(getClient, eventBus);
  const favorite = new FavoriteTree(getClient);
  const submit = new SubmitTree(getClient, eventBus);
  const user = new UserTree(getClient);
  const views = {
    group, contest, contestProblems, favorite, submit, user,
    list: [group, contest, contestProblems, favorite, submit, user]
  };

  const treeViews = [
    vscode.window.createTreeView('vjudge.groups', { treeDataProvider: group }),
    vscode.window.createTreeView('vjudge.contests', { treeDataProvider: contest }),
    vscode.window.createTreeView('vjudge.contestProblems', { treeDataProvider: contestProblems }),
    vscode.window.createTreeView('vjudge.favorites', { treeDataProvider: favorite }),
    vscode.window.createTreeView('vjudge.submissions', { treeDataProvider: submit }),
    vscode.window.createTreeView('vjudge.user', { treeDataProvider: user })
  ];

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'vjudge.toggleMockMode';
  const commandManager = new CommandManager({
    context, getClient, store, views, eventBus, statusBar, outputChannel
  });
  commandManager.register();
  commandManager.updateStatus();
  // 启动时确认一次服务端登录态，让状态栏和六个视图使用同一份结果
  Promise.resolve()
    .then(() => (getClient().ensureSession ? getClient().ensureSession() : undefined))
    .catch(() => undefined)
    .then(() => commandManager.updateStatus());

  context.subscriptions.push(...treeViews, ...views.list, eventBus, statusBar, commandManager, outputChannel);
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (event) => {
    if (event.affectsConfiguration('vjudge.mockMode')) await commandManager.refreshAll();
  }));
}

function deactivate() {}

module.exports = { activate, deactivate };

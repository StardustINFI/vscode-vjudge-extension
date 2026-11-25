'use strict';

// 视图层共用的登录态门控：真实客户端未登录时不加载列表数据，避免展示一堆
// 公开数据或空列表冒充"我的数据"；Mock 客户端不受门控影响。
async function loginRequired(client, requiresAuth) {
  if (!client || typeof client.requiresLogin !== 'function' || !client.requiresLogin()) {
    return false;
  }
  const session = typeof client.ensureSession === 'function'
    ? await client.ensureSession()
    : { loggedIn: client.isLoggedIn ? client.isLoggedIn() : true };
  if (session && session.loggedIn) return false;
  if (requiresAuth) return true;
  return !(typeof client.allowsAnonymousBrowsing === 'function' && client.allowsAnonymousBrowsing());
}

// 统一的未登录提示节点，点击后进入登录流程
function loginNode() {
  return {
    type: 'status',
    label: '未登录，点击登录 VJudge',
    icon: 'account',
    command: { command: 'vjudge.login', title: '登录 VJudge' }
  };
}

module.exports = { loginRequired, loginNode };

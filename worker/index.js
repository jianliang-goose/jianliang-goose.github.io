// 靜態網站的進入點：所有請求都交給 dist/ 的靜態檔案處理
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};

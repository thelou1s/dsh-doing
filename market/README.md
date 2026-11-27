# 发布到 DSH 市场的两种方式

本目录的内容用于把 dsh-doing 发布出去。

## 方式 A：社区市场（awesome-dsh-plugin → dsh-market / Discover）

1. 仓库必须是**公开**的（CI 会匿名抓 `package.json` 校验 `dsh.bundle`）。
2. 加 topic：`dsh-plugin`。
3. 仓库创建满 1 天才可提交。
4. 到 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin 提 PR，新增一个文件：

   `data/plugins/thelou1s__dsh-doing.yml`

   ```yaml
   url: https://github.com/thelou1s/dsh-doing
   name: thelou1s/dsh-doing
   category: notify
   description:
     en: Plays a looping beep while the agent works and a two-beep alert while it waits for you to confirm.
     zh: Agent 干活时循环播放提示音，等待你确认时循环播放两声提醒。
   icon: https://raw.githubusercontent.com/thelou1s/dsh-doing/main/assets/icon-180.png
   ```

5. 合并后约一天内进入 dsh-market 与 format-1 索引。

## 方式 B：自建索引（仓库可以保持私有）

`index.json` 是本仓库的 format-1 索引草稿，已用官方校验器 `parseMarketIndex` 验证通过。
把它放到**公开可读**的 HTTPS 地址（不能有跳转），然后在
DSH 的 **插件 → 发现 → 索引来源** 里添加该 URL。

每次发版都要更新 `versions[]`：新版本号 + `publishTimestamp`（Unix 秒）+ 新的 `commit`（40 位小写 SHA）。

注意：索引本身必须匿名可读；如果 `source.type = git` 指向私有仓库，安装时会因为没有凭据而失败。

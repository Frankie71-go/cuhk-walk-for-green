# Walk for Green · 学长姐捷径投稿 — 云端后端

让 CUHK 同学打开**同一张 HTML 链接**就能共享投稿与点赞，零注册、零装 app。
> 为什么不用飞书？CUHK 同学大多用 WhatsApp / 微信 / Telegram，不一定装飞书，用飞书做入口反而设门槛。
> 这里用「公开链接 + 云端后端」，同学打开链接即用。

---

## 前端怎么接

HTML 里已内置「云端共享」开关：

1. 打开 `walk-for-green.html`（或个人版 / 通用模板）
2. 滚到「🧑‍🏫 学长姐捷径投稿」卡片
3. 打开「云端共享」开关 → 填入下面的**后端地址** → 点保存
4. 之后所有投稿 / 点赞 / 删除都走云端，同学打开同一链接即共享

后端地址填部署后拿到的 URL（CloudBase 云函数 URL / API 网关地址，不含 `/tips`）。

---

## 部署到 CloudBase（腾讯云开发）

### 1. 准备
- 一个 CloudBase 环境（你 AI Navigator 同账号即可）
- 在该环境新建一个**云数据库集合** `wfg_tips`（权限设为「所有用户可读写」或仅函数内读写均可，因为前端走云函数，建议集合权限「仅创建者可读写」即可，读写都经函数）

### 2. 上传函数
- 在 CloudBase 控制台新建**云函数** `wfgTips`，运行环境 Node 16+
- 把本目录 `index.js` + `package.json` 上传（或连 CLI 部署）
- 安装依赖：`npm install`（依赖 `@cloudbase/node-sdk`）

### 3. 配置环境 ID
复制 `cloudbaserc.example.json` 为 `cloudbaserc.json`，把 `envId` 与 `domain` 换成你自己的。

> 🔒 **隐私警告**：`cloudbaserc.json` 含你的 CloudBase 环境 ID，**不要提交到公开仓库**（本仓库 `.gitignore` 已排除）。
> 环境变量 `TCB_ENV` 也可指定环境 ID；不填则默认用 `cloud.SYMBOL_CURRENT_ENV`（函数自身所在环境）。

### 4. 用 tcb CLI 部署（已实测跑通）

```bash
TBC=/Users/frankie/.workbuddy/binaries/node/cli-connector-packages/bin/tcb

# ① 先不带 --httpFn 部署，把 handler 设上（Execution method = index.main）
printf 'y\n' | $TBC fn deploy wfg-tips --force --runtime Nodejs20.19 --install-dependency true --dir .

# ② 再带 --httpFn 部署，补上 HTTP 路由
printf 'y\n' | $TBC fn deploy wfg-tips --httpFn --path / --force --runtime Nodejs20.19 --install-dependency true --dir .

# ③ 开启路径透传（漏了这步 /tips 会报 INVALID_PATH）
printf 'y\n' | $TBC routes edit --data '{"domain":"*","routes":[{"path":"/","enablePathTransmission":true}]}'
```

验证：`$TBC fn detail wfg-tips`（Execution method 必须是 `index.main`）、`$TBC routes list`（Path passthrough = Enable）。
拿到形如 `https://<envId>.service.tcloudbase.com` 的地址。

**三个必踩的坑：**
1. 直接带 `--httpFn` 部署会让函数变成「Execution method 空」的残缺态，SCF 报 `FunctionType invalid` → 必须先跑 ①。
2. CLI 无 TTY 时会卡在 `Continue deployment with the default configuration? (y/N)` → 用 `printf 'y\n' |` 喂（别用 `yes |`，会刷屏死循环）。
3. `routes add` 在 `*.service.tcloudbase.com` 被禁，`routes edit` 写完整域名报「domain does not exist」→ **只能用 `domain: "*"`**。

另外：所有 tcb 命令需绕过沙箱网络（否则连接器网关域名解析失败）。

### 5. 暴露为 HTTP 接口（控制台路线，与 CLI 二选一）
- 给函数开启 **HTTP 触发 / API 网关**，得到形如
  `https://xxx.apigw.tcloudbase.com/release/wfgTips` 的地址
- 在网关处开启 **CORS**（允许 `*`），否则浏览器（尤其从 file:// 或别的域名打开 HTML）会被跨域拦截

### 6. 填入前端
把上一步地址填进 HTML 的「后端地址」保存即可。

> 推荐：把 `walk-for-green.html` 也发布到 CloudBase **静态托管**，与云函数同域，可彻底免 CORS 配置。

---

## 接口契约（前端依赖这些路径）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/tips` | 返回投稿数组 `[{id,name,text,route,up,down,ts}]` |
| POST | `/tips` | body `{name,text,route}`，返回新建的 tip |
| POST | `/tips/:id/vote` | body `{dir:"up"|"down"}`，返回更新后的 tip |
| DELETE | `/tips/:id` | 删除某条 |

`route` 是路线分类（如 `A` 崇基线、`C` 联合线），前端按它筛选；不传则为 `other`。
自定义 `id` 由后端生成；**注意云端文档用系统 `_id` 定位，所以 update/remove 必须走 `where({id})`**，
用 `doc(自定义id)` 会静默失败（不报错但不生效）。

所有响应带 `Access-Control-Allow-Origin: *`。

---

## 本地测试（无需任何账号）

```bash
cd tips-backend
npm install        # 如需联网安装 @cloudbase/node-sdk；不装也行，会自动退回内存
node index.js      # 启动内存版服务 :3000
```

然后用 curl 试：
```bash
curl -X POST localhost:3000/tips -H 'Content-Type: application/json' -d '{"name":"阿欣","text":"联合去崇基搭 SL4 最快"}'
curl localhost:3000/tips
curl -X POST localhost:3000/tips/<上一步返回的id>/vote -H 'Content-Type: application/json' -d '{"dir":"up"}'
```

> 注意：本地内存版重启即清空，仅用于验证接口；真共享请用 CloudBase 部署。

---

## 安全与隐私提示
- 投稿是**公开内容**（别人看得到才叫共享），不存任何证件 / 课表等敏感数据。
- 该后端**任何人拿到 URL 都能写**，属于「轻量公开墙」设计。若担心被刷，可在网关加简单防刷（速率限制 / 验证码），或加一个只有你能改的写密钥——需要的话再加。

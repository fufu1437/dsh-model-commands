# 模型命令（@fufu1437/dsh-model-commands）

一个 DeepSeek Harness（DSH）插件：把**你声明一次的命令**变成**模型可以直接调用的工具**。

你在「设置 → 模型命令」里填写命令（名称、说明、参数、命令行），Host 半部就为每条命令注册一个模型可见的工具。模型调用它就像调用 `bash`、`read`、`edit` 一样——不需要先写一段 shell，而且每个参数都有类型和说明，直接出现在模型看到的工具 schema 里。

> English: [README.md](README.md)

## 模型看到的样子

声明这样一条命令：

```json
{
  "name": "disk_usage",
  "description": "Report free space for one path with df.",
  "command": "df -h {{path}}",
  "args": [
    { "name": "path", "type": "string", "default": "/", "description": "Filesystem or directory to report." }
  ]
}
```

就会发布一个名为 `disk_usage` 的工具，带一个可选字符串参数 `path`。模型调用它时执行 `df -h '/'`，读到的结果形如：

```text
$ df -h '/'
exit code: 0

--- stdout ---
Filesystem      Size  Used Avail Use% Mounted on
/dev/nvme0n1p2  931G  412G  472G  47% /

--- stderr ---
(empty)
```

## 命令字段

| 字段 | 必填 | 含义 |
|---|---|---|
| `name` | 是 | 模型调用的工具名：字母开头，可含字母、数字、`_`、`-`（≤48）。不能与已有工具重名。 |
| `description` | 是 | 模型在多个工具之间做选择时**唯一**会读的内容。写清「什么时候用它」。 |
| `command` | 是 | 要执行的 shell 行，用 `{{参数名}}` 占位。 |
| `args` | 否 | 参数声明，见下。 |
| `title` | 否 | 设置页列表里显示的人类可读名字。 |
| `cwd` | 否 | 工作目录。相对路径基于发起会话的工作区；绝对路径仍受沙箱策略约束。 |
| `timeoutMs` | 否 | 单条命令超时（默认 60 秒，上限 1 小时）。 |
| `enabled` | 否 | `false` 时命令保留在表里，但模型看不到它。 |

参数声明：

| 字段 | 含义 |
|---|---|
| `name` | 对应命令行里的 `{{name}}`；必须声明且必须被用到。 |
| `type` | `string`（默认）、`number`、`integer`、`boolean`。 |
| `description` | 写进该参数的 schema，供模型参考。 |
| `required` | `true` 时模型必须提供；否则缺省时用 `default`。 |
| `default` | 模型省略该参数时使用的值。 |
| `choices` | `string` 专用：可选值集合，既作为 JSON-Schema `enum` 暴露，也在执行前校验。 |
| `trueText` / `falseText` | `boolean` 专用：替代真/假值写入命令行的字面文本（例如 `--verbose` 或什么都不写）。 |

### 参数如何替换

替换是单趟、按类型进行的，这正是「模型给的字符串不会变成 shell 语法」的原因：

- `string` → 用单引号包裹（内部的 `'` 变成 `'\''`），因此永远只占一个词；值里即使含 `{{other}}` 也只是数据，不会被二次展开；
- `number` / `integer` → 必须先解析为数字，不加引号；
- `boolean` → 只替换作者声明的 `trueText`/`falseText`；
- 带 `choices` 的字符串会先校验取值。

占位符与参数声明不匹配的命令会被 Host 拒绝，设置页会显示 Host 给出的具体原因。

## 设置页

「设置 → 模型命令」列出已保存的命令：每行显示工具名、说明和命令行。`编辑` 打开同样的字段，`删除` 移除命令（及其工具）。保存时整张表发回 Host，Host 校验、落盘、并在同一步重新注册工具，因此模型下一次调用就能看到新命令。

命令表保存在 `<DSH_HOME>/model-commands/commands.json`，页面会显示实际路径。写入是原子的（先写临时文件再 rename）；某一行不合法只会被单独报出，不会丢掉其他命令。

## 配置

不写任何 `config` 也能用。要改默认值，在 profile 的 patch 里覆盖这一行：

```yaml
- id: fufu-model-commands
  name: '@fufu1437/dsh-model-commands'
  config:
    storePath: /home/me/.dsh/model-commands/commands.json
    defaultCwd: /home/me/work
    timeoutMs: 120000
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `storePath` | `<DSH_HOME>/model-commands/commands.json` | 命令表位置。 |
| `defaultCwd` | 发起会话的工作区 | 未声明 `cwd` 的命令的兜底目录。 |
| `timeoutMs` | `60000` | 默认超时，上限 1 小时。 |

配置在插件激活时读取，因此改这一行需要重启 Harness（本 profile 不监听插件模块根）。

## 安装

```bash
dsh plugin install /绝对路径/到/dsh-model-commands
```

或在 Harness 内用 `install_bundle`，以包目录、`.tgz` 或 npm 包名为 target。首次安装后**刷新一次 Web 页面**以加载浏览器半部。

### 迭代开发

包是 link 进来的，可以直接改。`pnpm run check && pnpm test` 不需要 Harness 就能验证纯逻辑。运行中的进程会缓存已导入的 Host 模块，所以改完 `index.js` 要让这一行重新加载：本 profile 下修改 profile patch 是**即时生效**的，因此把 `<profile>/cordis.patch.yml` 里这一行的 `disabled` 翻转一次（`true` 再 `false`）即可热重载两个半部，无需重启 Harness。之后刷新页面以加载新的浏览器半部；命令表本身不会丢，它存在自己的 JSON 文件里。


## 行为与边界

- 命令通过组合出来的 `ctx.shell` 执行器运行，因此继承部署所用的 shell（本地或沙箱）以及发起会话的沙箱策略；沙箱拒绝会写进结果，而不是被丢掉。
- 退出码是结果。非零退出同样返回 stdout/stderr，由模型自行判断。
- 输出上限与溢写文件由执行器决定；某个流被截断时，结果里会给出溢写文件路径。
- 取消工具调用会杀掉进程（`onExpiry: 'kill'`、调用方 abort）。
- 只使用 `node:` 内置模块，**不依赖任何 `@deepseek-ai/*` 私有包**，因此可以作为普通 npm 包发布，也不随 Harness 内部改动而失效。
- 两个路由都先经过组合的 `connection.requestRejection` 信任围栏，未认证请求得到 401/403。

## 还没做（后续迭代）

- 设置页里的 `choices`、`trueText`/`falseText` 编辑控件（Host 已经支持这些字段）。
- 编辑器里的「试运行」按钮，让命令在模型调用之前先跑一次。
- 排序、导入/导出，以及按 agent 划分可见性。

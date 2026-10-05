# 模型命令（@fufu1437/dsh-model-commands）

一个 DeepSeek Harness（DSH）插件：**把命令登记一次，模型就能随时查到它。**

你在「设置 → 模型命令」里为一条命令写下**说明**和**描述**，Host 半部就为它注册一个模型可见的工具。模型平时在工具列表里只看得到一行说明（不占上下文）；需要用到那条命令时调用工具，就能拿到它的**帮助、参数用法和实际用途**，然后用自己已有的 `bash` 去执行。

> English: [README.md](README.md)

## 模型看到的样子

登记这样一条命令：

```json
{
  "name": "kubectl_logs",
  "description": "需要查看 Kubernetes Pod 的日志时调用。",
  "detail": "kubectl logs <pod> [-f] [--since=1h]\n\n· <pod>：Pod 名，必填；先用 kubectl get pods 查\n· -f：持续输出，Ctrl-C 结束\n· --since：只看最近一段时间，如 1h / 30m\n注意：默认取当前 namespace，跨 namespace 要加 -n。",
  "args": []
}
```

模型侧平时看到的是：

```
kubectl_logs — 需要查看 Kubernetes Pod 的日志时调用。
```

调用后拿到：

```text
kubectl logs <pod> [-f] [--since=1h]

· <pod>：Pod 名，必填；先用 kubectl get pods 查
· -f：持续输出，Ctrl-C 结束
· --since：只看最近一段时间，如 1h / 30m
注意：默认取当前 namespace，跨 namespace 要加 -n。
```

然后模型自己用 `bash` 把命令敲出去。**这个插件不执行任何东西**——它只把命令的用法和用途交到模型手上。

## 命令字段

| 字段 | 必填 | 含义 |
|---|---|---|
| `name` | 是 | 模型调用的工具名：字母开头，可含字母、数字、`_`、`-`（≤48）。不能与已有工具重名。 |
| `description`（说明） | 是 | 工具列表里的一行，也是模型在多个工具之间做选择时**唯一**会读的内容。写清「什么时候用它」。≤4096 字符。 |
| `detail`（描述） | 与参数至少一个 | 模型调用该工具时读到的正文：命令的帮助、参数/选项怎么用、实际用途。可用 `{{参数名}}` 占位。≤32768 字符。留空时工具返回「说明」。 |
| `args`（参数） | 与描述至少一个 | 参数声明，见下。 |
| `title` | 否 | 设置页列表里显示的人类可读名字。 |
| `enabled` | 否 | `false` 时命令保留在表里，但模型看不到它。 |

**描述和参数至少填一个**：只有说明、既没有描述也没有参数的命令没有东西可回答，会被 Host 拒绝。两者同时存在也完全可以——描述里用 `{{参数名}}` 引用参数即可。

参数声明：

| 字段 | 含义 |
|---|---|
| `name` | 对应描述里的 `{{name}}`；声明了就必须在描述里用到。 |
| `type` | `string`（默认）、`number`、`boolean`。`number` 已覆盖整数，没有单独的 `integer`。 |
| `description` | 写进该参数的 schema，供模型参考。 |
| `required`（必须） | `true` 时模型必须提供；否则缺省时用 `default`。 |
| `default` | 模型省略该参数时使用的值。 |
| `choices` | `string` 专用：可选值集合，既作为 JSON-Schema `enum` 暴露，也在代入前校验。 |
| `trueText` / `falseText` | `boolean` 专用：替代真/假值写入正文的字面文本。 |

## `{{参数}}` 如何替换

描述是**纯文本**，不是命令行，所以不存在 shell 转义问题；替换是单趟、按类型进行的：

- `string` → 原样代入；
- `number` → 必须先解析为有限数字；
- `boolean` → 只代入作者声明的 `trueText`/`falseText`；
- 带 `choices` 的字符串先校验取值；
- 替换只做一趟：值里含 `{{其它}}` 也只是文本，不会二次展开。

描述里出现未声明的占位符、或声明了参数却没在描述里用到，都会被 Host 拒绝，设置页会显示具体原因。这条规则是为了抓住占位符拼写错误：CLI help 里常见的单花括号（如 `{md5,sha1,sha256,sha512}`）不受影响，只有成对的 `{{名字}}` 才会被当作占位符。

**可以直接把 `--help` 的输出整段粘进「描述」**（上限 32768 字符，约一万多字符的 help 完全放得下）。代价只在模型真正调用这条命令时付一次，不常驻上下文。

## 设置页

「设置 → 模型命令」列出已保存的命令：每行显示工具名、说明、描述首行和参数个数。`编辑` 打开同样的字段，`删除` 移除命令（及其工具）。保存时整张表发回 Host，Host 校验、落盘、并在同一步重新注册工具，因此模型下一次调用就能看到新命令。

命令表保存在 `<DSH_HOME>/model-commands/commands.json`，页面会显示实际路径。写入是原子的（先写临时文件再 rename）；某一行不合法只会被单独报出，不会丢掉其他命令。

> 0.2.0 之前该字段叫 `command`（一段会被执行的命令行）；升级后旧内容会被当作 `detail` 读入，不会丢字。

## 配置

不写任何 `config` 也能用。要换命令表位置：

```yaml
- id: fufu-model-commands
  name: '@fufu1437/dsh-model-commands'
  config:
    storePath: /home/me/.dsh/model-commands/commands.json
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `storePath` | `<DSH_HOME>/model-commands/commands.json` | 命令表位置。 |

配置在插件激活时读取，因此改这一行需要重载插件行（见下）。

## 安装

```bash
npm install @fufu1437/dsh-model-commands
dsh plugin install @fufu1437/dsh-model-commands
```

或在 Harness 内用 `install_bundle`，以包目录、`.tgz` 或 npm 包名为 target。首次安装后**刷新一次 Web 页面**以加载浏览器半部。

### 迭代开发

包可以 link 进来直接改。`npm run check && npm test` 不需要 Harness 就能验证纯逻辑。运行中的进程会缓存已导入的 Host 模块，所以改完 `index.js` 要让这一行重新加载：本 profile 下修改 profile patch 是**即时生效**的，因此把 `<profile>/cordis.patch.yml` 里这一行的 `disabled` 翻转一次（`true` 再 `false`）即可热重载两个半部，无需重启 Harness。之后刷新页面以加载新的浏览器半部；命令表本身不会丢，它存在自己的 JSON 文件里。

## 行为与边界

- **插件不执行任何命令**：没有 shell 注入、没有沙箱策略、没有引号转义、没有退出码。执行由模型用部署里已有的工具完成。
- 工具描述（说明）是模型常驻可见的成本，所以它必须短；描述只在调用时付一次费。
- 只使用 `node:` 内置模块，**不依赖任何 `@deepseek-ai/*` 私有包**，因此可以作为普通 npm 包发布，也不随 Harness 内部改动而失效。
- 两个路由都先经过组合的 `connection.requestRejection` 信任围栏，未认证请求得到 401/403。
- 停用（`enabled: false`）只影响模型可见性，不影响表里的内容。

## 还没做（后续迭代）

- 设置页里的 `choices`、`trueText`/`falseText` 编辑控件（Host 已经支持这些字段）。
- 编辑器的「预览」按钮，让人先看看模型会拿到什么。
- 排序、导入/导出，以及按 agent 划分可见性。

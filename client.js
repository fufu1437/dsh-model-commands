/**
 * Browser half of `@fufu1437/dsh-model-commands`.
 *
 * One registration: a page in **Settings → Model commands** (`settings.section`)
 * that owns the command table the Host half turns into model-facing tools.
 *
 * The page is a management list: every stored command is a row showing the
 * tool name the model calls, the one-line description it reads, and the first
 * line of the body a call returns. Adding or editing opens an inline form with
 * the same fields the Host validates. Saving sends the whole table to the
 * Host's fenced route and renders the Host's own diagnostics, so the browser
 * never invents its own validation rules.
 *
 * The module reads only `--dsw-alias-*` theme tokens and renders its own
 * controls, so it adds no dependency on any Harness Client package. The
 * Host half owns the filesystem and tool registration; this module only talks
 * to its two JSON routes.
 *
 * @module @fufu1437/dsh-model-commands/client
 */

window.__ModuleLoader__.load({
  id: '@fufu1437/dsh-model-commands',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'fufu-model-commands'
    const COMMANDS_PATH = '/dsh-model-commands/commands'

    /* ------------------------------------------------------------------ */
    /* Locale                                                             */
    /* ------------------------------------------------------------------ */

    const zh = {
      'section.title': '模型命令',
      'page.intro': '在这里登记的每条命令都会成为模型可以调用的工具：说明让模型判断何时用它，描述是模型调用后拿到的帮助、参数与实际用途。',
      'page.store': '存储位置：{path}',
      'page.add': '新增命令',
      'page.empty': '还没有命令。点「新增命令」添加第一条。',
      'page.loading': '正在加载…',
      'page.retry': '重试',
      'page.reload': '重新加载',
      'row.edit': '编辑',
      'row.delete': '删除',
      'row.disabled': '已停用',
      'row.args': '{count} 个参数',
      'row.confirmDelete': '删除命令「{name}」？',
      'form.new': '新增命令',
      'form.edit': '编辑命令「{name}」',
      'form.name': '工具名（模型调用的名字）',
      'form.nameHint': '字母开头，可含字母、数字、下划线和连字符',
      'form.title': '显示名（可留空）',
      'form.description': '说明（模型据此判断何时调用）',
      'form.detail': '描述（命令的帮助、参数与实际用途）',
      'form.detailHint': '模型调用该工具时读到这段文字；可用 {{参数名}} 占位。描述与参数至少填一个，描述留空时返回「说明」。最多 32768 字符，可直接粘贴 --help 输出。',
      'form.enabled': '启用（停用后模型看不到这条命令）',
      'form.args': '参数',
      'form.argName': '参数名',
      'form.argType': '类型',
      'form.argDescription': '说明',
      'form.argDefault': '默认值',
      'form.argRequired': '必须',
      'form.argAdd': '添加参数',
      'form.argRemove': '移除',
      'form.save': '保存',
      'form.cancel': '取消',
      'form.saving': '保存中…',
      'form.saved': '已保存 {count} 条命令。',
      'notice.saveFailed': '保存失败：{message}',
      'notice.loadFailed': '加载失败：{message}',
    }

    const en = {
      'section.title': 'Model commands',
      'page.intro': 'Every command registered here becomes a tool the model can call: the description is how it decides, the detail is the usage it receives.',
      'page.store': 'Stored at {path}',
      'page.add': 'Add command',
      'page.empty': 'No commands yet. Use "Add command" to create the first one.',
      'page.loading': 'Loading…',
      'page.retry': 'Retry',
      'page.reload': 'Reload',
      'row.edit': 'Edit',
      'row.delete': 'Delete',
      'row.disabled': 'disabled',
      'row.args': '{count} argument(s)',
      'row.confirmDelete': 'Delete command "{name}"?',
      'form.new': 'Add command',
      'form.edit': 'Edit command "{name}"',
      'form.name': 'Tool name (what the model calls)',
      'form.nameHint': 'Starts with a letter; letters, digits, "_" and "-"',
      'form.title': 'Display name (optional)',
      'form.description': 'Description (how the model decides to call it)',
      'form.detail': 'Detail (usage, arguments, and what the command is for)',
      'form.detailHint': 'What the model receives when it calls this tool; {{argument}} placeholders are allowed. A detail or at least one argument is required; with no detail the tool answers with the description. Up to 32768 characters — pasting a --help dump is fine.',
      'form.enabled': 'Enabled (disabled commands stay hidden from the model)',
      'form.args': 'Arguments',
      'form.argName': 'Name',
      'form.argType': 'Type',
      'form.argDescription': 'Description',
      'form.argDefault': 'Default',
      'form.argRequired': 'Must',
      'form.argAdd': 'Add argument',
      'form.argRemove': 'Remove',
      'form.save': 'Save',
      'form.cancel': 'Cancel',
      'form.saving': 'Saving…',
      'form.saved': 'Saved {count} command(s).',
      'notice.saveFailed': 'Save failed: {message}',
      'notice.loadFailed': 'Load failed: {message}',
    }

    /** Literal fallback used before (or without) the host locale service. */
    const FALLBACK = en

    /** @param text - template. @param params - substitutions. @returns the filled template. */
    function interpolate(text, params) {
      if (params === undefined) return text
      return text.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])))
    }

    /** @param t - candidate translator. @returns a translator that always answers. */
    const translator = (t) => (typeof t === 'function' ? t : (key, params) => interpolate(FALLBACK[key] ?? key, params))

    /** Live translator: rebound to the host locale service inside `apply`. */
    let translate = translator(undefined)

    /* ------------------------------------------------------------------ */
    /* Styles (theme tokens only)                                          */
    /* ------------------------------------------------------------------ */

    const CSS = `
.dmc-page{display:flex;flex-direction:column;gap:16px;padding:4px 0 24px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.dmc-head{display:flex;flex-direction:column;gap:6px}
.dmc-title{margin:0;font-size:15px;line-height:22px;font-weight:600}
.dmc-muted{margin:0;font-size:13px;line-height:19px;color:var(--dsw-alias-label-secondary)}
.dmc-mono{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}
.dmc-toolbar{display:flex;align-items:center;gap:8px}
.dmc-btn{padding:5px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.dmc-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dmc-btn:disabled{opacity:.5;cursor:default}
.dmc-btn-primary{background:var(--dsw-alias-interactive-bg-primary,rgba(55,110,255,.12));border-color:var(--dsw-alias-border-l4,transparent);font-weight:600}
.dmc-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.dmc-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.dmc-row{display:flex;align-items:flex-start;gap:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-card,10px);background:var(--dsw-alias-bg-layer-1,transparent)}
.dmc-row-main{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
.dmc-row-top{display:flex;align-items:center;gap:8px;min-width:0}
.dmc-row-name{font-weight:600;overflow-wrap:anywhere}
.dmc-row-cmd{overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}
.dmc-row-actions{display:flex;gap:6px;flex:0 0 auto}
.dmc-badge{padding:1px 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dmc-badge-off{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.dmc-form{display:flex;flex-direction:column;gap:12px;padding:14px;border:1px solid var(--dsw-alias-border-l4,rgba(0,0,0,.12));border-radius:var(--dsw-radius-panel,12px);background:var(--dsw-alias-bg-layer-1,transparent)}
.dmc-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.dmc-field > span{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dmc-input,.dmc-textarea,.dmc-select{box-sizing:border-box;width:100%;padding:5px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px}
.dmc-textarea{resize:vertical;min-height:56px}
.dmc-check{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.dmc-arg{display:grid;grid-template-columns:minmax(0,1fr) 104px minmax(0,1.5fr) minmax(0,.9fr) 52px minmax(64px,auto);gap:8px;align-items:center}
.dmc-arg-head{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dmc-arg-head > span{padding-inline:9px}
.dmc-arg-head > span:nth-child(5){padding-inline:0}
.dmc-arg input[type=checkbox]{margin:0}
.dmc-arg-btn{width:100%}
.dmc-actions{display:flex;justify-content:flex-end;gap:8px}
.dmc-notice{margin:0;padding:8px 10px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l2);font-size:13px;line-height:19px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap}
.dmc-notice-error{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dmc-notice-ok{border-color:var(--dsw-alias-border-l4,transparent)}
.dmc-errors{margin:0;padding-left:18px}
`

    /** The one stylesheet element this bundle owns, removed when the plugin unloads. */
    let styleElement = null

    /** Create the shared stylesheet once; its owner is the plugin effect. */
    function mountStyles() {
      if (styleElement !== null || typeof document === 'undefined') return
      styleElement = document.createElement('style')
      styleElement.setAttribute('data-dsh-plugin', NS)
      styleElement.textContent = CSS
      document.head.appendChild(styleElement)
    }

    /** Remove the stylesheet; safe before mount and after an earlier removal. */
    function unmountStyles() {
      if (styleElement === null) return
      styleElement.remove()
      styleElement = null
    }

    /* ------------------------------------------------------------------ */
    /* Host transport                                                     */
    /* ------------------------------------------------------------------ */

    /**
     * Call one of the Host's fenced command-table routes.
     * @param method - HTTP method.
     * @param body - optional JSON body.
     * @returns the decoded successful response.
     * @throws when the transport or the Host refuses the call.
     */
    async function request(method, body) {
      const response = await fetch(COMMANDS_PATH, {
        method,
        credentials: 'same-origin',
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || data === null || data.ok !== true) {
        throw new Error(data?.message ?? `HTTP ${String(response.status)}`)
      }
      return data
    }

    /* ------------------------------------------------------------------ */
    /* Draft helpers                                                      */
    /* ------------------------------------------------------------------ */

    /** @returns a blank draft command. */
    function blankDraft() {
      return { name: '', title: '', description: '', detail: '', enabled: true, args: [] }
    }

    /**
     * Turn a stored command into an editor draft.
     * `command` is the pre-0.2.0 name of `detail`; an older stored row still
     * opens with its text in the right field.
     * @param command - a command from the Host table.
     * @returns the draft.
     */
    function toDraft(command) {
      return {
        name: command.name ?? '',
        title: command.title ?? '',
        description: command.description ?? '',
        detail: command.detail ?? command.command ?? '',
        enabled: command.enabled !== false,
        args: (command.args ?? []).map((argument) => ({
          name: argument.name ?? '',
          type: argument.type ?? 'string',
          description: argument.description ?? '',
          default: argument.default === undefined ? '' : String(argument.default),
          required: argument.required === true,
        })),
      }
    }

    /**
     * Turn an editor draft back into a wire command.
     * Empty optional text fields are omitted rather than sent as empty strings,
     * and the Host validates everything that remains — including the rule that
     * a detail or at least one argument must be present.
     * @param draft - the editor draft.
     * @returns the wire command.
     */
    function toCommand(draft) {
      const command = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        args: draft.args
          .filter((argument) => argument.name.trim().length > 0)
          .map((argument) => ({
            name: argument.name.trim(),
            type: argument.type,
            ...(argument.description.trim().length > 0 ? { description: argument.description.trim() } : {}),
            ...(argument.default.length > 0 ? { default: coerceDefault(argument.type, argument.default) } : {}),
            ...(argument.required ? { required: true } : {}),
          })),
      }
      if (draft.detail.trim().length > 0) command.detail = draft.detail
      if (draft.title.trim().length > 0) command.title = draft.title.trim()
      if (!draft.enabled) command.enabled = false
      return command
    }

    /**
     * Convert one default-value text field to the declared argument type.
     * @param type - the argument type.
     * @param text - the raw text.
     * @returns the typed default value.
     */
    function coerceDefault(type, text) {
      if (type === 'number') {
        const numeric = Number(text)
        return Number.isFinite(numeric) ? numeric : text
      }
      if (type === 'boolean') return text.trim().toLowerCase() === 'true'
      return text
    }

    /* ------------------------------------------------------------------ */
    /* Views                                                              */
    /* ------------------------------------------------------------------ */

    /**
     * One labelled control.
     * @param props - label, hint, and the control element.
     * @returns the field element.
     */
    function Field({ label, hint, children }) {
      return h('label', { className: 'dmc-field' },
        h('span', null, label),
        children,
        hint === undefined ? null : h('span', { className: 'dmc-muted' }, hint))
    }

    /**
     * The argument table inside the editor: one row per declared argument.
     * @param props - the draft arguments and their mutators.
     * @returns the argument editor.
     */
    function ArgumentEditor({ args, onChange }) {
      const patch = (index, change) => {
        onChange(args.map((argument, position) => (position === index ? { ...argument, ...change } : argument)))
      }
      const remove = (index) => {
        onChange(args.filter((_argument, position) => position !== index))
      }
      return h('div', { className: 'dmc-field' },
        h('span', null, translate('form.args')),
        args.length === 0
          ? null
          : h('div', { className: 'dmc-arg dmc-arg-head' },
            h('span', null, translate('form.argName')),
            h('span', null, translate('form.argType')),
            h('span', null, translate('form.argDescription')),
            h('span', null, translate('form.argDefault')),
            h('span', null, translate('form.argRequired')),
            h('span', null, '')),
        ...args.map((argument, index) => h('div', { className: 'dmc-arg', key: String(index) },
          h('input', {
            className: 'dmc-input dmc-mono',
            value: argument.name,
            'aria-label': translate('form.argName'),
            onChange: (event) => { patch(index, { name: event.target.value }) },
          }),
          h('select', {
            className: 'dmc-select',
            value: argument.type,
            'aria-label': translate('form.argType'),
            onChange: (event) => { patch(index, { type: event.target.value }) },
          }, ...['string', 'number', 'boolean'].map((type) => h('option', { key: type, value: type }, type))),
          h('input', {
            className: 'dmc-input',
            value: argument.description,
            'aria-label': translate('form.argDescription'),
            onChange: (event) => { patch(index, { description: event.target.value }) },
          }),
          h('input', {
            className: 'dmc-input dmc-mono',
            value: argument.default,
            'aria-label': translate('form.argDefault'),
            onChange: (event) => { patch(index, { default: event.target.value }) },
          }),
          h('input', {
            type: 'checkbox',
            checked: argument.required,
            'aria-label': translate('form.argRequired'),
            onChange: (event) => { patch(index, { required: event.target.checked }) },
          }),
          h('button', {
            type: 'button',
            className: 'dmc-btn dmc-arg-btn',
            onClick: () => { remove(index) },
          }, translate('form.argRemove')))),
        h('div', null, h('button', {
          type: 'button',
          className: 'dmc-btn',
          onClick: () => { onChange([...args, { name: '', type: 'string', description: '', default: '', required: false }]) },
        }, translate('form.argAdd'))))
    }

    /**
     * The whole editor form for one draft command.
     * @param props - the draft, its mutator, and the save/cancel actions.
     * @returns the form element.
     */
    function CommandForm({ draft, onChange, onCancel, onSave, saving, isNew }) {
      const patch = (change) => { onChange({ ...draft, ...change }) }
      return h('form', {
        className: 'dmc-form',
        onSubmit: (event) => { event.preventDefault(); onSave() },
      },
      h('h3', { className: 'dmc-title' }, isNew ? translate('form.new') : translate('form.edit', { name: draft.name })),
      h(Field, { label: translate('form.name'), hint: translate('form.nameHint') },
        h('input', { className: 'dmc-input dmc-mono', value: draft.name, onChange: (event) => { patch({ name: event.target.value }) } })),
      h(Field, { label: translate('form.title') },
        h('input', { className: 'dmc-input', value: draft.title, onChange: (event) => { patch({ title: event.target.value }) } })),
      h(Field, { label: translate('form.description') },
        h('textarea', { className: 'dmc-textarea', rows: 2, value: draft.description, onChange: (event) => { patch({ description: event.target.value }) } })),
      h(Field, { label: translate('form.detail'), hint: translate('form.detailHint') },
        h('textarea', { className: 'dmc-textarea dmc-mono', rows: 14, value: draft.detail, onChange: (event) => { patch({ detail: event.target.value }) } })),
      h(ArgumentEditor, { args: draft.args, onChange: (args) => { patch({ args }) } }),
      h('label', { className: 'dmc-check' },
        h('input', { type: 'checkbox', checked: draft.enabled, onChange: (event) => { patch({ enabled: event.target.checked }) } }),
        h('span', null, translate('form.enabled'))),
      h('div', { className: 'dmc-actions' },
        h('button', { type: 'button', className: 'dmc-btn', onClick: onCancel, disabled: saving }, translate('form.cancel')),
        h('button', { type: 'submit', className: 'dmc-btn dmc-btn-primary', disabled: saving }, saving ? translate('form.saving') : translate('form.save'))))
    }

    /**
     * One stored command as a row.
     * @param props - the command and its row actions.
     * @returns the row element.
     */
    /**
     * One-line preview of a command's detail for the list row.
     * @param detail - the stored detail text, or undefined.
     * @returns the first non-empty line, truncated, or an empty string.
     */
    function preview(detail) {
      if (typeof detail !== 'string') return ''
      const line = detail.split('\n').map((text) => text.trim()).find((text) => text.length > 0) ?? ''
      return line.length > 120 ? `${line.slice(0, 119)}…` : line
    }

    /**
     * One stored command as a row.
     * @param props - the command and its row actions.
     * @returns the row element.
     */
    function CommandRow({ command, onEdit, onDelete }) {
      const summary = preview(command.detail ?? command.command)
      return h('li', { className: 'dmc-row' },
        h('div', { className: 'dmc-row-main' },
          h('div', { className: 'dmc-row-top' },
            h('span', { className: 'dmc-row-name dmc-mono' }, command.name),
            command.title === undefined ? null : h('span', { className: 'dmc-badge' }, command.title),
            command.enabled === false ? h('span', { className: 'dmc-badge dmc-badge-off' }, translate('row.disabled')) : null,
            command.args.length === 0 ? null : h('span', { className: 'dmc-badge' }, translate('row.args', { count: command.args.length }))),
          h('div', { className: 'dmc-muted' }, command.description),
          summary.length === 0 ? null : h('div', { className: 'dmc-row-cmd dmc-mono' }, summary)),
        h('div', { className: 'dmc-row-actions' },
          h('button', { type: 'button', className: 'dmc-btn', onClick: onEdit }, translate('row.edit')),
          h('button', { type: 'button', className: 'dmc-btn dmc-btn-danger', onClick: onDelete }, translate('row.delete'))))
    }

    /**
     * The settings page itself: load, list, edit, save.
     * @returns the page element.
     */
    function ModelCommandsSection() {
      const [status, setStatus] = React.useState('loading')
      const [commands, setCommands] = React.useState([])
      const [errors, setErrors] = React.useState([])
      const [storePath, setStorePath] = React.useState('')
      const [draft, setDraft] = React.useState(null)
      const [saving, setSaving] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [failure, setFailure] = React.useState(null)

      const load = React.useCallback(async () => {
        setStatus('loading')
        setFailure(null)
        try {
          const data = await request('GET')
          setCommands(data.commands ?? [])
          setErrors(data.errors ?? [])
          setStorePath(data.storePath ?? '')
          setStatus('ready')
        } catch (error) {
          setFailure(translate('notice.loadFailed', { message: String(error?.message ?? error) }))
          setStatus('failed')
        }
      }, [])

      React.useEffect(() => { load() }, [load])

      /**
       * Persist the whole table: apply the pending edit locally, send it, and
       * adopt whatever the Host accepted plus its diagnostics.
       * @param next - the full command list to store.
       */
      const save = async (next) => {
        setSaving(true)
        setFailure(null)
        try {
          const data = await request('POST', { commands: next })
          const problems = data.errors ?? []
          setCommands(data.commands ?? [])
          setErrors(problems)
          setStorePath(data.storePath ?? storePath)
          setNotice(problems.length > 0 ? null : translate('form.saved', { count: (data.commands ?? []).length }))
          // Keep the editor open when the Host rejected something, so the draft
          // is not lost while the user fixes it.
          if (problems.length === 0) setDraft(null)
        } catch (error) {
          setFailure(translate('notice.saveFailed', { message: String(error?.message ?? error) }))
        } finally {
          setSaving(false)
        }
      }

      /** Replace the edited command (or append it) and store the table. */
      const commitDraft = () => {
        const command = toCommand(draft)
        const editingIndex = draft.editingIndex
        const next = editingIndex === undefined
          ? [...commands, command]
          : commands.map((existing, index) => (index === editingIndex ? command : existing))
        void save(next)
      }

      /** Start editing a new command. */
      const startNew = () => {
        setNotice(null)
        setDraft({ ...blankDraft(), editingIndex: undefined })
      }

      /** Start editing an existing command. @param index - its position. */
      const startEdit = (index) => {
        setNotice(null)
        setDraft({ ...toDraft(commands[index]), editingIndex: index })
      }

      /** Delete one command after confirmation. @param index - its position. */
      const remove = (index) => {
        const name = commands[index].name
        if (typeof window !== 'undefined' && !window.confirm(translate('row.confirmDelete', { name }))) return
        void save(commands.filter((_command, position) => position !== index))
      }

      if (status === 'loading') return h('div', { className: 'dmc-page' }, h('p', { className: 'dmc-muted' }, translate('page.loading')))
      if (status === 'failed') {
        return h('div', { className: 'dmc-page' },
          h('p', { className: 'dmc-notice dmc-notice-error' }, failure),
          h('div', { className: 'dmc-toolbar' }, h('button', { type: 'button', className: 'dmc-btn', onClick: () => { void load() } }, translate('page.retry'))))
      }

      return h('div', { className: 'dmc-page' },
        h('div', { className: 'dmc-head' },
          h('h2', { className: 'dmc-title' }, translate('section.title')),
          h('p', { className: 'dmc-muted' }, translate('page.intro')),
          storePath.length === 0 ? null : h('p', { className: 'dmc-muted dmc-mono' }, translate('page.store', { path: storePath }))),
        failure === null ? null : h('p', { className: 'dmc-notice dmc-notice-error' }, failure),
        notice === null ? null : h('p', { className: 'dmc-notice dmc-notice-ok' }, notice),
        errors.length === 0 ? null : h('div', { className: 'dmc-notice dmc-notice-error' },
          h('ul', { className: 'dmc-errors' }, ...errors.map((error, index) => h('li', { key: String(index) }, error.message)))),
        draft === null
          ? h('div', { className: 'dmc-toolbar' },
            h('button', { type: 'button', className: 'dmc-btn dmc-btn-primary', onClick: startNew }, translate('page.add')),
            h('button', { type: 'button', className: 'dmc-btn', onClick: () => { void load() } }, translate('page.reload')))
          : null,
        draft === null
          ? (commands.length === 0
            ? h('p', { className: 'dmc-muted' }, translate('page.empty'))
            : h('ul', { className: 'dmc-list' }, ...commands.map((command, index) => h(CommandRow, {
              key: `${command.name}:${String(index)}`,
              command,
              onEdit: () => { startEdit(index) },
              onDelete: () => { remove(index) },
            }))))
          : h(CommandForm, {
            draft,
            isNew: draft.editingIndex === undefined,
            saving,
            onChange: setDraft,
            onCancel: () => { setDraft(null) },
            onSave: commitDraft,
          }))
    }

    /* ------------------------------------------------------------------ */
    /* Plugin body                                                        */
    /* ------------------------------------------------------------------ */

    return {
      inject: ['slots', 'locale'],

      /**
       * Mount the stylesheet, the dictionaries, and the settings page.
       * @param ctx - the browser plugin context.
       */
      apply(ctx) {
        translate = translator(ctx.locale.bind(NS))
        ctx.effect(() => {
          mountStyles()
          return () => { unmountStyles() }
        }, 'dsh-model-commands: styles')
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-model-commands: dictionaries')

        ctx.slots.inject('settings.section', function* () {
          yield ctx.slots.register({
            name: 'settings.section',
            id: 'fufu-model-commands',
            order: 30,
            label: () => translate('section.title'),
          }, ModelCommandsSection)
        })
      },
    }
  },
})

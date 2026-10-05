/**
 * Browser half of `@fufu1437/dsh-model-commands`.
 *
 * One registration: a page in **Settings → Model commands** (`settings.section`)
 * that owns the skill table the Host half publishes into the Harness skill
 * registry.
 *
 * The layout follows the shape a management page in this Harness uses: a small
 * kicker over the title, a one-paragraph intro, cards for the stored entries
 * (name, badges, description, and a plain-text action row), and an editor card
 * with labelled fields that replaces the list while it is open.
 *
 * The page reads only `--dsw-alias-*` theme tokens and renders its own controls,
 * so it adds no dependency on any Harness Client package. The Host half owns the
 * filesystem, validation, and the registry; this module only talks to its two
 * JSON routes and renders the Host's own diagnostics.
 *
 * @module @fufu1437/dsh-model-commands/client
 */

window.__ModuleLoader__.load({
  id: '@fufu1437/dsh-model-commands',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'fufu-model-commands'
    const SKILLS_PATH = '/dsh-model-commands/skills'

    /* ------------------------------------------------------------------ */
    /* Locale                                                             */
    /* ------------------------------------------------------------------ */

    const zh = {
      'section.title': '模型命令',
      'page.kicker': '模型命令',
      'page.intro': '用 Markdown 写你自己的技能（skill）。模型在需要时按需加载正文，平时只看到一行说明；这个插件不执行任何命令。',
      'page.add': '新增技能',
      'page.empty': '还没有技能。点右上角的「+」写第一条。',
      'page.loading': '正在加载…',
      'page.retry': '重试',
      'page.reload': '重新加载',
      'page.store': '存储位置：{path}',
      'page.workspaceHint': '技能由本页管理；保存后立刻进入模型的技能目录，无需重启。',
      'badge.user': '用户创建',
      'badge.model': '模型创建',
      'badge.disabled': '已停用',
      'badge.private': '仅我可调用',
      'badge.hidden': '模型不可见',
      'row.edit': '编辑',
      'row.disable': '停用',
      'row.enable': '启用',
      'row.delete': '删除',
      'row.confirmDelete': '删除技能「{name}」？',
      'form.new': '新增技能',
      'form.edit': '编辑「{name}」',
      'form.name': '名称',
      'form.nameHint': 'kebab-case，例如 disk-usage；这是模型加载它时用的名字。',
      'form.description': '说明',
      'form.descriptionHint': '模型靠这段文字判断什么时候加载这个技能，是常驻目录里唯一的内容。',
      'form.whenToUse': '何时使用（可留空）',
      'form.whenToUseHint': '更具体的触发场景，会一并出现在技能目录里。',
      'form.content': '正文',
      'form.contentHint': '模型加载技能后读到的内容（Markdown）。可以整段粘贴命令的 --help 输出。',
      'form.invocation': '调用方式',
      'form.invocationHint': '默认只有模型能按需加载；打开「我也可以调用」后会同时出现在人类可用的命令入口。',
      'form.modelInvocable': '模型可调用',
      'form.userInvocable': '我也可以调用',
      'form.enabled': '启用',
      'form.enabledHint': '停用后仍保留在表里，但不会进入技能目录。',
      'form.save': '保存',
      'form.cancel': '取消',
      'form.saving': '保存中…',
      'form.saved': '已保存 {count} 条技能。',
      'notice.saveFailed': '保存失败：{message}',
      'notice.loadFailed': '加载失败：{message}',
      'notice.dismiss': '关闭提示',
    }

    const en = {
      'section.title': 'Model commands',
      'page.kicker': 'Model commands',
      'page.intro': 'Write your own skills in Markdown. The model loads the body only when it needs it and otherwise sees one line; this plugin executes nothing.',
      'page.add': 'Add skill',
      'page.empty': 'No skills yet. Use the "+" in the top right to write the first one.',
      'page.loading': 'Loading…',
      'page.retry': 'Retry',
      'page.reload': 'Reload',
      'page.store': 'Stored at {path}',
      'page.workspaceHint': 'Skills are managed here; a save reaches the model\'s skill catalog immediately, with no restart.',
      'badge.user': 'user',
      'badge.model': 'model',
      'badge.disabled': 'disabled',
      'badge.private': 'you only',
      'badge.hidden': 'model hidden',
      'row.edit': 'Edit',
      'row.disable': 'Disable',
      'row.enable': 'Enable',
      'row.delete': 'Delete',
      'row.confirmDelete': 'Delete skill "{name}"?',
      'form.new': 'Add skill',
      'form.edit': 'Edit "{name}"',
      'form.name': 'Name',
      'form.nameHint': 'kebab-case, e.g. disk-usage; this is the name the model loads.',
      'form.description': 'Description',
      'form.descriptionHint': 'How the model decides to load this skill — the only thing in the standing catalog.',
      'form.whenToUse': 'When to use (optional)',
      'form.whenToUseHint': 'A more specific trigger, carried in the catalog too.',
      'form.content': 'Body',
      'form.contentHint': 'What the model reads after loading the skill (Markdown). A pasted --help output is fine.',
      'form.invocation': 'Who can invoke it',
      'form.invocationHint': 'By default only the model loads it on demand; enable "you too" to also list it on the human command surface.',
      'form.modelInvocable': 'Model can invoke',
      'form.userInvocable': 'You can too',
      'form.enabled': 'Enabled',
      'form.enabledHint': 'A disabled skill stays in the table but leaves the catalog.',
      'form.save': 'Save',
      'form.cancel': 'Cancel',
      'form.saving': 'Saving…',
      'form.saved': 'Saved {count} skill(s).',
      'notice.saveFailed': 'Save failed: {message}',
      'notice.loadFailed': 'Load failed: {message}',
      'notice.dismiss': 'Dismiss',
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
.dmc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.dmc-head-text{display:flex;flex-direction:column;gap:6px;min-width:0}
.dmc-kicker{margin:0;font-size:11px;line-height:16px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.dmc-title{margin:0;font-size:20px;line-height:28px;font-weight:600}
.dmc-intro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.dmc-muted{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dmc-mono{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}
.dmc-add{flex:0 0 auto;width:36px;height:36px;border:0;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16));color:var(--dsw-alias-label-primary);font:inherit;font-size:20px;line-height:34px;cursor:pointer}
.dmc-add:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dmc-list{display:flex;flex-direction:column;gap:12px;margin:0;padding:0;list-style:none}
.dmc-card{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-card,12px);background:var(--dsw-alias-bg-layer-1,transparent)}
.dmc-card-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.dmc-card-name{font-weight:600;font-size:14px;line-height:20px;overflow-wrap:anywhere}
.dmc-badge{padding:1px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dmc-badge-warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.dmc-card-desc{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dmc-card-actions{display:flex;align-items:center;gap:16px}
.dmc-link{border:0;padding:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.dmc-link:hover{color:var(--dsw-alias-label-primary)}
.dmc-link-danger{color:var(--dsw-alias-state-error-primary)}
.dmc-link-danger:hover{color:var(--dsw-alias-state-error-primary)}
.dmc-form{display:flex;flex-direction:column;gap:18px;padding:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-card,12px);background:var(--dsw-alias-bg-layer-1,transparent)}
.dmc-form-title{margin:0;font-size:15px;line-height:22px;font-weight:600}
.dmc-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.dmc-label{font-size:13px;line-height:18px;font-weight:600}
.dmc-input,.dmc-textarea{box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px}
.dmc-textarea{resize:vertical}
.dmc-pills{display:flex;flex-wrap:wrap;gap:8px}
.dmc-pill{padding:5px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.dmc-pill:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dmc-pill-on{background:var(--dsw-alias-bg-layer-1,#fff);border-color:var(--dsw-alias-border-l4,transparent);color:var(--dsw-alias-label-primary);font-weight:600}
.dmc-actions{display:flex;justify-content:flex-end;gap:8px}
.dmc-btn{padding:6px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.dmc-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dmc-btn:disabled{opacity:.5;cursor:default}
.dmc-btn-primary{background:var(--dsw-alias-interactive-bg-primary,rgba(55,110,255,.12));border-color:var(--dsw-alias-border-l4,transparent);font-weight:600}
.dmc-notice{display:flex;align-items:flex-start;gap:8px;margin:0;padding:8px 10px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l2);font-size:13px;line-height:19px;color:var(--dsw-alias-label-secondary)}
.dmc-notice-body{flex:1;min-width:0;white-space:pre-wrap}
.dmc-notice-close{flex:0 0 auto;width:20px;height:20px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;font:inherit;font-size:15px;line-height:18px;cursor:pointer;opacity:.7}
.dmc-notice-close:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover)}
.dmc-notice-error{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dmc-notice-warn{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}
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
     * Call one of the Host's fenced skill-table routes.
     * @param method - HTTP method.
     * @param body - optional JSON body.
     * @returns the decoded successful response.
     * @throws when the transport or the Host refuses the call.
     */
    async function request(method, body) {
      const response = await fetch(SKILLS_PATH, {
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

    /** @returns a blank draft skill. */
    function blankDraft() {
      return {
        name: '',
        description: '',
        whenToUse: '',
        content: '',
        modelInvocable: true,
        userInvocable: false,
        enabled: true,
      }
    }

    /**
     * Turn a stored skill into an editor draft.
     * @param skill - a skill from the Host table.
     * @returns the draft.
     */
    function toDraft(skill) {
      return {
        name: skill.name ?? '',
        description: skill.description ?? '',
        whenToUse: skill.whenToUse ?? '',
        content: skill.content ?? '',
        modelInvocable: skill.modelInvocable !== false,
        userInvocable: skill.userInvocable === true,
        enabled: skill.enabled !== false,
      }
    }

    /**
     * Turn an editor draft back into a wire skill.
     * Empty optional fields are omitted rather than sent as empty strings, and
     * the Host validates everything that remains.
     * @param draft - the editor draft.
     * @param existing - the stored record being replaced, when editing.
     * @returns the wire skill.
     */
    function toSkill(draft, existing) {
      return {
        ...(existing === undefined ? {} : { id: existing.id, createdAt: existing.createdAt, source: existing.source }),
        name: draft.name.trim(),
        description: draft.description.trim(),
        ...(draft.whenToUse.trim().length > 0 ? { whenToUse: draft.whenToUse.trim() } : {}),
        content: draft.content,
        modelInvocable: draft.modelInvocable,
        userInvocable: draft.userInvocable,
        enabled: draft.enabled,
      }
    }

    /* ------------------------------------------------------------------ */
    /* Views                                                              */
    /* ------------------------------------------------------------------ */

    /**
     * A dismissible banner. Every banner in this page carries its own close
     * button, so a stale diagnostic never traps the user in the editor.
     * @param props - tone, the close handler, and the content.
     * @returns the banner element.
     */
    function Notice({ tone, onClose, children }) {
      const toneClass = tone === 'ok' ? 'dmc-notice-ok' : (tone === 'warn' ? 'dmc-notice-warn' : 'dmc-notice-error')
      return h('div', { className: `dmc-notice ${toneClass}` },
        h('div', { className: 'dmc-notice-body' }, children),
        h('button', {
          type: 'button',
          className: 'dmc-notice-close',
          'aria-label': translate('notice.dismiss'),
          title: translate('notice.dismiss'),
          onClick: onClose,
        }, '×'))
    }

    /**
     * One labelled field: bold label, helper line, then the control.
     * @param props - the label, the helper, and the control.
     * @returns the field element.
     */
    function Field({ label, hint, children }) {
      return h('div', { className: 'dmc-field' },
        h('span', { className: 'dmc-label' }, label),
        hint === undefined ? null : h('span', { className: 'dmc-muted' }, hint),
        children)
    }

    /**
     * A row of pill toggles; the caller decides whether they behave as a group
     * or as independent switches.
     * @param props - the options and the click handler.
     * @returns the pill row.
     */
    function Pills({ options }) {
      return h('div', { className: 'dmc-pills' }, ...options.map((option) => h('button', {
        key: option.label,
        type: 'button',
        className: `dmc-pill${option.on ? ' dmc-pill-on' : ''}`,
        'aria-pressed': option.on,
        onClick: option.onClick,
      }, option.label)))
    }

    /**
     * One stored skill as a card: name, badges, description, and text actions.
     * @param props - the skill and its actions.
     * @returns the card element.
     */
    function SkillCard({ skill, onEdit, onToggle, onDelete }) {
      const badges = [
        skill.source === 'model' ? translate('badge.model') : translate('badge.user'),
      ]
      if (skill.modelInvocable === false) badges.push(translate('badge.hidden'))
      if (skill.userInvocable === true) badges.push(translate('badge.private'))
      return h('li', { className: 'dmc-card' },
        h('div', { className: 'dmc-card-top' },
          h('span', { className: 'dmc-card-name dmc-mono' }, skill.name),
          ...badges.map((text) => h('span', { key: text, className: 'dmc-badge' }, text)),
          skill.enabled === false ? h('span', { className: 'dmc-badge dmc-badge-warn' }, translate('badge.disabled')) : null),
        h('p', { className: 'dmc-card-desc' }, skill.description),
        h('div', { className: 'dmc-card-actions' },
          h('button', { type: 'button', className: 'dmc-link', onClick: onEdit }, translate('row.edit')),
          h('button', { type: 'button', className: 'dmc-link', onClick: onToggle },
            skill.enabled === false ? translate('row.enable') : translate('row.disable')),
          h('button', { type: 'button', className: 'dmc-link dmc-link-danger', onClick: onDelete }, translate('row.delete'))))
    }

    /**
     * The editor card for one draft skill.
     * @param props - the draft, its mutator, and the save/cancel actions.
     * @returns the editor element.
     */
    function SkillEditor({ draft, onChange, onCancel, onSave, saving, isNew }) {
      const patch = (change) => { onChange({ ...draft, ...change }) }
      return h('form', {
        className: 'dmc-form',
        onSubmit: (event) => { event.preventDefault(); onSave() },
      },
      h('h3', { className: 'dmc-form-title' }, isNew ? translate('form.new') : translate('form.edit', { name: draft.name })),
      h(Field, { label: translate('form.name'), hint: translate('form.nameHint') },
        h('input', { className: 'dmc-input dmc-mono', value: draft.name, onChange: (event) => { patch({ name: event.target.value }) } })),
      h(Field, { label: translate('form.description'), hint: translate('form.descriptionHint') },
        h('textarea', { className: 'dmc-textarea', rows: 3, value: draft.description, onChange: (event) => { patch({ description: event.target.value }) } })),
      h(Field, { label: translate('form.whenToUse'), hint: translate('form.whenToUseHint') },
        h('input', { className: 'dmc-input', value: draft.whenToUse, onChange: (event) => { patch({ whenToUse: event.target.value }) } })),
      h(Field, { label: translate('form.content'), hint: translate('form.contentHint') },
        h('textarea', { className: 'dmc-textarea dmc-mono', rows: 16, value: draft.content, onChange: (event) => { patch({ content: event.target.value }) } })),
      h(Field, { label: translate('form.invocation'), hint: translate('form.invocationHint') },
        h(Pills, {
          options: [
            { label: translate('form.modelInvocable'), on: draft.modelInvocable, onClick: () => { patch({ modelInvocable: !draft.modelInvocable }) } },
            { label: translate('form.userInvocable'), on: draft.userInvocable, onClick: () => { patch({ userInvocable: !draft.userInvocable }) } },
          ],
        })),
      h(Field, { label: translate('form.enabled'), hint: translate('form.enabledHint') },
        h(Pills, {
          options: [
            { label: translate('form.enabled'), on: draft.enabled, onClick: () => { patch({ enabled: true }) } },
            { label: translate('row.disable'), on: !draft.enabled, onClick: () => { patch({ enabled: false }) } },
          ],
        })),
      h('div', { className: 'dmc-actions' },
        h('button', { type: 'button', className: 'dmc-btn', onClick: onCancel, disabled: saving }, translate('form.cancel')),
        h('button', { type: 'submit', className: 'dmc-btn dmc-btn-primary', disabled: saving }, saving ? translate('form.saving') : translate('form.save'))))
    }

    /**
     * The settings page itself: load, list, edit, save.
     * @returns the page element.
     */
    function ModelCommandsSection() {
      const [status, setStatus] = React.useState('loading')
      const [skills, setSkills] = React.useState([])
      const [errors, setErrors] = React.useState([])
      const [warnings, setWarnings] = React.useState([])
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
          setSkills(data.skills ?? [])
          setErrors(data.errors ?? [])
          setWarnings(data.warnings ?? [])
          setStorePath(data.storePath ?? '')
          setStatus('ready')
        } catch (error) {
          setFailure(translate('notice.loadFailed', { message: String(error?.message ?? error) }))
          setStatus('failed')
        }
      }, [])

      React.useEffect(() => { load() }, [load])

      /**
       * Persist the whole table: send it, then adopt whatever the Host accepted
       * together with its diagnostics.
       * @param next - the full skill list to store.
       */
      const save = async (next) => {
        setSaving(true)
        setFailure(null)
        try {
          const data = await request('POST', { skills: next })
          const problems = data.errors ?? []
          setSkills(data.skills ?? [])
          setErrors(problems)
          setWarnings(data.warnings ?? [])
          setStorePath(data.storePath ?? storePath)
          setNotice(problems.length > 0 ? null : translate('form.saved', { count: (data.skills ?? []).length }))
          // Keep the editor open when the Host rejected something, so the draft
          // is not lost while the user fixes it.
          if (problems.length === 0) setDraft(null)
        } catch (error) {
          setFailure(translate('notice.saveFailed', { message: String(error?.message ?? error) }))
        } finally {
          setSaving(false)
        }
      }

      /** Replace the edited skill (or append it) and store the table. */
      const commitDraft = () => {
        const editingIndex = draft.editingIndex
        const existing = editingIndex === undefined ? undefined : skills[editingIndex]
        const skill = toSkill(draft, existing)
        const next = editingIndex === undefined
          ? [...skills, skill]
          : skills.map((current, index) => (index === editingIndex ? skill : current))
        void save(next)
      }

      /** Start editing a new skill. */
      const startNew = () => {
        setNotice(null)
        setDraft({ ...blankDraft(), editingIndex: undefined })
      }

      /** Start editing an existing skill. @param index - its position. */
      const startEdit = (index) => {
        setNotice(null)
        setDraft({ ...toDraft(skills[index]), editingIndex: index })
      }

      /** Enable or disable one skill. @param index - its position. */
      const toggle = (index) => {
        void save(skills.map((skill, position) => (
          position === index ? { ...skill, enabled: skill.enabled === false } : skill
        )))
      }

      /** Delete one skill after confirmation. @param index - its position. */
      const remove = (index) => {
        const name = skills[index].name
        if (typeof window !== 'undefined' && !window.confirm(translate('row.confirmDelete', { name }))) return
        void save(skills.filter((_skill, position) => position !== index))
      }

      if (status === 'loading') return h('div', { className: 'dmc-page' }, h('p', { className: 'dmc-muted' }, translate('page.loading')))
      if (status === 'failed') {
        return h('div', { className: 'dmc-page' },
          h(Notice, { tone: 'error', onClose: () => { setFailure(null) } }, failure),
          h('div', { className: 'dmc-card-actions' }, h('button', { type: 'button', className: 'dmc-btn', onClick: () => { void load() } }, translate('page.retry'))))
      }

      return h('div', { className: 'dmc-page' },
        h('div', { className: 'dmc-head' },
          h('div', { className: 'dmc-head-text' },
            h('p', { className: 'dmc-kicker' }, translate('page.kicker')),
            h('h2', { className: 'dmc-title' }, translate('section.title')),
            h('p', { className: 'dmc-intro' }, translate('page.intro'))),
          h('button', {
            type: 'button',
            className: 'dmc-add',
            'aria-label': translate('page.add'),
            title: translate('page.add'),
            onClick: startNew,
          }, '+')),
        failure === null ? null : h(Notice, { tone: 'error', onClose: () => { setFailure(null) } }, failure),
        notice === null ? null : h(Notice, { tone: 'ok', onClose: () => { setNotice(null) } }, notice),
        errors.length === 0 ? null : h(Notice, { tone: 'error', onClose: () => { setErrors([]) } },
          h('ul', { className: 'dmc-errors' }, ...errors.map((error, index) => h('li', { key: String(index) }, error.message)))),
        warnings.length === 0 ? null : h(Notice, { tone: 'warn', onClose: () => { setWarnings([]) } },
          h('ul', { className: 'dmc-errors' }, ...warnings.map((warning, index) => h('li', { key: String(index) }, warning.message)))),
        draft !== null
          ? h(SkillEditor, {
            draft,
            isNew: draft.editingIndex === undefined,
            saving,
            onChange: setDraft,
            onCancel: () => { setDraft(null) },
            onSave: commitDraft,
          })
          : (skills.length === 0
            ? h('p', { className: 'dmc-muted' }, translate('page.empty'))
            : h('ul', { className: 'dmc-list' }, ...skills.map((skill, index) => h(SkillCard, {
              key: skill.id ?? `${skill.name}:${String(index)}`,
              skill,
              onEdit: () => { startEdit(index) },
              onToggle: () => { toggle(index) },
              onDelete: () => { remove(index) },
            })))),
        h('p', { className: 'dmc-muted' }, translate('page.workspaceHint')),
        storePath.length === 0 ? null : h('p', { className: 'dmc-muted dmc-mono' }, translate('page.store', { path: storePath })))
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

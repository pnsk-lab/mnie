/**
 * Small browser surface used by the Starbucks anti-bot bundles.
 *
 * This is intentionally not a general-purpose DOM implementation.  The
 * captured KXZ/login bundles only need a document tree, form controls,
 * anchors, CustomEvent dispatch, and a few browser globals.  Keeping this
 * surface local avoids pulling in DOM packages whose Window implementation
 * creates a Node `vm` context.
 */

type EventInitLike = {
  bubbles?: boolean
  cancelable?: boolean
  composed?: boolean
  detail?: unknown
  isTrusted?: boolean
  button?: number
  buttons?: number
  which?: number
  clientX?: number
  clientY?: number
  pageX?: number
  pageY?: number
  screenX?: number
  screenY?: number
  offsetX?: number
  offsetY?: number
  movementX?: number
  movementY?: number
}
type Listener = ((event: MiniEvent) => unknown) | { handleEvent(event: MiniEvent): unknown }
type ListenerOptions = boolean | { capture?: boolean; once?: boolean }

type MiniMutationRecord = {
  type: 'childList' | 'attributes'
  target: MiniNode
  addedNodes: MiniNode[]
  removedNodes: MiniNode[]
  attributeName?: string
}

const mutationObservers = new Set<MiniMutationObserver>()

const notifyMutation = (record: MiniMutationRecord) => {
  for (const observer of mutationObservers) observer.enqueue(record)
}

const asFunction = (listener: Listener | null | undefined) => {
  if (typeof listener === 'function') return listener
  if (listener && typeof listener.handleEvent === 'function')
    return listener.handleEvent.bind(listener)
  return undefined
}

export class MiniEvent {
  readonly type: string
  readonly bubbles: boolean
  readonly cancelable: boolean
  readonly composed: boolean
  target: unknown = null
  currentTarget: unknown = null
  defaultPrevented = false
  /** Legacy submit/click handlers read and write this alias in browsers. */
  returnValue = true
  readonly timeStamp = Date.now()
  eventPhase = 0
  cancelBubble = false
  /** Programmatically dispatched events are untrusted, as in browsers. */
  readonly isTrusted: boolean
  submitter: MiniElement | null = null
  detail: unknown = undefined
  readonly button: number
  readonly buttons: number
  readonly which: number
  readonly clientX: number
  readonly clientY: number
  readonly pageX: number
  readonly pageY: number
  readonly screenX: number
  readonly screenY: number
  readonly offsetX: number
  readonly offsetY: number
  readonly movementX: number
  readonly movementY: number
  get srcElement() {
    return this.target
  }
  #stopped = false
  #immediateStopped = false

  constructor(type: string, init: EventInitLike = {}) {
    this.type = type
    this.bubbles = Boolean(init.bubbles)
    this.cancelable = Boolean(init.cancelable)
    this.composed = Boolean(init.composed)
    this.detail = init.detail
    this.isTrusted = Boolean(init.isTrusted)
    this.button = init.button ?? (type === 'click' ? 0 : 0)
    this.buttons = init.buttons ?? (type === 'click' ? 1 : 0)
    this.which = init.which ?? (type === 'click' ? 1 : 0)
    this.clientX = init.clientX ?? 0
    this.clientY = init.clientY ?? 0
    this.pageX = init.pageX ?? this.clientX
    this.pageY = init.pageY ?? this.clientY
    this.screenX = init.screenX ?? this.clientX
    this.screenY = init.screenY ?? this.clientY
    this.offsetX = init.offsetX ?? this.clientX
    this.offsetY = init.offsetY ?? this.clientY
    this.movementX = init.movementX ?? 0
    this.movementY = init.movementY ?? 0
  }

  stopPropagation() {
    this.#stopped = true
    this.cancelBubble = true
  }

  stopImmediatePropagation() {
    this.#stopped = true
    this.#immediateStopped = true
    this.cancelBubble = true
  }

  preventDefault() {
    if (this.cancelable) {
      this.defaultPrevented = true
      this.returnValue = false
    }
  }

  composedPath() {
    const path: unknown[] = []
    let current: unknown = this.target
    while (current) {
      path.push(current)
      current = current instanceof MiniNode ? current.parentNode : null
    }
    return path
  }

  /** Legacy Chromium alias still read by a few bundled listeners. */
  get path() {
    return this.composedPath()
  }

  /** @internal */
  get stopped() {
    return this.#stopped
  }

  /** @internal */
  get immediateStopped() {
    return this.#immediateStopped
  }
}

export class MiniCustomEvent extends MiniEvent {
  constructor(type: string, init: EventInitLike = {}) {
    super(type, init)
    this.detail = init.detail
  }

  initCustomEvent(type: string, bubbles = false, cancelable = false, detail?: unknown) {
    Object.defineProperties(this, {
      type: { configurable: true, value: type },
      bubbles: { configurable: true, value: Boolean(bubbles) },
      cancelable: { configurable: true, value: Boolean(cancelable) },
      detail: { configurable: true, value: detail },
    })
  }
}

type ListenerEntry = { listener: Listener; capture: boolean; once: boolean }

export class MiniEventTarget {
  #listeners = new Map<string, ListenerEntry[]>()

  addEventListener(type: string, listener: Listener | null, options?: ListenerOptions) {
    if (!listener) return
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture)
    const once = typeof options === 'object' && Boolean(options?.once)
    const entries = this.#listeners.get(type) ?? []
    if (!entries.some((entry) => entry.listener === listener && entry.capture === capture))
      entries.push({ listener, capture, once })
    this.#listeners.set(type, entries)
  }

  removeEventListener(type: string, listener: Listener | null, options?: ListenerOptions) {
    if (!listener) return
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture)
    const entries = this.#listeners.get(type)
    if (!entries) return
    this.#listeners.set(
      type,
      entries.filter((entry) => entry.listener !== listener || entry.capture !== capture),
    )
  }

  dispatchEvent(event: MiniEvent) {
    if (!event || typeof event.type !== 'string')
      throw new TypeError("Failed to execute 'dispatchEvent': parameter 1 is not of type 'Event'.")
    event.target = this
    const path: MiniEventTarget[] = []
    if (this instanceof MiniNode) {
      let current: MiniNode | null = this
      while (current) {
        path.push(current)
        if (current instanceof MiniDocument) {
          const view = current.defaultView
          if (view instanceof MiniEventTarget) path.push(view)
          break
        }
        current = current.parentNode
      }
    } else path.push(this)

    // Capturing listeners run from the window/document down to the target.
    // This matters for the login anti-bot handler, which deliberately installs
    // its submit listener with capture=true.
    for (let index = path.length - 1; index > 0; index -= 1) {
      const current = path[index]
      if (!current) continue
      event.currentTarget = current
      event.eventPhase = 1
      current.#invokeListeners(event, true)
      current.#invokeEventHandler(event)
      if (event.stopped) return !event.defaultPrevented
    }

    const target = path[0]
    if (target) {
      event.currentTarget = target
      event.eventPhase = 2
      target.#invokeListeners(event)
      target.#invokeEventHandler(event)
      if (event.stopped) return !event.defaultPrevented
    }

    if (event.bubbles) {
      for (let index = 1; index < path.length; index += 1) {
        const current = path[index]
        if (!current) continue
        event.currentTarget = current
        event.eventPhase = 3
        current.#invokeListeners(event, false)
        current.#invokeEventHandler(event)
        if (event.stopped) break
      }
    }
    return !event.defaultPrevented
  }

  #invokeListeners(event: MiniEvent, capture?: boolean) {
    const entries = [...(this.#listeners.get(event.type) ?? [])]
    for (const entry of entries) {
      if (event.immediateStopped) break
      // At the target both capture and bubble listeners run; on ancestors the
      // caller passes the phase explicitly.
      if (capture !== undefined && entry.capture !== capture) continue
      const callback = asFunction(entry.listener)
      if (!callback) continue
      if (entry.once) this.removeEventListener(event.type, entry.listener, entry.capture)
      try {
        callback.call(this, event)
      } catch (error) {
        // Browser event dispatch reports listener errors asynchronously. Keep
        // an opt-in hook so embedders can surface diagnostics without changing
        // the browser-compatible dispatch return value.
        const hook = (globalThis as unknown as Record<string, unknown>).__miniEventError
        if (typeof hook === 'function') Reflect.apply(hook, undefined, [error, event, this])
      }
    }
  }

  #invokeEventHandler(event: MiniEvent) {
    const handler = (this as unknown as Record<string, unknown>)[`on${event.type}`]
    if (typeof handler !== 'function') return
    try {
      handler.call(this, event)
    } catch {}
  }
}

export class MiniNode extends MiniEventTarget {
  static readonly DOCUMENT_POSITION_DISCONNECTED = 1
  static readonly DOCUMENT_POSITION_PRECEDING = 2
  static readonly DOCUMENT_POSITION_FOLLOWING = 4
  static readonly DOCUMENT_POSITION_CONTAINS = 8
  static readonly DOCUMENT_POSITION_CONTAINED_BY = 16
  readonly ownerDocument: MiniDocument | null
  parentNode: MiniNode | null = null
  childNodes: MiniNode[] = []

  constructor(ownerDocument: MiniDocument | null) {
    super()
    this.ownerDocument = ownerDocument
  }

  get firstChild(): MiniNode | null {
    return this.childNodes[0] ?? null
  }

  get lastChild(): MiniNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null
  }

  get nextSibling(): MiniNode | null {
    if (!this.parentNode) return null
    const index = this.parentNode.childNodes.indexOf(this)
    return index < 0 ? null : (this.parentNode.childNodes[index + 1] ?? null)
  }

  get previousSibling(): MiniNode | null {
    if (!this.parentNode) return null
    const index = this.parentNode.childNodes.indexOf(this)
    return index <= 0 ? null : (this.parentNode.childNodes[index - 1] ?? null)
  }

  get children() {
    return this.childNodes.filter((child): child is MiniElement => child instanceof MiniElement)
  }

  get isConnected() {
    let node: MiniNode | null = this
    while (node) {
      if (node instanceof MiniDocument) return true
      node = node.parentNode
    }
    return false
  }

  appendChild<T extends MiniNode>(child: T) {
    if (child.parentNode) child.parentNode.removeChild(child)
    this.childNodes.push(child)
    child.parentNode = this
    notifyMutation({ type: 'childList', target: this, addedNodes: [child], removedNodes: [] })
    if (child instanceof MiniHTMLIFrameElement) child.scheduleLoad()
    return child
  }

  removeChild<T extends MiniNode>(child: T) {
    const index = this.childNodes.indexOf(child)
    if (index < 0) throw new Error('The node to be removed is not a child of this node')
    this.childNodes.splice(index, 1)
    child.parentNode = null
    notifyMutation({ type: 'childList', target: this, addedNodes: [], removedNodes: [child] })
    return child
  }

  insertBefore<T extends MiniNode>(child: T, before: MiniNode | null) {
    if (!before) return this.appendChild(child)
    const index = this.childNodes.indexOf(before)
    if (index < 0) return this.appendChild(child)
    if (child.parentNode) child.parentNode.removeChild(child)
    this.childNodes.splice(index, 0, child)
    child.parentNode = this
    notifyMutation({ type: 'childList', target: this, addedNodes: [child], removedNodes: [] })
    return child
  }

  replaceChild<T extends MiniNode>(child: T, oldChild: MiniNode) {
    const index = this.childNodes.indexOf(oldChild)
    if (index < 0) throw new Error('The node to be replaced is not a child of this node')
    if (child.parentNode) child.parentNode.removeChild(child)
    this.childNodes[index] = child
    oldChild.parentNode = null
    child.parentNode = this
    notifyMutation({
      type: 'childList',
      target: this,
      addedNodes: [child],
      removedNodes: [oldChild],
    })
    if (child instanceof MiniHTMLIFrameElement) child.scheduleLoad()
    return oldChild
  }

  append(...items: Array<MiniNode | string>) {
    for (const item of items)
      this.appendChild(typeof item === 'string' ? new MiniText(this.ownerDocument, item) : item)
  }

  prepend(...items: Array<MiniNode | string>) {
    for (const item of [...items].reverse())
      this.insertBefore(
        typeof item === 'string' ? new MiniText(this.ownerDocument, item) : item,
        this.firstChild,
      )
  }

  /** DOM sibling insertion methods used by the captured form handler. */
  before(...items: Array<MiniNode | string>) {
    const parent = this.parentNode
    if (!parent) return
    for (const item of items) {
      const node = typeof item === 'string' ? new MiniText(this.ownerDocument, item) : item
      if (node instanceof MiniDocumentFragment) {
        for (const child of [...node.childNodes]) parent.insertBefore(child, this)
      } else parent.insertBefore(node, this)
    }
  }

  after(...items: Array<MiniNode | string>) {
    const parent = this.parentNode
    if (!parent) return
    const reference = this.nextSibling
    for (const item of items) {
      const node = typeof item === 'string' ? new MiniText(this.ownerDocument, item) : item
      if (node instanceof MiniDocumentFragment) {
        for (const child of [...node.childNodes]) parent.insertBefore(child, reference)
      } else parent.insertBefore(node, reference)
    }
  }

  replaceWith(...items: Array<MiniNode | string>) {
    const parent = this.parentNode
    if (!parent) return
    const reference = this.nextSibling
    for (const item of items) {
      const node = typeof item === 'string' ? new MiniText(this.ownerDocument, item) : item
      if (node instanceof MiniDocumentFragment) {
        for (const child of [...node.childNodes]) parent.insertBefore(child, reference)
      } else parent.insertBefore(node, reference)
    }
    parent.removeChild(this)
  }

  replaceChildren(...items: Array<MiniNode | string>) {
    for (const child of [...this.childNodes]) this.removeChild(child)
    this.append(...items)
  }

  insertAdjacentHTML(position: string, html: string) {
    const normalized = position.toLowerCase()
    if (normalized === 'beforeend' || normalized === 'afterbegin') {
      if (normalized === 'beforeend') parseFragment(this.ownerDocument, this, html)
      else {
        const fragment = this.ownerDocument?.createDocumentFragment()
        if (fragment) {
          parseFragment(this.ownerDocument, fragment, html)
          for (const child of [...fragment.childNodes]) this.insertBefore(child, this.firstChild)
        }
      }
      return
    }
    if (normalized !== 'beforebegin' && normalized !== 'afterend')
      throw new Error(`Unsupported insertAdjacentHTML position: ${position}`)
    const parent = this.parentNode
    if (!parent) return
    const fragment = this.ownerDocument?.createDocumentFragment()
    if (!fragment) return
    parseFragment(this.ownerDocument, fragment, html)
    const reference = normalized === 'beforebegin' ? this : this.nextSibling
    for (const child of [...fragment.childNodes]) parent.insertBefore(child, reference)
  }

  insertAdjacentElement(position: string, element: MiniElement) {
    const normalized = position.toLowerCase()
    if (normalized === 'beforeend') this.appendChild(element)
    else if (normalized === 'afterbegin') this.insertBefore(element, this.firstChild)
    else if (normalized === 'beforebegin') this.parentNode?.insertBefore(element, this)
    else if (normalized === 'afterend' && this.parentNode)
      this.parentNode.insertBefore(element, this.nextSibling)
    else throw new Error(`Unsupported insertAdjacentElement position: ${position}`)
    return element
  }

  insertAdjacentText(position: string, text: string) {
    const node = new MiniText(this.ownerDocument, String(text))
    const normalized = position.toLowerCase()
    if (normalized === 'beforeend') this.appendChild(node)
    else if (normalized === 'afterbegin') this.insertBefore(node, this.firstChild)
    else if (normalized === 'beforebegin') this.parentNode?.insertBefore(node, this)
    else if (normalized === 'afterend' && this.parentNode)
      this.parentNode.insertBefore(node, this.nextSibling)
    else throw new Error(`Unsupported insertAdjacentText position: ${position}`)
    return node
  }

  remove() {
    this.parentNode?.removeChild(this)
  }

  cloneNode<T extends MiniNode>(this: T, deep = false): T {
    let clone: MiniNode
    if (this instanceof MiniText) clone = new MiniText(this.ownerDocument, this.data)
    else if (this instanceof MiniElement) {
      clone =
        this.ownerDocument?.createElement(this.tagName.toLowerCase()) ??
        new MiniElement(null, this.tagName)
      for (const [name, value] of this.attributes) (clone as MiniElement).setAttribute(name, value)
    } else clone = new MiniNode(this.ownerDocument)
    if (deep) for (const child of this.childNodes) clone.appendChild(child.cloneNode(true))
    return clone as T
  }

  contains(node: MiniNode | null) {
    if (!node) return false
    let current: MiniNode | null = node
    while (current) {
      if (current === this) return true
      current = current.parentNode
    }
    return false
  }

  compareDocumentPosition(other: MiniNode | null) {
    if (!other || this.ownerDocument !== other.ownerDocument)
      return MiniNode.DOCUMENT_POSITION_DISCONNECTED
    if (this === other) return 0
    if (this.contains(other))
      return MiniNode.DOCUMENT_POSITION_CONTAINED_BY | MiniNode.DOCUMENT_POSITION_FOLLOWING
    if (other.contains(this))
      return MiniNode.DOCUMENT_POSITION_CONTAINS | MiniNode.DOCUMENT_POSITION_PRECEDING

    const path = (node: MiniNode) => {
      const result: MiniNode[] = []
      let current: MiniNode | null = node
      while (current) {
        result.unshift(current)
        current = current.parentNode
      }
      return result
    }
    const left = path(this)
    const right = path(other)
    let index = 0
    while (left[index] === right[index]) index += 1
    const leftParent = left[index - 1]
    const leftChild = left[index]
    const rightChild = right[index]
    if (!leftParent || !leftChild || !rightChild) return MiniNode.DOCUMENT_POSITION_DISCONNECTED
    return leftParent.childNodes.indexOf(leftChild) < leftParent.childNodes.indexOf(rightChild)
      ? MiniNode.DOCUMENT_POSITION_FOLLOWING
      : MiniNode.DOCUMENT_POSITION_PRECEDING
  }

  get textContent() {
    return this.childNodes.map((child) => child.textContent).join('')
  }

  set textContent(value: string) {
    this.childNodes = []
    if (value) this.appendChild(new MiniText(this.ownerDocument, value))
  }
}

export class MiniText extends MiniNode {
  readonly nodeType = 3
  data: string

  constructor(ownerDocument: MiniDocument | null, data: string) {
    super(ownerDocument)
    this.data = data
  }

  override get textContent() {
    return this.data
  }

  override set textContent(value: string) {
    this.data = value
  }
}

export class MiniDocumentFragment extends MiniNode {
  readonly nodeType = 11
}

const decodeEntities = (value: string) =>
  value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')

const normalizeAttributeName = (name: string) => name.toLowerCase()

const parseAttributes = (value: string) => {
  const attributes = new Map<string, string>()
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  for (const match of value.matchAll(pattern)) {
    const name = normalizeAttributeName(match[1] ?? '')
    if (!name) continue
    attributes.set(name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? ''))
  }
  return attributes
}

const splitSelector = (selector: string) => selector.trim().split(/\s+/).filter(Boolean)

const selectorMatches = (element: MiniElement, selector: string) => {
  const simple = selector.trim()
  if (!simple) return false
  const tag = simple.match(/^[A-Za-z][\w-]*/)?.[0]
  if (tag && element.tagName.toLowerCase() !== tag.toLowerCase()) return false
  const id = simple.match(/#([\w-]+)/)?.[1]
  if (id && element.id !== id) return false
  for (const className of simple.matchAll(/\.([\w-]+)/g)) {
    if (!element.classList.contains(className[1] ?? '')) return false
  }
  for (const attribute of simple.matchAll(/\[([^\]=]+)(?:\s*=\s*["']?([^\]"']+)["']?)?\]/g)) {
    const name = normalizeAttributeName(attribute[1] ?? '')
    if (!element.hasAttribute(name)) return false
    if (attribute[2] !== undefined && element.getAttribute(name) !== attribute[2]) return false
  }
  return true
}

const descendants = (node: MiniNode): MiniElement[] => {
  const result: MiniElement[] = []
  for (const child of node.childNodes) {
    if (child instanceof MiniElement) {
      result.push(child)
      result.push(...descendants(child))
    }
  }
  return result
}

class MiniNamedNodeMap extends Map<string, string> {
  get length() {
    return this.size
  }

  item(index: number) {
    const name = [...this.keys()][index]
    return name === undefined ? null : { name, value: this.get(name) ?? '' }
  }

  getNamedItem(name: string) {
    const normalized = normalizeAttributeName(name)
    const value = this.get(normalized)
    return value === undefined ? null : { name: normalized, value }
  }

  hasNamedItem(name: string) {
    return this.has(normalizeAttributeName(name))
  }

  removeNamedItem(name: string) {
    const normalized = normalizeAttributeName(name)
    const value = this.get(normalized)
    this.delete(normalized)
    return value === undefined ? null : { name: normalized, value }
  }
}

export class MiniElement extends MiniNode {
  readonly nodeType = 1
  readonly tagName: string
  readonly attributes = new MiniNamedNodeMap()
  readonly style: Record<string, string> = {}
  readonly classList = {
    contains: (name: string) => this.className.split(/\s+/).includes(name),
    add: (...names: string[]) => {
      this.className = [
        ...new Set([...this.className.split(/\s+/).filter(Boolean), ...names]),
      ].join(' ')
    },
    remove: (...names: string[]) => {
      this.className = this.className
        .split(/\s+/)
        .filter((name) => name && !names.includes(name))
        .join(' ')
    },
  }

  constructor(
    ownerDocument: MiniDocument | null,
    tagName = 'div',
    attributes?: Map<string, string>,
  ) {
    super(ownerDocument)
    this.tagName = tagName.toUpperCase()
    if (attributes) for (const [name, value] of attributes) this.attributes.set(name, value)
  }

  get nodeName() {
    return this.tagName
  }

  get id() {
    return this.getAttribute('id') ?? ''
  }

  set id(value: string) {
    this.setAttribute('id', value)
  }

  get className() {
    return this.getAttribute('class') ?? ''
  }

  set className(value: string) {
    this.setAttribute('class', value)
  }

  get name() {
    return this.getAttribute('name') ?? ''
  }

  set name(value: string) {
    this.setAttribute('name', value)
  }

  get value() {
    return this.getAttribute('value') ?? ''
  }

  set value(value: unknown) {
    this.setAttribute('value', String(value ?? ''))
  }

  get type() {
    return (this.getAttribute('type') ?? (this.tagName === 'INPUT' ? 'text' : '')).toLowerCase()
  }

  set type(value: string) {
    this.setAttribute('type', value)
  }

  get disabled() {
    return this.hasAttribute('disabled')
  }

  get formNoValidate() {
    return this.hasAttribute('formnovalidate')
  }

  set formNoValidate(value: boolean) {
    if (value) this.setAttribute('formnovalidate', '')
    else this.removeAttribute('formnovalidate')
  }

  set disabled(value: boolean) {
    if (value) this.setAttribute('disabled', '')
    else this.removeAttribute('disabled')
  }

  get checked() {
    return this.hasAttribute('checked')
  }

  set checked(value: boolean) {
    if (value) this.setAttribute('checked', '')
    else this.removeAttribute('checked')
  }

  get innerText() {
    return this.textContent
  }

  set innerText(value: string) {
    this.textContent = value
  }

  /**
   * Layout values are observable even in headless pages.  The captured
   * anti-bot listeners use them as a cheap interaction sanity check before
   * accepting a click; returning `undefined` (the old shim behaviour) made
   * that browser branch exit early.
   */
  private layoutSize(axis: 'width' | 'height') {
    const styleValue = this.style[axis]
    const parsed = styleValue ? Number.parseFloat(styleValue) : Number.NaN
    if (Number.isFinite(parsed)) return parsed
    if (this.hasAttribute('hidden') || this.type === 'hidden') return 0
    return 1
  }

  get offsetWidth() {
    return Math.round(this.layoutSize('width'))
  }

  get offsetHeight() {
    return Math.round(this.layoutSize('height'))
  }

  get clientWidth() {
    return this.offsetWidth
  }

  get clientHeight() {
    return this.offsetHeight
  }

  get scrollWidth() {
    return this.offsetWidth
  }

  get scrollHeight() {
    return this.offsetHeight
  }

  getBoundingClientRect() {
    const width = this.offsetWidth
    const height = this.offsetHeight
    return {
      x: 0,
      y: 0,
      top: 0,
      right: width,
      bottom: height,
      left: 0,
      width,
      height,
      toJSON: () => ({ x: 0, y: 0, top: 0, right: width, bottom: height, left: 0, width, height }),
    }
  }

  get innerHTML() {
    return this.childNodes.map((child) => serializeNode(child)).join('')
  }

  set innerHTML(value: string) {
    this.childNodes = []
    parseFragment(this.ownerDocument, this, String(value ?? ''))
  }

  get outerHTML() {
    return serializeElement(this)
  }

  set outerHTML(value: string) {
    const parent = this.parentNode
    if (!parent) return
    const fragment = this.ownerDocument?.createDocumentFragment()
    if (!fragment) return
    parseFragment(this.ownerDocument, fragment, String(value ?? ''))
    const reference = this.nextSibling
    for (const child of [...fragment.childNodes]) parent.insertBefore(child, reference)
    parent.removeChild(this)
  }

  get parentElement() {
    return this.parentNode instanceof MiniElement ? this.parentNode : null
  }

  /** The nearest form owner for a form-associated element. */
  get form(): MiniHTMLFormElement | null {
    let current: MiniNode | null = this.parentNode
    while (current) {
      if (current instanceof MiniHTMLFormElement) return current
      current = current.parentNode
    }
    return null
  }

  /**
   * Run the default activation behavior for submit controls. The anti-bot
   * bundle installs its listener on document, so dispatching a bubbling click
   * and then requestSubmit is required to match a real button activation.
   */
  click() {
    this.focus()
    const event = new MiniEvent('click', {
      bubbles: true,
      cancelable: true,
      // This method is used as the synthetic representation of the user's
      // submit-button activation in the login flow.
      isTrusted: true,
    })
    if (!this.dispatchEvent(event) || event.defaultPrevented) return
    if (
      (this.tagName === 'BUTTON' && (this.type || 'submit') === 'submit') ||
      (this.tagName === 'INPUT' && (this.type === 'submit' || this.type === 'image'))
    ) {
      this.form?.requestSubmit(this)
    }
  }

  focus() {
    const document = this.ownerDocument as
      | (MiniDocument & { _setActiveElement?: (element: MiniElement) => void })
      | null
    document?._setActiveElement?.(this)
    this.dispatchEvent(new MiniEvent('focus', { bubbles: false, isTrusted: true }))
  }

  blur() {
    const document = this.ownerDocument as
      | (MiniDocument & { _setActiveElement?: (element: null) => void })
      | null
    document?._setActiveElement?.(null)
    this.dispatchEvent(new MiniEvent('blur', { bubbles: false, isTrusted: true }))
  }

  hasChildNodes() {
    return this.childNodes.length > 0
  }

  getElementsByTagName(tagName: string) {
    const tag = tagName.toLowerCase()
    return descendants(this).filter(
      (element) => tag === '*' || element.tagName.toLowerCase() === tag,
    )
  }

  get dataset() {
    const element = this
    return new Proxy({} as Record<string, string>, {
      get(_target, property: string) {
        const attribute = property.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
        return element.getAttribute(`data-${attribute}`) ?? undefined
      },
      set(_target, property: string, value: unknown) {
        const attribute = property.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
        element.setAttribute(`data-${attribute}`, value)
        return true
      },
      deleteProperty(_target, property: string) {
        const attribute = property.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
        element.removeAttribute(`data-${attribute}`)
        return true
      },
    })
  }

  get hidden() {
    return this.hasAttribute('hidden')
  }

  set hidden(value: boolean) {
    if (value) this.setAttribute('hidden', '')
    else this.removeAttribute('hidden')
  }

  getAttribute(name: string) {
    return this.attributes.get(normalizeAttributeName(name)) ?? null
  }

  hasAttribute(name: string) {
    return this.attributes.has(normalizeAttributeName(name))
  }

  setAttribute(name: string, value: unknown) {
    const normalized = normalizeAttributeName(name)
    const serialized = String(value ?? '')
    this.attributes.set(normalized, serialized)
    Object.defineProperty(this.attributes, normalized, {
      configurable: true,
      enumerable: true,
      get: () => ({ name: normalized, value: this.attributes.get(normalized) ?? '' }),
    })
    notifyMutation({
      type: 'attributes',
      target: this,
      addedNodes: [],
      removedNodes: [],
      attributeName: normalized,
    })
  }

  removeAttribute(name: string) {
    const normalized = normalizeAttributeName(name)
    this.attributes.delete(normalized)
    delete (this.attributes as unknown as Record<string, unknown>)[normalized]
    notifyMutation({
      type: 'attributes',
      target: this,
      addedNodes: [],
      removedNodes: [],
      attributeName: normalized,
    })
  }

  matches(selector: string) {
    return selector.split(',').some((part) => {
      const trimmed = part.trim()
      return (
        Boolean(trimmed) && splitSelector(trimmed).length === 1 && selectorMatches(this, trimmed)
      )
    })
  }

  closest(selector: string) {
    let current: MiniNode | null = this
    while (current) {
      if (current instanceof MiniElement && current.matches(selector)) return current
      current = current.parentNode
    }
    return null
  }

  querySelectorAll(selector: string): MiniElement[] {
    const selectors = selector.split(',').map((part) => splitSelector(part))
    const all = descendants(this)
    return all.filter((element) =>
      selectors.some((parts) => {
        if (!parts.length) return false
        if (parts.length === 1) return selectorMatches(element, parts[0] ?? '')
        if (!selectorMatches(element, parts[parts.length - 1] ?? '')) return false
        let current: MiniNode | null = element.parentNode
        for (let index = parts.length - 2; index >= 0; index -= 1) {
          while (
            current &&
            !(current instanceof MiniElement && selectorMatches(current, parts[index] ?? ''))
          )
            current = current.parentNode
          if (!current) return false
          current = current.parentNode
        }
        return true
      }),
    )
  }

  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null
  }
}

/**
 * Small deterministic Canvas 2D surface.  It is intentionally not a visual
 * renderer; it implements the pixel/measurement methods used by the captured
 * anti-bot probes so the probes can run without a browser realm.
 */
export class MiniImageData {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray

  constructor(width: number, height: number, data?: Uint8ClampedArray) {
    this.width = Math.max(0, Math.floor(width))
    this.height = Math.max(0, Math.floor(height))
    this.data = data ?? new Uint8ClampedArray(this.width * this.height * 4)
  }
}

export class MiniCanvasGradient {
  readonly stops: Array<{ offset: number; color: string }> = []

  addColorStop(offset: number, color: string) {
    if (!Number.isFinite(offset) || offset < 0 || offset > 1)
      throw new DOMException('The offset is not a number.', 'IndexSizeError')
    this.stops.push({ offset, color: String(color) })
  }
}

const canvasColor = (value: unknown): [number, number, number, number] => {
  const color = String(value ?? '')
    .trim()
    .toLowerCase()
  const hex = color.match(/^#([0-9a-f]{3,8})$/i)?.[1]
  if (hex) {
    const expanded =
      hex.length === 3 || hex.length === 4 ? [...hex].map((v) => `${v}${v}`).join('') : hex
    const number = Number.parseInt(expanded, 16)
    if (expanded.length === 6)
      return [(number >>> 16) & 255, (number >>> 8) & 255, number & 255, 255]
    if (expanded.length === 8)
      return [(number >>> 24) & 255, (number >>> 16) & 255, (number >>> 8) & 255, number & 255]
  }
  const rgb = color
    .match(/^rgba?\(([^)]+)\)$/)?.[1]
    ?.split(',')
    .map((v) => Number.parseFloat(v.trim()))
  if (rgb && rgb.length >= 3)
    return [rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0, Math.round((rgb[3] ?? 1) * 255)]
  if (color === 'white') return [255, 255, 255, 255]
  if (color === 'red') return [255, 0, 0, 255]
  if (color === 'green') return [0, 128, 0, 255]
  if (color === 'blue') return [0, 0, 255, 255]
  return [0, 0, 0, 255]
}

export class MiniCanvasRenderingContext2D {
  readonly canvas: MiniHTMLCanvasElement
  fillStyle: unknown = '#000000'
  strokeStyle: unknown = '#000000'
  globalAlpha = 1
  globalCompositeOperation = 'source-over'
  lineWidth = 1
  lineCap = 'butt'
  lineJoin = 'miter'
  miterLimit = 10
  font = '10px sans-serif'
  textAlign = 'start'
  textBaseline = 'alphabetic'
  direction = 'inherit'
  imageSmoothingEnabled = true
  imageSmoothingQuality = 'low'
  filter = 'none'
  shadowBlur = 0
  shadowColor = 'rgba(0, 0, 0, 0)'
  shadowOffsetX = 0
  shadowOffsetY = 0
  #pixels: Uint8ClampedArray
  #stack: Array<Record<string, unknown>> = []

  constructor(canvas: MiniHTMLCanvasElement) {
    this.canvas = canvas
    this.#pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4)
  }

  #index(x: number, y: number) {
    return (y * this.canvas.width + x) * 4
  }

  #paint(x: number, y: number, color: [number, number, number, number]) {
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return
    const index = this.#index(x, y)
    const alpha = Math.max(0, Math.min(1, this.globalAlpha)) * (color[3] / 255)
    this.#pixels[index] = Math.round(color[0]! * alpha + (this.#pixels[index] ?? 0) * (1 - alpha))
    this.#pixels[index + 1] = Math.round(
      color[1]! * alpha + (this.#pixels[index + 1] ?? 0) * (1 - alpha),
    )
    this.#pixels[index + 2] = Math.round(
      color[2]! * alpha + (this.#pixels[index + 2] ?? 0) * (1 - alpha),
    )
    this.#pixels[index + 3] = Math.round(
      255 * (alpha + ((this.#pixels[index + 3] ?? 0) / 255) * (1 - alpha)),
    )
  }

  #resize() {
    this.#pixels = new Uint8ClampedArray(this.canvas.width * this.canvas.height * 4)
  }

  clearRect(x: number, y: number, width: number, height: number) {
    const left = Math.floor(x),
      top = Math.floor(y),
      right = Math.ceil(x + width),
      bottom = Math.ceil(y + height)
    for (let row = Math.max(0, top); row < Math.min(this.canvas.height, bottom); row++)
      for (let column = Math.max(0, left); column < Math.min(this.canvas.width, right); column++) {
        const index = this.#index(column, row)
        this.#pixels[index] =
          this.#pixels[index + 1] =
          this.#pixels[index + 2] =
          this.#pixels[index + 3] =
            0
      }
  }

  fillRect(x: number, y: number, width: number, height: number) {
    const left = Math.floor(Math.min(x, x + width)),
      top = Math.floor(Math.min(y, y + height))
    const right = Math.ceil(Math.max(x, x + width)),
      bottom = Math.ceil(Math.max(y, y + height))
    const color = canvasColor(this.fillStyle)
    for (let row = Math.max(0, top); row < Math.min(this.canvas.height, bottom); row++)
      for (let column = Math.max(0, left); column < Math.min(this.canvas.width, right); column++)
        this.#paint(column, row, color)
  }

  strokeRect(x: number, y: number, width: number, height: number) {
    this.fillRect(x, y, width, this.lineWidth)
    this.fillRect(x, y + height - this.lineWidth, width, this.lineWidth)
    this.fillRect(x, y, this.lineWidth, height)
    this.fillRect(x + width - this.lineWidth, y, this.lineWidth, height)
  }

  fillText(text: string, x: number, y: number, maxWidth?: number) {
    const value = String(text)
    const width = Math.max(1, Math.round(this.measureText(value).width))
    const height = Math.max(
      1,
      Math.round(
        this.font.match(/(\d+(?:\.\d+)?)px/)?.[1]
          ? Number(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1])
          : 10,
      ),
    )
    const limit =
      maxWidth === undefined ? width : Math.min(width, Math.max(0, Math.floor(maxWidth)))
    // A deterministic glyph-like pattern is enough for a pure TS surface and
    // avoids pretending that Node has the browser's font rasterizer.
    let hash = 2166136261
    for (const character of value)
      hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619) >>> 0
    for (let row = 0; row < height; row++)
      for (let column = 0; column < limit; column++)
        if (((hash + row * 31 + column * 17) & 7) < 3)
          this.#paint(
            Math.floor(x) + column,
            Math.floor(y) - height + row,
            canvasColor(this.fillStyle),
          )
  }

  strokeText(text: string, x: number, y: number, maxWidth?: number) {
    this.fillText(text, x, y, maxWidth)
  }

  measureText(text: string) {
    const size = Number(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 10)
    const width = [...String(text)].reduce(
      (total, character) => total + (character.codePointAt(0)! > 0xff ? size : size * 0.55),
      0,
    )
    return {
      width,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: width,
      actualBoundingBoxAscent: size,
      actualBoundingBoxDescent: 0,
      fontBoundingBoxAscent: size,
      fontBoundingBoxDescent: 0,
      emHeightAscent: size,
      emHeightDescent: 0,
      hangingBaseline: size,
      alphabeticBaseline: 0,
      ideographicBaseline: -size * 0.2,
    }
  }

  getImageData(sx: number, sy: number, sw: number, sh: number) {
    const width = Math.max(0, Math.floor(sw)),
      height = Math.max(0, Math.floor(sh))
    const data = new Uint8ClampedArray(width * height * 4)
    for (let row = 0; row < height; row++)
      for (let column = 0; column < width; column++) {
        const sourceX = Math.floor(sx) + column,
          sourceY = Math.floor(sy) + row
        if (
          sourceX < 0 ||
          sourceY < 0 ||
          sourceX >= this.canvas.width ||
          sourceY >= this.canvas.height
        )
          continue
        const from = this.#index(sourceX, sourceY),
          to = (row * width + column) * 4
        data.set(this.#pixels.subarray(from, from + 4), to)
      }
    return new MiniImageData(width, height, data)
  }

  putImageData(image: MiniImageData, dx: number, dy: number) {
    for (let row = 0; row < image.height; row++)
      for (let column = 0; column < image.width; column++) {
        const targetX = Math.floor(dx) + column,
          targetY = Math.floor(dy) + row
        if (
          targetX < 0 ||
          targetY < 0 ||
          targetX >= this.canvas.width ||
          targetY >= this.canvas.height
        )
          continue
        const from = (row * image.width + column) * 4
        this.#pixels.set(image.data.subarray(from, from + 4), this.#index(targetX, targetY))
      }
  }

  drawImage(source: unknown, ...args: number[]) {
    if (!(source instanceof MiniHTMLCanvasElement)) return
    const sourceContext = source.getContext('2d') as MiniCanvasRenderingContext2D
    const image = sourceContext.getImageData(0, 0, source.width, source.height)
    this.putImageData(image, args[args.length - 2] ?? 0, args[args.length - 1] ?? 0)
  }

  createLinearGradient(_x0: number, _y0: number, _x1: number, _y1: number) {
    return new MiniCanvasGradient()
  }
  createRadialGradient(
    _x0: number,
    _y0: number,
    _r0: number,
    _x1: number,
    _y1: number,
    _r1: number,
  ) {
    return new MiniCanvasGradient()
  }
  createPattern() {
    return null
  }
  beginPath() {}
  closePath() {}
  moveTo(_x: number, _y: number) {}
  lineTo(_x: number, _y: number) {}
  bezierCurveTo(
    _cp1x: number,
    _cp1y: number,
    _cp2x: number,
    _cp2y: number,
    _x: number,
    _y: number,
  ) {}
  quadraticCurveTo(_cpx: number, _cpy: number, _x: number, _y: number) {}
  arc(
    _x: number,
    _y: number,
    _radius: number,
    _start: number,
    _end: number,
    _anticlockwise?: boolean,
  ) {}
  arcTo(_x1: number, _y1: number, _x2: number, _y2: number, _radius: number) {}
  rect(_x: number, _y: number, _width: number, _height: number) {}
  fill() {}
  stroke() {}
  clip() {}
  isPointInPath() {
    return false
  }
  isPointInStroke() {
    return false
  }
  save() {
    this.#stack.push({
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      globalAlpha: this.globalAlpha,
      font: this.font,
      lineWidth: this.lineWidth,
    })
  }
  restore() {
    const value = this.#stack.pop()
    if (!value) return
    Object.assign(this, value)
  }
  reset() {
    this.#stack.length = 0
    this.#resize()
  }
  setTransform() {}
  resetTransform() {}
  transform() {}
  translate() {}
  rotate() {}
  scale() {}
  getTransform() {
    return {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 0,
      is2D: true,
      toString: () => 'matrix(1, 0, 0, 1, 0, 0)',
    }
  }
  createImageData(width: number | MiniImageData, height?: number) {
    return width instanceof MiniImageData
      ? new MiniImageData(width.width, width.height)
      : new MiniImageData(width, height ?? width)
  }
}

const transparentPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

export class MiniHTMLCanvasElement extends MiniElement {
  #width = 300
  #height = 150
  #contexts = new Map<string, unknown>()

  constructor(ownerDocument: MiniDocument | null = null, attributes?: Map<string, string>) {
    super(ownerDocument, 'canvas', attributes)
    if (attributes?.has('width')) this.#width = Number(attributes.get('width')) || 300
    if (attributes?.has('height')) this.#height = Number(attributes.get('height')) || 150
  }

  get width() {
    return this.#width
  }
  set width(value: number) {
    this.#width = Math.max(0, Math.floor(Number(value) || 0))
    ;(this.#contexts.get('2d') as MiniCanvasRenderingContext2D | undefined)?.reset()
  }
  get height() {
    return this.#height
  }
  set height(value: number) {
    this.#height = Math.max(0, Math.floor(Number(value) || 0))
    ;(this.#contexts.get('2d') as MiniCanvasRenderingContext2D | undefined)?.reset()
  }

  getContext(contextId: string, _options?: unknown) {
    const id = String(contextId).toLowerCase()
    if (id === '2d') {
      let context = this.#contexts.get(id)
      if (!context) {
        context = new MiniCanvasRenderingContext2D(this)
        this.#contexts.set(id, context)
      }
      return context
    }
    if (id === 'webgl' || id === 'experimental-webgl') {
      let context = this.#contexts.get('webgl')
      if (!context) {
        context = new MiniWebGLRenderingContext(this)
        this.#contexts.set('webgl', context)
      }
      return context
    }
    if (id === 'webgl2') {
      let context = this.#contexts.get('webgl2')
      if (!context) {
        context = new MiniWebGL2RenderingContext(this)
        this.#contexts.set('webgl2', context)
      }
      return context
    }
    return null
  }

  toDataURL(_type = 'image/png') {
    return `data:image/png;base64,${transparentPng}`
  }
  toBlob(callback: (blob: Blob | null) => void, type = 'image/png') {
    callback(new Blob([Buffer.from(transparentPng, 'base64')], { type }))
  }
}

export class MiniOffscreenCanvas extends MiniHTMLCanvasElement {
  constructor(width: number, height: number) {
    super(null)
    this.width = width
    this.height = height
  }

  convertToBlob() {
    return Promise.resolve(
      new Blob([Uint8Array.from(atob(transparentPng), (value) => value.charCodeAt(0))], {
        type: 'image/png',
      }),
    )
  }
}

class MiniWebGLObject {
  readonly kind: string
  constructor(kind: string) {
    this.kind = kind
  }
}

export class MiniWebGLRenderingContext {
  readonly canvas: MiniHTMLCanvasElement
  readonly VERTEX_SHADER = 35633
  readonly FRAGMENT_SHADER = 35632
  readonly COMPILE_STATUS = 35713
  readonly LINK_STATUS = 35714
  readonly ARRAY_BUFFER = 34962
  readonly ELEMENT_ARRAY_BUFFER = 34963
  readonly STATIC_DRAW = 35044
  readonly FLOAT = 5126
  readonly TRIANGLES = 4
  readonly TRIANGLE_STRIP = 5
  readonly COLOR_BUFFER_BIT = 16384
  readonly DEPTH_BUFFER_BIT = 256
  readonly BLEND = 3042
  readonly SRC_ALPHA = 770
  readonly ONE_MINUS_SRC_ALPHA = 771
  readonly ONE = 1
  readonly ZERO = 0
  readonly RGBA = 6408
  readonly UNSIGNED_BYTE = 5121
  readonly MAX_TEXTURE_SIZE = 3379
  readonly MAX_VERTEX_ATTRIBS = 34921
  readonly MAX_VERTEX_UNIFORM_VECTORS = 36347
  readonly MAX_FRAGMENT_UNIFORM_VECTORS = 36349
  readonly VENDOR = 7936
  readonly RENDERER = 7937
  readonly VERSION = 7938
  readonly SHADING_LANGUAGE_VERSION = 35724
  readonly MAX_VIEWPORT_DIMS = 3386
  readonly ALIASED_LINE_WIDTH_RANGE = 33902
  readonly MAX_VARYING_VECTORS = 36348
  readonly MAX_VERTEX_TEXTURE_IMAGE_UNITS = 35660
  readonly MAX_TEXTURE_IMAGE_UNITS = 34930
  readonly ALIASED_POINT_SIZE_RANGE = 33901
  readonly ALPHA_BITS = 3413
  readonly RED_BITS = 3410
  readonly GREEN_BITS = 3411
  readonly BLUE_BITS = 3412
  readonly drawingBufferWidth: number
  readonly drawingBufferHeight: number
  readonly drawingBufferColorSpace = 'srgb'
  readonly unpackColorSpace = 'srgb'
  constructor(canvas: MiniHTMLCanvasElement) {
    this.canvas = canvas
    this.drawingBufferWidth = canvas.width
    this.drawingBufferHeight = canvas.height
  }
  createShader(type: number) {
    return new MiniWebGLObject(`shader:${type}`)
  }
  shaderSource() {}
  compileShader() {}
  getShaderParameter(_shader: unknown, parameter: number) {
    return parameter === this.COMPILE_STATUS
  }
  getShaderInfoLog() {
    return ''
  }
  getShaderPrecisionFormat(_shaderType: number, _precisionType: number) {
    return { precision: 23, rangeMin: 127, rangeMax: 127 }
  }
  createProgram() {
    return new MiniWebGLObject('program')
  }
  attachShader() {}
  linkProgram() {}
  getProgramParameter(_program: unknown, parameter: number) {
    return parameter === this.LINK_STATUS
  }
  getProgramInfoLog() {
    return ''
  }
  useProgram() {}
  createBuffer() {
    return new MiniWebGLObject('buffer')
  }
  bindBuffer() {}
  bufferData() {}
  enableVertexAttribArray() {}
  vertexAttribPointer() {}
  getAttribLocation(_program: unknown, name: string) {
    return name ? 0 : -1
  }
  getUniformLocation(_program: unknown, name: string) {
    return name ? new MiniWebGLObject(`uniform:${name}`) : null
  }
  uniformMatrix3fv() {}
  uniform4fv() {}
  viewport() {}
  clearColor() {}
  clear() {}
  enable() {}
  blendFunc() {}
  drawArrays() {}
  readPixels(
    _x: number,
    _y: number,
    width: number,
    height: number,
    _format: number,
    _type: number,
    pixels: ArrayBufferView,
  ) {
    if (pixels instanceof Uint8Array) pixels.fill(0, 0, Math.min(pixels.length, width * height * 4))
  }
  getError() {
    return 0
  }
  getContextAttributes() {
    return {
      alpha: true,
      antialias: true,
      depth: true,
      desynchronized: false,
      failIfMajorPerformanceCaveat: false,
      powerPreference: 'default',
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      stencil: false,
    }
  }
  getSupportedExtensions() {
    return [
      'ANGLE_instanced_arrays',
      'EXT_blend_minmax',
      'EXT_clip_control',
      'EXT_color_buffer_half_float',
      'EXT_depth_clamp',
      'EXT_float_blend',
      'EXT_frag_depth',
      'EXT_polygon_offset_clamp',
      'EXT_shader_texture_lod',
      'EXT_texture_compression_bptc',
      'EXT_texture_compression_rgtc',
      'EXT_texture_filter_anisotropic',
      'EXT_texture_mirror_clamp_to_edge',
      'EXT_sRGB',
      'OES_element_index_uint',
      'OES_fbo_render_mipmap',
      'OES_standard_derivatives',
      'OES_texture_float',
      'OES_texture_float_linear',
      'OES_texture_half_float',
      'OES_texture_half_float_linear',
      'OES_vertex_array_object',
      'WEBGL_blend_func_extended',
      'WEBGL_color_buffer_float',
      'WEBGL_compressed_texture_s3tc',
      'WEBGL_debug_renderer_info',
      'WEBGL_debug_shaders',
      'WEBGL_depth_texture',
      'WEBGL_draw_buffers',
      'WEBGL_lose_context',
      'WEBGL_multi_draw',
    ]
  }
  getExtension(name: string) {
    if (name === 'WEBGL_debug_renderer_info')
      return { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 }
    if (
      name === 'EXT_texture_filter_anisotropic' ||
      name === 'WEBKIT_EXT_texture_filter_anisotropic' ||
      name === 'MOZ_EXT_texture_filter_anisotropic'
    )
      return { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 34047 }
    if (name === 'WEBGL_lose_context') return { loseContext() {}, restoreContext() {} }
    return {}
  }
  getParameter(parameter: number) {
    const values: Record<number, unknown> = {
      [this.MAX_TEXTURE_SIZE]: 8192,
      [this.MAX_VERTEX_ATTRIBS]: 16,
      [this.MAX_VERTEX_UNIFORM_VECTORS]: 1024,
      [this.MAX_FRAGMENT_UNIFORM_VECTORS]: 1024,
      [this.VENDOR]: 'WebKit',
      [this.RENDERER]: 'WebKit WebGL',
      [this.VERSION]: 'WebGL 1.0',
      [this.SHADING_LANGUAGE_VERSION]: 'WebGL GLSL ES 1.0',
      [this.ALPHA_BITS]: 8,
      [this.RED_BITS]: 8,
      [this.GREEN_BITS]: 8,
      [this.BLUE_BITS]: 8,
      [37445]: 'Google Inc. (Google)',
      [37446]: 'ANGLE (Google, Vulkan 1.3.0)',
      [this.MAX_VIEWPORT_DIMS]: new Int32Array([300, 300]),
      [this.ALIASED_LINE_WIDTH_RANGE]: new Float32Array([1, 1]),
      [this.MAX_VARYING_VECTORS]: 30,
      [this.MAX_VERTEX_TEXTURE_IMAGE_UNITS]: 16,
      [this.MAX_TEXTURE_IMAGE_UNITS]: 16,
      [this.ALIASED_POINT_SIZE_RANGE]: new Float32Array([1, 1024]),
      [34047]: 16,
      [3414]: 24,
      [35661]: 16,
      [34076]: 8192,
      [34024]: 8192,
    }
    return values[parameter] ?? 0
  }
}

export class MiniWebGL2RenderingContext extends MiniWebGLRenderingContext {
  readonly READ_BUFFER = 3074
}

export class MiniHTMLMediaElement extends MiniElement {
  currentTime = 0
  duration = Number.NaN
  playbackRate = 1
  volume = 1
  muted = false
  paused = true
  ended = false
  readyState = 4
  canPlayType(type: string) {
    return /^(audio|video)\/(mpeg|mp4|webm|ogg|wav|aac|flac)/i.test(String(type)) ? 'probably' : ''
  }
  load() {
    this.dispatchEvent(new MiniEvent('load'))
  }
  play() {
    this.paused = false
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
}
export class MiniHTMLImageElement extends MiniElement {
  readonly complete = true
  readonly naturalWidth = 1
  readonly naturalHeight = 1
  #src = ''
  #onload: ((event: MiniEvent) => unknown) | null = null
  constructor(ownerDocument: MiniDocument | null = null, attributes?: Map<string, string>) {
    super(ownerDocument, 'img', attributes)
    this.#src = this.getAttribute('src') ?? ''
    this.addEventListener('load', (event) => this.#onload?.(event))
  }
  get src() {
    return this.#src
  }
  set src(value: string) {
    this.#src = String(value)
    this.setAttribute('src', this.#src)
    queueMicrotask(() => this.dispatchEvent(new MiniEvent('load', { isTrusted: true })))
  }
  get onload() {
    return this.#onload
  }
  set onload(value: ((event: MiniEvent) => unknown) | null) {
    this.#onload = typeof value === 'function' ? value : null
  }
}
export class MiniHTMLAudioElement extends MiniHTMLMediaElement {
  constructor(ownerDocument: MiniDocument | null = null, attributes?: Map<string, string>) {
    super(ownerDocument, 'audio', attributes)
  }
}
export class MiniHTMLVideoElement extends MiniHTMLMediaElement {
  constructor(ownerDocument: MiniDocument | null = null, attributes?: Map<string, string>) {
    super(ownerDocument, 'video', attributes)
  }
}

export class MiniAudioBuffer {
  readonly length: number
  readonly sampleRate: number
  readonly numberOfChannels: number
  readonly duration: number
  constructor(length = 1, sampleRate = 44100, channels = 1) {
    this.length = length
    this.sampleRate = sampleRate
    this.numberOfChannels = channels
    this.duration = length / sampleRate
  }
  getChannelData() {
    return new Float32Array(this.length)
  }
}
export class MiniAudioContext {
  readonly sampleRate = 44100
  readonly currentTime = 0
  readonly destination = {}
  createOscillator() {
    return { connect() {}, start() {}, stop() {} }
  }
  createGain() {
    return { gain: { value: 1 }, connect() {} }
  }
  createAnalyser() {
    return { connect() {}, getFloatFrequencyData() {} }
  }
  close() {
    return Promise.resolve()
  }
}
export class MiniOfflineAudioContext extends MiniAudioContext {
  readonly length: number
  constructor(_channels: number, length: number, _sampleRate: number) {
    super()
    this.length = length
  }
  startRendering() {
    return Promise.resolve(new MiniAudioBuffer(this.length))
  }
}

export class MiniHTMLAnchorElement extends MiniElement {
  constructor(ownerDocument: MiniDocument | null, attributes?: Map<string, string>) {
    super(ownerDocument, 'a', attributes)
  }

  get href() {
    try {
      return new URL(this.getAttribute('href') ?? '', this.ownerDocument?.url ?? 'about:blank').href
    } catch {
      return this.getAttribute('href') ?? ''
    }
  }

  set href(value: string) {
    this.setAttribute('href', value)
  }

  get protocol() {
    return new URL(this.href).protocol
  }

  get hostname() {
    return new URL(this.href).hostname
  }

  get host() {
    return new URL(this.href).host
  }

  get port() {
    return new URL(this.href).port
  }

  get pathname() {
    return new URL(this.href).pathname
  }

  get search() {
    return new URL(this.href).search
  }

  get hash() {
    return new URL(this.href).hash
  }
}

/** Live-enough form controls collection used by browser code that validates
 * the form owner before inserting generated controls. */
export class MiniHTMLFormControlsCollection extends Array<MiniElement> {
  item(index: number) {
    return this[index] ?? null
  }

  namedItem(name: string) {
    return this.find((control) => control.name === name || control.id === name) ?? null
  }
}

export class MiniHTMLFormElement extends MiniElement {
  constructor(ownerDocument: MiniDocument | null, attributes?: Map<string, string>) {
    super(ownerDocument, 'form', attributes)
  }

  get action() {
    try {
      return new URL(this.getAttribute('action') ?? '', this.ownerDocument?.url ?? 'about:blank')
        .href
    } catch {
      return this.getAttribute('action') ?? ''
    }
  }

  set action(value: string) {
    this.setAttribute('action', value)
  }

  get method() {
    return (this.getAttribute('method') ?? 'get').toLowerCase()
  }

  get elements() {
    const controls = new MiniHTMLFormControlsCollection(
      ...this.querySelectorAll('input,select,textarea'),
    )
    for (const control of controls) {
      if (control.name && !(control.name in controls))
        Object.defineProperty(controls, control.name, { configurable: true, value: control })
      if (control.id && !(control.id in controls))
        Object.defineProperty(controls, control.id, { configurable: true, value: control })
    }
    return controls
  }

  set method(value: string) {
    this.setAttribute('method', value)
  }

  get noValidate() {
    return this.hasAttribute('novalidate')
  }

  set noValidate(value: boolean) {
    if (value) this.setAttribute('novalidate', '')
    else this.removeAttribute('novalidate')
  }

  get enctype() {
    return this.getAttribute('enctype') ?? 'application/x-www-form-urlencoded'
  }

  set enctype(value: string) {
    this.setAttribute('enctype', value)
  }

  /** HTMLFormElement.add() is used by the generated anti-bot submit path. */
  add(element: MiniElement, before?: MiniElement | number | null) {
    const reference =
      typeof before === 'number' ? (this.elements[before] ?? null) : (before ?? null)
    this.insertBefore(element, reference)
  }

  submit() {
    return undefined
  }

  checkValidity() {
    return true
  }

  reportValidity() {
    return this.checkValidity()
  }

  requestSubmit(submitter?: MiniElement | null) {
    if (submitter && submitter.form !== this)
      throw new TypeError('The specified element is not owned by this form element')
    const event = new MiniEvent('submit', {
      bubbles: true,
      cancelable: true,
      isTrusted: true,
    })
    event.submitter = submitter ?? null
    if (this.dispatchEvent(event) && !event.defaultPrevented) this.submit()
  }

  reset() {
    return undefined
  }
}

export class MiniXMLHttpRequest extends MiniEventTarget {
  static readonly UNSENT = 0
  static readonly OPENED = 1
  static readonly HEADERS_RECEIVED = 2
  static readonly LOADING = 3
  static readonly DONE = 4
  readyState = MiniXMLHttpRequest.UNSENT
  timeout = 0
  status = 0
  response = null
  responseText = ''
  responseType = ''
  withCredentials = false
  onreadystatechange: (() => unknown) | null = null
  onload: (() => unknown) | null = null
  onerror: ((event: unknown) => unknown) | null = null
  #headers = new Headers()

  open(_method: string, _url: string | URL, _async = true) {
    this.readyState = MiniXMLHttpRequest.OPENED
    this.onreadystatechange?.()
  }

  setRequestHeader(name: string, value: string) {
    if (this.readyState !== MiniXMLHttpRequest.OPENED)
      throw new Error("Failed to execute 'setRequestHeader': XMLHttpRequest is not opened.")
    this.#headers.set(name, value)
  }

  getResponseHeader(name: string) {
    return this.#headers.get(name)
  }

  send(_body?: unknown) {
    if (this.readyState !== MiniXMLHttpRequest.OPENED)
      throw new Error('XMLHttpRequest is not opened')
    this.status = 204
    this.readyState = MiniXMLHttpRequest.DONE
    this.onreadystatechange?.()
    this.onload?.()
  }

  abort() {
    this.readyState = MiniXMLHttpRequest.UNSENT
  }
}

export class MiniDOMParser {
  parseFromString(value: string, _type: string) {
    const document = new MiniDocument('about:blank')
    document.write(value)
    return document
  }
}

export class MiniHTMLIFrameElement extends MiniElement {
  #contentWindow: MiniWindow
  #contentDocument: MiniDocument
  #onload: ((event: MiniEvent) => unknown) | null = null
  #loaded = false

  constructor(ownerDocument: MiniDocument | null, attributes?: Map<string, string>) {
    super(ownerDocument, 'iframe', attributes)
    const frame = createMiniWindow('about:blank')
    this.#contentWindow = frame
    this.#contentDocument = frame.document
    frame.document.defaultView = frame
    ;(frame as unknown as Record<string, unknown>).console =
      (ownerDocument?.defaultView as Record<string, unknown> | null)?.console ?? console
    frame.frameElement = this
    this.addEventListener('load', (event) => this.#onload?.(event))
  }

  get contentWindow() {
    return this.#contentWindow
  }

  get contentDocument() {
    return this.#contentDocument
  }

  get src() {
    const value = this.getAttribute('src')
    if (!value) return ''
    try {
      return new URL(value, this.ownerDocument?.url ?? 'about:blank').href
    } catch {
      return value
    }
  }

  set src(value: string) {
    this.setAttribute('src', value)
  }

  get onload() {
    return this.#onload
  }

  set onload(value: ((event: MiniEvent) => unknown) | null) {
    this.#onload = typeof value === 'function' ? value : null
  }

  /** @internal */
  scheduleLoad() {
    if (this.#loaded) return
    this.#loaded = true
    queueMicrotask(() => this.dispatchEvent(new MiniEvent('load', { isTrusted: true })))
  }
}

export class MiniHTMLScriptElement extends MiniElement {
  constructor(ownerDocument: MiniDocument | null, attributes?: Map<string, string>) {
    super(ownerDocument, 'script', attributes)
  }

  get src() {
    const value = this.getAttribute('src')
    if (!value) return ''
    try {
      return new URL(value, this.ownerDocument?.url ?? 'about:blank').href
    } catch {
      return value
    }
  }

  set src(value: string) {
    this.setAttribute('src', value)
  }

  get async() {
    return this.hasAttribute('async')
  }

  set async(value: boolean) {
    if (value) this.setAttribute('async', '')
    else this.removeAttribute('async')
  }

  get nonce() {
    return this.getAttribute('nonce') ?? ''
  }

  set nonce(value: string) {
    this.setAttribute('nonce', value)
  }
}

export class MiniFontFaceSet extends MiniEventTarget {
  readonly status = 'loaded'
  readonly ready = Promise.resolve(this)
  #faces: unknown[] = []
  check(_font: string, _text?: string) {
    return true
  }
  add(face: unknown) {
    if (!this.#faces.includes(face)) this.#faces.push(face)
    return this
  }
  delete(face: unknown) {
    const index = this.#faces.indexOf(face)
    if (index < 0) return false
    this.#faces.splice(index, 1)
    return true
  }
  clear() {
    this.#faces = []
  }
  forEach(callback: (face: unknown, same: unknown, set: MiniFontFaceSet) => unknown) {
    for (const face of this.#faces) callback(face, face, this)
  }
  get size() {
    return this.#faces.length
  }
}

export class MiniDocument extends MiniNode {
  readonly nodeType = 9
  readonly url: string
  readonly URL: string
  readonly documentURI: string
  readonly documentElement: MiniElement
  readonly head: MiniElement
  readonly body: MiniElement
  currentScript: MiniHTMLScriptElement | null = null
  defaultView: unknown = null
  readyState = 'complete'
  characterSet = 'UTF-8'
  documentMode = undefined
  cookie = ''
  readonly fonts = new MiniFontFaceSet()
  #activeElement: MiniElement | null = null

  constructor(url: string) {
    super(null)
    this.url = url
    this.URL = url
    this.documentURI = url
    this.documentElement = new MiniElement(this, 'html')
    this.head = new MiniElement(this, 'head')
    this.body = new MiniElement(this, 'body')
    this.appendChild(this.documentElement)
    this.documentElement.appendChild(this.head)
    this.documentElement.appendChild(this.body)
  }

  get location() {
    return (this.defaultView as MiniWindow | null)?.location ?? new URL(this.url)
  }

  get baseURI() {
    return this.url
  }

  get referrer() {
    return ''
  }

  get domain() {
    try {
      return new URL(this.url).hostname
    } catch {
      return ''
    }
  }

  get forms() {
    return this.getElementsByTagName('form')
  }

  get activeElement() {
    return this.#activeElement ?? this.body
  }

  /** @internal */
  _setActiveElement(element: MiniElement | null) {
    this.#activeElement = element
  }

  get hidden() {
    return false
  }

  get visibilityState() {
    return 'visible'
  }

  createElement(tagName: string) {
    const tag = tagName.toLowerCase()
    if (tag === 'a') return new MiniHTMLAnchorElement(this)
    if (tag === 'form') return new MiniHTMLFormElement(this)
    if (tag === 'canvas') return new MiniHTMLCanvasElement(this)
    if (tag === 'audio') return new MiniHTMLAudioElement(this)
    if (tag === 'video') return new MiniHTMLVideoElement(this)
    if (tag === 'img') return new MiniHTMLImageElement(this)
    if (tag === 'iframe') return new MiniHTMLIFrameElement(this)
    if (tag === 'script') return new MiniHTMLScriptElement(this)
    return new MiniElement(this, tag)
  }

  createTextNode(value: string) {
    return new MiniText(this, value)
  }

  createDocumentFragment() {
    return new MiniDocumentFragment(this)
  }

  createEvent(type: string) {
    return type.toLowerCase() === 'customevent' ? new MiniCustomEvent('') : new MiniEvent('')
  }

  querySelectorAll(selector: string) {
    const results: MiniElement[] = []
    if (selector.split(',').some((part) => selectorMatches(this.documentElement, part.trim())))
      results.push(this.documentElement)
    results.push(...this.documentElement.querySelectorAll(selector))
    return results
  }

  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null
  }

  getElementsByTagName(tagName: string) {
    const tag = tagName.toLowerCase()
    return this.documentElement
      .querySelectorAll('*')
      .filter((element) => tag === '*' || element.tagName.toLowerCase() === tag)
  }

  getElementsByClassName(className: string) {
    return this.documentElement
      .querySelectorAll('*')
      .filter((element) => element.classList.contains(className))
  }

  write(html: string) {
    parseHTML(this, html)
  }

  close() {
    this.readyState = 'complete'
  }
}

const voidTags = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

const appendParsedElement = (
  document: MiniDocument,
  parent: MiniNode,
  tagName: string,
  attributes: Map<string, string>,
) => {
  const element = document.createElement(tagName)
  for (const [name, value] of attributes) element.setAttribute(name, value)
  parent.appendChild(element)
  return element
}

const tokenPattern = /<!--[\s\S]*?-->|<![^>]*>|<script\b[^>]*>[\s\S]*?<\/script\s*>|<[^>]+>|[^<]+/gi

const serializeAttribute = (name: string, value: string) =>
  ` ${name}="${value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`

const serializeElement = (element: MiniElement): string => {
  const attributes = [...element.attributes]
    .map(([name, value]) => serializeAttribute(name, value))
    .join('')
  if (voidTags.has(element.tagName.toLowerCase()))
    return `<${element.tagName.toLowerCase()}${attributes}>`
  return `<${element.tagName.toLowerCase()}${attributes}>${element.childNodes.map((child) => serializeNode(child)).join('')}</${element.tagName.toLowerCase()}>`
}

const serializeNode = (node: MiniNode): string =>
  node instanceof MiniElement ? serializeElement(node) : node instanceof MiniText ? node.data : ''

const parseFragment = (document: MiniDocument | null, parent: MiniNode, html: string) => {
  if (!document) return
  const stack: MiniNode[] = [parent]
  for (const match of html.matchAll(tokenPattern)) {
    const token = match[0] ?? ''
    if (!token || /^<!--|^<!doctype|^<!\[/i.test(token)) continue
    const current = stack[stack.length - 1] ?? parent
    if (/^<script\b/i.test(token)) {
      const open = token.match(/^<script\b([^>]*)>/i)
      const close = token.match(/<\/script\s*>$/i)
      const script = appendParsedElement(
        document,
        current,
        'script',
        parseAttributes(open?.[1] ?? ''),
      )
      const body = token.slice(open?.[0].length ?? 0, close?.index ?? token.length)
      if (body) script.appendChild(document.createTextNode(body))
      continue
    }
    const closing = token.match(/^<\/\s*([\w:-]+)\s*>$/)
    if (closing) {
      const tag = closing[1]?.toUpperCase()
      for (let index = stack.length - 1; index > 0; index -= 1) {
        const candidate = stack[index]
        if (candidate instanceof MiniElement && candidate.tagName === tag) {
          stack.length = index
          break
        }
      }
      continue
    }
    const opening = token.match(/^<\s*([\w:-]+)([^>]*)>$/)
    if (opening) {
      const element = appendParsedElement(
        document,
        current,
        opening[1] ?? 'div',
        parseAttributes(opening[2] ?? ''),
      )
      if (!voidTags.has((opening[1] ?? '').toLowerCase()) && !/\/\s*>$/.test(token))
        stack.push(element)
      continue
    }
    current.appendChild(document.createTextNode(decodeEntities(token)))
  }
}

/** Parses the static HTML form without executing inline or external scripts. */
export const parseHTML = (document: MiniDocument, html: string) => {
  document.head.parentNode = null
  document.body.parentNode = null
  document.documentElement.childNodes = []
  document.documentElement.appendChild(document.head)
  document.documentElement.appendChild(document.body)
  document.head.childNodes = []
  document.body.childNodes = []
  parseFragment(document, document.body, html)
}

export class MiniMutationObserver {
  readonly #callback: (records: MiniMutationRecord[], observer: MiniMutationObserver) => unknown
  #target: MiniNode | null = null
  #options: Record<string, unknown> = {}
  #records: MiniMutationRecord[] = []
  #scheduled = false

  constructor(callback: (...args: unknown[]) => unknown) {
    this.#callback = callback as (
      records: MiniMutationRecord[],
      observer: MiniMutationObserver,
    ) => unknown
    mutationObservers.add(this)
  }

  observe(target: unknown, options: Record<string, unknown> = {}) {
    if (!(target instanceof MiniNode))
      throw new TypeError("Failed to execute 'observe': target is not a Node")
    if (!options.childList && !options.attributes && !options.characterData)
      throw new TypeError('MutationObserver.observe requires a mutation type')
    this.#target = target
    this.#options = { ...options }
  }

  disconnect() {
    this.#target = null
    this.#records = []
  }

  takeRecords(): MiniMutationRecord[] {
    const records = this.#records
    this.#records = []
    return records
  }

  enqueue(record: MiniMutationRecord) {
    if (!this.#target) return
    let current: MiniNode | null = record.target
    let isSubtree = false
    while (current) {
      if (current === this.#target) {
        isSubtree = current !== record.target
        break
      }
      current = current.parentNode
    }
    if (!current || (isSubtree && !this.#options.subtree)) return
    if (record.type === 'childList' && !this.#options.childList) return
    if (record.type === 'attributes' && !this.#options.attributes) return
    this.#records.push(record)
    if (this.#scheduled) return
    this.#scheduled = true
    queueMicrotask(() => {
      this.#scheduled = false
      const records = this.takeRecords()
      if (!records.length) return
      try {
        this.#callback(records, this)
      } catch {
        // Browser observers report callback errors asynchronously.
      }
    })
  }
}

export class MiniWindow extends MiniEventTarget {
  readonly document: MiniDocument
  readonly navigator: Record<string, unknown>
  readonly screen = { width: 412, height: 915, colorDepth: 24, pixelDepth: 24 }
  readonly performance = {
    now: () => Number(process.hrtime.bigint() % 1_000_000_000n) / 1_000_000,
    timeOrigin: Date.now(),
    getEntriesByType: () => [],
    getEntriesByName: () => [],
  }
  readonly location: URL & { assign?: (value: string) => void; replace?: (value: string) => void }
  readonly top: MiniWindow
  readonly parent: MiniWindow
  frameElement: MiniHTMLIFrameElement | null = null
  innerWidth = 412
  innerHeight = 915
  outerWidth = 412
  outerHeight = 915
  devicePixelRatio = 2
  chrome = { runtime: {} }
  onerror: ((event: unknown) => unknown) | null = null
  onload: (() => unknown) | null = null
  readonly Function = Function

  constructor(url: string) {
    super()
    this.document = new MiniDocument(url)
    this.navigator = {
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit/537.36 Chrome/146.0.0.0 Mobile Safari/537.36',
      appVersion: 'Mozilla/5.0',
      appName: 'Netscape',
      platform: 'Linux armv81',
      oscpu: 'Linux armv81',
      language: 'ja-JP',
      languages: ['ja-JP', 'ja', 'en-US'],
      cookieEnabled: true,
      hardwareConcurrency: 4,
      maxTouchPoints: 5,
      webdriver: false,
      plugins: [],
      mimeTypes: [],
    }
    const location = new URL(url) as URL & {
      assign?: (value: string) => void
      replace?: (value: string) => void
    }
    location.assign = (value: string) => Object.assign(location, new URL(value, location.href))
    location.replace = location.assign
    this.location = location
    this.top = this
    this.parent = this
  }

  get window() {
    return this
  }

  get self() {
    return this
  }

  get globalThis() {
    return this
  }

  get global() {
    return this
  }

  get HTMLAnchorElement() {
    return MiniHTMLAnchorElement
  }

  get HTMLFormElement() {
    return MiniHTMLFormElement
  }

  get HTMLIFrameElement() {
    return MiniHTMLIFrameElement
  }

  get Event() {
    return MiniEvent
  }

  get CustomEvent() {
    return MiniCustomEvent
  }

  get MutationObserver() {
    return MiniMutationObserver
  }

  close() {
    // Timers are owned by the caller; this method mirrors Window.close().
  }
}

export const createMiniWindow = (url: string | URL) => new MiniWindow(String(url))

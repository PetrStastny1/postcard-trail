type Attributes = Record<string, string | boolean | undefined>

/** Builds a DOM element. `true` sets an empty attribute, `false` and `undefined` leave it out. */
export function element<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  attributes: Attributes = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[Tag] {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) {
    if (value === true) node.setAttribute(name, '')
    else if (typeof value === 'string') node.setAttribute(name, value)
  }
  node.append(...children)
  return node
}

/** Inline icons from the prototype; they are decorative, the button carries the name. */
export const icons = {
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14" /></svg>',
  enlarge: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M10 2h4" /></svg>',
  video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="14" height="14" rx="2" /><path d="m16 10 6-4v12l-6-4" /></svg>',
  skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 5 9 7-9 7zM19 5v14" /></svg>',
} as const

/** A decorative icon inside a labelled control or text. */
export function icon(name: keyof typeof icons, attributes: Attributes = {}): HTMLSpanElement {
  const holder = element('span', attributes)
  holder.innerHTML = icons[name]
  return holder
}

export function iconButton(icon: keyof typeof icons, label: string, attributes: Attributes = {}): HTMLButtonElement {
  const button = element('button', { class: 'icon-button', type: 'button', 'aria-label': label, ...attributes })
  button.innerHTML = icons[icon]
  return button
}

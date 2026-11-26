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
} as const

export function iconButton(icon: keyof typeof icons, label: string, attributes: Attributes = {}): HTMLButtonElement {
  const button = element('button', { class: 'icon-button', type: 'button', 'aria-label': label, ...attributes })
  button.innerHTML = icons[icon]
  return button
}

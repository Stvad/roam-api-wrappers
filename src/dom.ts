export type TextElement = HTMLTextAreaElement | HTMLInputElement

export function getActiveEditElement(): TextElement | null {
    const element = document.activeElement

    // document.activeElement can be either `document.body` or `null`
    // https://developer.mozilla.org/en-US/docs/Web/API/DocumentOrShadowRoot/activeElement
    if (!element || !isEditElement(element)) return null

    return element
}

const isEditElement = (element: Element): element is TextElement  =>
    element.tagName === 'INPUT' || element.tagName === 'TEXTAREA'

// @ts-check
// Small DOM helpers shared across screens and chrome.

/**
 * getElementById, typed as a non-null HTMLElement (mockup markup guarantees it).
 * @param {string} id
 * @returns {HTMLElement}
 */
export function $(id) {
  return /** @type {HTMLElement} */ (document.getElementById(id));
}

/**
 * Query a single element within a root, typed as HTMLElement.
 * @param {ParentNode} root
 * @param {string} sel
 * @returns {HTMLElement | null}
 */
export function q(root, sel) {
  return /** @type {HTMLElement | null} */ (root.querySelector(sel));
}

/**
 * Query all matching elements as an HTMLElement array.
 * @param {ParentNode} root
 * @param {string} sel
 * @returns {HTMLElement[]}
 */
export function qa(root, sel) {
  return /** @type {HTMLElement[]} */ (Array.from(root.querySelectorAll(sel)));
}

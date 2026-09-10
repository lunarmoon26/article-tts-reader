import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const url = "https://blog.haochuanz.net/posts/distributing-agentic-capabilities";
const response = await fetch(url);
assert.equal(response.ok, true, `Could not fetch ${url}: HTTP ${response.status}`);

const dom = new JSDOM(await response.text(), { url });
globalThis.document = dom.window.document;
await import(`../dist/extractor.js?articleTest=${Date.now()}`);

const article = globalThis.__articleTtsReaderExtractMainArticle();
assert.equal(article.title, "Distributing Agentic Capabilities");
assert.ok(article.text.length > 10000, `Expected substantial article text; received ${article.text.length} characters.`);
assert.match(article.text, /capability package/i);
assert.doesNotMatch(article.text, /Subscribe to RSS feed/);

const markedDom = new JSDOM(`
  <title>Explicit article target | Test Site</title>
  <nav>${"Navigation ".repeat(100)}</nav>
  <article data-tts-content>Read only this marked article.</article>
  <footer>${"Footer ".repeat(100)}</footer>
`);
globalThis.document = markedDom.window.document;

const markedArticle = globalThis.__articleTtsReaderExtractMainArticle();
assert.equal(markedArticle.title, "Explicit article target");
assert.equal(markedArticle.text, "Read only this marked article.");

const fallbackText = "Fallback content ".repeat(26).trim();
const fallbackDom = new JSDOM(`
  <title>Fallback target | Test Site</title>
  <div class="entry-content">${fallbackText}</div>
`);
globalThis.document = fallbackDom.window.document;

const fallbackArticle = globalThis.__articleTtsReaderExtractMainArticle();
assert.equal(fallbackArticle.title, "Fallback target");
assert.equal(fallbackArticle.text, fallbackText);

console.log(`Article extraction passed: ${article.text.length} characters from ${url}; explicit marker and semantic fallback passed.`);

import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const url = "https://blog.haochuanz.net/posts/distributing-agentic-capabilities";
const response = await fetch(url);
assert.equal(response.ok, true, `Could not fetch ${url}: HTTP ${response.status}`);

const dom = new JSDOM(await response.text(), { url });
globalThis.document = dom.window.document;
await import(`../src/extractor.js?articleTest=${Date.now()}`);

const article = globalThis.__articleTtsReaderExtractMainArticle();
assert.equal(article.title, "Distributing Agentic Capabilities");
assert.ok(article.text.length > 10000, `Expected substantial article text; received ${article.text.length} characters.`);
assert.match(article.text, /capability package/i);
assert.doesNotMatch(article.text, /Subscribe to RSS feed/);

console.log(`Article extraction passed: ${article.text.length} characters from ${url}`);

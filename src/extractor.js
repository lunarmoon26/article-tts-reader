import { Readability } from "@mozilla/readability";

function normaliseText(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function articleTitle(title) {
  return String(title || "Article")
    .split(/\s+[|–—]\s+/)[0]
    .trim() || "Article";
}

function textFromSemanticFallback() {
  const candidates = [...document.querySelectorAll("article, main, [role='main']")]
    .map((element) => ({ element, text: normaliseText(element.innerText || element.textContent || "") }))
    .filter(({ text }) => text.length >= 400)
    .sort((a, b) => b.text.length - a.text.length);

  return candidates[0]?.text || "";
}

globalThis.__articleTtsReaderExtractMainArticle = () => {
  try {
    const clonedDocument = document.cloneNode(true);
    const article = new Readability(clonedDocument).parse();
    const text = normaliseText(article?.textContent || "");

    if (text.length >= 200) {
      return {
        title: articleTitle(article.title || document.title),
        text
      };
    }

    const fallbackText = textFromSemanticFallback();
    if (fallbackText) {
      return { title: articleTitle(document.title), text: fallbackText };
    }

    return {
      reason: "Could not identify a substantial article. Select the desired text and use the context-menu command instead."
    };
  } catch (error) {
    return { reason: `Article extraction failed: ${error.message}` };
  }
};

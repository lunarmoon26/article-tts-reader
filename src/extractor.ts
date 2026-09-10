import { Readability } from "@mozilla/readability";

function normaliseText(text: string) {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function articleTitle(title: string) {
  return String(title || "Article")
    .split(/\s+[|–—]\s+/)[0]
    .trim() || "Article";
}

function textFromSelectors(selectors: string[], minimumLength: number) {
  const elements = [...new Set<HTMLElement>(selectors.flatMap((selector) => [...document.querySelectorAll<HTMLElement>(selector)]))];
  const candidates = elements
    .map((element) => ({ element, text: normaliseText(element.innerText || element.textContent || "") }))
    .filter(({ text }) => text.length >= minimumLength)
    .sort((a, b) => b.text.length - a.text.length);

  return candidates[0]?.text || "";
}

function textFromSemanticFallback() {
  return textFromSelectors([
    "article",
    "[itemprop~='articleBody']",
    ".article-content",
    ".article-body",
    ".post-content",
    ".post-body",
    ".entry-content",
    ".story-body",
    "main",
    "[role='main']"
  ], 400);
}

globalThis.__articleTtsReaderExtractMainArticle = () => {
  try {
    const markedText = textFromSelectors(["[data-tts-content]"], 1);
    if (markedText) {
      return { title: articleTitle(document.title), text: markedText };
    }

    const clonedDocument = document.cloneNode(true) as Document;
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

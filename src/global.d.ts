declare global {
  const chrome: any;

  var __articleTtsReaderExtractMainArticle: () => {
    title?: string;
    text?: string;
    reason?: string;
  };
}

export {};

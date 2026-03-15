const SITE_ORIGIN = "https://linux.do";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "EXPORT_MARKDOWN") {
    return false;
  }

  try {
    const scope = message.scope || "op_only";
    const extracted = extractTopicData(scope);
    const markdown = buildMarkdown(extracted);
    const filename = `${sanitizeFilename(extracted.title)}.md`;

    sendResponse({ ok: true, markdown, filename });
  } catch (error) {
    sendResponse({
      ok: false,
      error: `${error.message}\n页面结构可能已变更，请复制页面源码上报。`
    });
  }

  return true;
});

function extractTopicData(scope) {
  if (!/^\/t\//.test(location.pathname)) {
    throw new Error("当前页面不是可导出的帖子页。");
  }

  const posts = collectPosts();
  if (posts.length === 0) {
    throw new Error("未找到帖子楼层内容。");
  }

  const title = extractTitle();
  if (!title) {
    throw new Error("未找到帖子标题。");
  }

  const opAuthor = posts[0].author || "";
  const publishedAt = posts[0].publishedAt || "";
  const topicTags = extractTags();

  let selectedPosts = posts;
  if (scope === "op_only") {
    selectedPosts = [posts[0]];
  } else if (scope === "op_plus_replies") {
    selectedPosts = posts.filter((post) => post.author === opAuthor);
  }

  if (selectedPosts.length === 0) {
    throw new Error("根据当前导出范围没有匹配到可导出内容。");
  }

  return {
    title,
    url: location.href,
    author: opAuthor,
    publishedAt,
    tags: topicTags,
    scope,
    exportedAt: new Date().toISOString(),
    posts: selectedPosts
  };
}

function extractTitle() {
  const selectors = [
    "h1[data-topic-title]",
    ".fancy-title",
    ".title-wrapper h1",
    "h1"
  ];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent && el.textContent.trim()) {
      return cleanInlineText(el.textContent);
    }
  }

  const docTitle = document.title || "";
  return cleanInlineText(docTitle.replace(/\s*-\s*LINUX DO\s*$/i, ""));
}

function extractTags() {
  const selectors = [
    ".discourse-tags .discourse-tag",
    ".topic-category .badge-category__name",
    ".topic-category .category-name",
    ".topic-header-extra .discourse-tag"
  ];
  const seen = new Set();
  const tags = [];

  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((el) => {
      const value = cleanInlineText(el.textContent);
      if (value && !seen.has(value)) {
        seen.add(value);
        tags.push(value);
      }
    });
  });

  return tags;
}

function collectPosts() {
  let postRoots = Array.from(document.querySelectorAll(".topic-post"));
  if (postRoots.length === 0) {
    postRoots = Array.from(document.querySelectorAll("article[data-post-id]"));
  }

  const posts = [];
  for (const root of postRoots) {
    const content = root.querySelector(".cooked");
    if (!content) {
      continue;
    }

    const author = readAuthor(root);
    const publishedAt = readPublishedAt(root);
    const postNumber = readPostNumber(root);
    const markdown = cookedToMarkdown(content);

    if (!markdown.trim()) {
      continue;
    }

    posts.push({
      postNumber,
      author,
      publishedAt,
      markdown
    });
  }

  return posts;
}

function readAuthor(root) {
  const authorSelectors = [
    ".names .username a",
    ".names .username",
    "a.trigger-user-card",
    ".topic-meta-data .username",
    ".topic-meta-data a[data-user-card]"
  ];
  for (const selector of authorSelectors) {
    const el = root.querySelector(selector);
    if (el && el.textContent && el.textContent.trim()) {
      return cleanInlineText(el.textContent);
    }
  }
  return "";
}

function readPublishedAt(root) {
  const timeEl = root.querySelector("time[datetime]");
  return timeEl ? timeEl.getAttribute("datetime") || "" : "";
}

function readPostNumber(root) {
  const raw = root.getAttribute("data-post-number");
  if (raw && /^\d+$/.test(raw)) {
    return Number(raw);
  }

  const postNumberEl = root.querySelector(".post-number");
  if (!postNumberEl) {
    return null;
  }
  const match = (postNumberEl.textContent || "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function cookedToMarkdown(cookedNode) {
  const clone = cookedNode.cloneNode(true);

  clone.querySelectorAll(
    ".lightbox-handle, .mention-group, .badge-wrapper, .d-editor-button-bar, .post-controls, script, style"
  ).forEach((el) => el.remove());

  const markdown = childrenToMarkdown(Array.from(clone.childNodes));
  return markdown.replace(/\n{3,}/g, "\n\n").trim();
}

function childrenToMarkdown(nodes) {
  return nodes.map((node) => nodeToMarkdown(node)).join("");
}

function nodeToMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeMarkdownText(node.textContent || "");
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const tag = node.tagName.toLowerCase();
  switch (tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = Number(tag.slice(1));
      const text = extractCleanHeadingText(node);
      return text ? `${"#".repeat(level)} ${text}\n\n` : "";
    }
    case "p": {
      const text = cleanInlineText(childrenToMarkdown(Array.from(node.childNodes)));
      return text ? `${text}\n\n` : "\n";
    }
    case "br":
      return "  \n";
    case "strong":
    case "b":
      return `**${childrenToMarkdown(Array.from(node.childNodes))}**`;
    case "em":
    case "i":
      return `*${childrenToMarkdown(Array.from(node.childNodes))}*`;
    case "code": {
      if (node.parentElement && node.parentElement.tagName.toLowerCase() === "pre") {
        return "";
      }
      return `\`${cleanInlineText(node.textContent || "")}\``;
    }
    case "pre": {
      const codeNode = node.querySelector("code");
      const rawCode = codeNode ? codeNode.textContent || "" : node.textContent || "";
      const lang = codeNode ? detectLanguageClass(codeNode) : "";
      return `\`\`\`${lang}\n${rawCode.trimEnd()}\n\`\`\`\n\n`;
    }
    case "blockquote": {
      const text = cleanInlineText(childrenToMarkdown(Array.from(node.childNodes)));
      if (!text) {
        return "";
      }
      const quoted = text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      return `${quoted}\n\n`;
    }
    case "ul": {
      const items = Array.from(node.children)
        .filter((el) => el.tagName.toLowerCase() === "li")
        .map((li) => `- ${cleanInlineText(childrenToMarkdown(Array.from(li.childNodes)))}`)
        .join("\n");
      return items ? `${items}\n\n` : "";
    }
    case "ol": {
      const items = Array.from(node.children)
        .filter((el) => el.tagName.toLowerCase() === "li")
        .map((li, index) => `${index + 1}. ${cleanInlineText(childrenToMarkdown(Array.from(li.childNodes)))}`)
        .join("\n");
      return items ? `${items}\n\n` : "";
    }
    case "a": {
      const text = cleanInlineText(childrenToMarkdown(Array.from(node.childNodes))) || "链接";
      const href = absoluteUrl(node.getAttribute("href") || "");
      return href ? `[${text}](${href})` : text;
    }
    case "img": {
      const alt = cleanInlineText(node.getAttribute("alt") || "image");
      const src = absoluteUrl(node.getAttribute("src") || "");
      if (!src) {
        return "";
      }
      return `![${alt}](${src})`;
    }
    case "hr":
      return "\n---\n\n";
    case "table":
      return tableToMarkdown(node);
    default:
      return childrenToMarkdown(Array.from(node.childNodes));
  }
}

function tableToMarkdown(tableEl) {
  const rows = Array.from(tableEl.querySelectorAll("tr"));
  if (rows.length === 0) {
    return "";
  }

  const parsed = rows.map((row) =>
    Array.from(row.children).map((cell) =>
      cleanInlineText(childrenToMarkdown(Array.from(cell.childNodes))).replace(/\|/g, "\\|")
    )
  );
  if (parsed.length === 0 || parsed[0].length === 0) {
    return "";
  }

  const header = `| ${parsed[0].join(" | ")} |`;
  const divider = `| ${parsed[0].map(() => "---").join(" | ")} |`;
  const body = parsed
    .slice(1)
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");

  return `${header}\n${divider}${body ? `\n${body}` : ""}\n\n`;
}

function detectLanguageClass(codeNode) {
  const cls = codeNode.className || "";
  const match = cls.match(/(?:lang|language)-([a-z0-9_+-]+)/i);
  return match ? match[1] : "";
}

function absoluteUrl(url) {
  if (!url) {
    return "";
  }
  try {
    return new URL(url, SITE_ORIGIN).toString();
  } catch {
    return "";
  }
}

function extractCleanHeadingText(headingNode) {
  const clone = headingNode.cloneNode(true);

  clone.querySelectorAll(
    "a.anchor, a.hashtag, a.heading-anchor, a.anchor-link, .heading-link, a[href^='#']"
  ).forEach((el) => el.remove());

  clone.querySelectorAll("a").forEach((el) => {
    const text = cleanInlineText(el.textContent || "").toLowerCase();
    const href = (el.getAttribute("href") || "").trim();
    if ((text === "链接" || text === "link" || text === "anchor") && href.includes("#")) {
      el.remove();
    }
  });

  return cleanInlineText(clone.textContent || "");
}

function buildMarkdown(data) {
  const scopeMap = {
    op_only: "op_only",
    op_plus_replies: "op_plus_replies",
    all_posts: "all_posts"
  };
  const scopeValue = scopeMap[data.scope] || "op_only";
  const tagsYaml = data.tags.map((tag) => `"${escapeYaml(tag)}"`).join(", ");
  const header = [
    "---",
    `title: "${escapeYaml(data.title)}"`,
    `url: "${escapeYaml(data.url)}"`,
    `author: "${escapeYaml(data.author || "")}"`,
    `published_at: "${escapeYaml(data.publishedAt || "")}"`,
    `tags: [${tagsYaml}]`,
    `export_scope: "${scopeValue}"`,
    `exported_at: "${escapeYaml(data.exportedAt)}"`,
    'source_site: "linux.do"',
    "---",
    ""
  ].join("\n");

  let body = `# ${data.title}\n\n`;

  if (data.scope === "op_only") {
    body += "## 主楼\n\n";
    body += `${data.posts[0].markdown}\n`;
  } else if (data.scope === "op_plus_replies") {
    body += "## 主楼 + 楼主回帖\n\n";
    body += data.posts
      .map((post) => formatPost(post))
      .join("\n");
  } else {
    body += "## 全部楼层\n\n";
    body += data.posts
      .map((post) => formatPost(post))
      .join("\n");
  }

  return `${header}\n${body}`.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function formatPost(post) {
  const no = post.postNumber ? `#${post.postNumber}` : "#?";
  const author = post.author || "未知作者";
  const time = post.publishedAt || "";
  const heading = `### ${no} ${author}${time ? ` ${time}` : ""}`;
  return `${heading}\n\n${post.markdown}\n`;
}

function cleanInlineText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function escapeMarkdownText(text) {
  return (text || "").replace(/\r?\n/g, " ");
}

function escapeYaml(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function sanitizeFilename(name) {
  return String(name || "snapshot")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "snapshot";
}

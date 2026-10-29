export interface SafeUrlCheck {
  readonly safe: boolean;
  readonly reason?: string;
  readonly url?: URL;
}

export function isSafePublicUrl(rawUrl: string): SafeUrlCheck {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { safe: false, reason: "Invalid URL format." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { safe: false, reason: "Only http and https protocols are supported." };
  }

  let hostname = parsed.hostname.toLowerCase();
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }

  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "::" ||
    hostname === "internal" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.startsWith("fe80:") ||
    hostname.startsWith("fc00:") ||
    hostname.startsWith("fd00:") ||
    hostname.startsWith("::ffff:")
  ) {
    return { safe: false, reason: "Internal and localhost addresses are prohibited." };
  }

  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4Match) {
    const octet1 = Number(ipv4Match[1]);
    const octet2 = Number(ipv4Match[2]);
    if (
      octet1 === 10 ||
      (octet1 === 172 && octet2 >= 16 && octet2 <= 31) ||
      (octet1 === 192 && octet2 === 168) ||
      (octet1 === 169 && octet2 === 254) ||
      octet1 === 127 ||
      octet1 === 0
    ) {
      return { safe: false, reason: "Private and link-local IP addresses are prohibited." };
    }
  }

  return { safe: true, url: parsed };
}

export interface CleanedHtml {
  readonly title?: string | undefined;
  readonly text: string;
  readonly headings: readonly string[];
  readonly links: readonly string[];
}

export function cleanHtmlContent(html: string): CleanedHtml {
  const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  const title = titleMatch?.[1]?.trim();

  const headings: string[] = [];
  const headingRegex = /<h[1-3][^<>]*>([^<]+)<\/h[1-3]>/gi;
  let hMatch: RegExpExecArray | null;
  while ((hMatch = headingRegex.exec(html)) !== null && headings.length < 10) {
    const headingText = hMatch[1]?.trim();
    if (headingText && !headings.includes(headingText)) {
      headings.push(headingText);
    }
  }

  const links: string[] = [];
  const linkRegex = /href=["'](https?:\/\/[^"'>\s]+)["']/gi;
  let lMatch: RegExpExecArray | null;
  while ((lMatch = linkRegex.exec(html)) !== null && links.length < 15) {
    const linkUrl = lMatch[1]?.trim();
    if (linkUrl && !links.includes(linkUrl)) {
      links.push(linkUrl);
    }
  }

  let text = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^<>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length > 2_000) {
    text = `${text.slice(0, 2_000)}...`;
  }

  return {
    ...(title ? { title } : {}),
    text,
    headings,
    links,
  };
}

export interface KnowledgeSearchItem {
  readonly kind: "MEMORY" | "DECISION" | "GITHUB";
  readonly sourceKind: "MEMORY" | "DECISION" | "GITHUB";
  readonly title: string;
  readonly snippet: string;
  readonly score: number;
}

export class ProjectBrowserService {
  async fetchDoc(
    rawUrl: string,
    fetchFn: typeof fetch = fetch,
  ): Promise<{
    url: string;
    title?: string;
    text: string;
    headings: readonly string[];
    links: readonly string[];
    fetchedAt: string;
  }> {
    const check = isSafePublicUrl(rawUrl);
    if (!check.safe || check.url === undefined) {
      throw new Error(`Unsafe URL: ${check.reason}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetchFn(check.url.toString(), {
        signal: controller.signal,
        headers: {
          Accept: "text/html, text/plain, application/json, text/markdown",
          "User-Agent": "Nehemiah-Browser/1.0",
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP fetch failed with status ${response.status}`);
      }
      const rawText = await response.text();
      const cleaned = cleanHtmlContent(rawText);
      return {
        url: check.url.toString(),
        ...(cleaned.title ? { title: cleaned.title } : {}),
        text: cleaned.text,
        headings: cleaned.headings,
        links: cleaned.links,
        fetchedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  searchKnowledge(
    query: string,
    memoryItems: readonly { title: string; content: string; category?: string }[],
    decisions: readonly { title: string; rationale: string; outcome?: string }[],
    githubActivities: readonly {
      kind: string;
      externalId: string;
      branch?: string;
      url?: string;
    }[],
  ): readonly KnowledgeSearchItem[] {
    const tokens = query
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]/giu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);

    const results: KnowledgeSearchItem[] = [];

    for (const mem of memoryItems) {
      const target = `${mem.title} ${mem.content}`.toLowerCase();
      let matchCount = 0;
      for (const token of tokens) {
        if (target.includes(token)) matchCount += 1;
      }
      if (matchCount > 0) {
        results.push({
          kind: "MEMORY",
          sourceKind: "MEMORY",
          title: mem.title,
          snippet: mem.content.slice(0, 300),
          score: matchCount * 10,
        });
      }
    }

    for (const dec of decisions) {
      const target = `${dec.title} ${dec.rationale} ${dec.outcome ?? ""}`.toLowerCase();
      let matchCount = 0;
      for (const token of tokens) {
        if (target.includes(token)) matchCount += 1;
      }
      if (matchCount > 0) {
        results.push({
          kind: "DECISION",
          sourceKind: "DECISION",
          title: dec.title,
          snippet: dec.rationale.slice(0, 300),
          score: matchCount * 12,
        });
      }
    }

    for (const act of githubActivities) {
      const target = `${act.kind} ${act.externalId} ${act.branch ?? ""}`.toLowerCase();
      let matchCount = 0;
      for (const token of tokens) {
        if (target.includes(token)) matchCount += 1;
      }
      if (matchCount > 0) {
        results.push({
          kind: "GITHUB",
          sourceKind: "GITHUB",
          title: `${act.kind}: ${act.externalId}`,
          snippet: act.url ?? act.branch ?? "GitHub activity",
          score: matchCount * 8,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 15);
  }
}

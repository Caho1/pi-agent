export type Quartile = "Q1" | "Q2" | "Q3" | "Q4";

export interface Journal {
  id: string;
  name: string;
  quartile: Quartile;
  openAccess: boolean;
  apcUsd: number;
  turnaroundDays: number;
  scope: string;
  topics: string[];
  note: string;
}

export interface SearchJournalParams {
  query: string;
  quartile?: string;
  openAccessOnly?: boolean;
  maxApcUsd?: number;
  maxTurnaroundDays?: number;
  limit?: number;
}

export interface JournalMatch {
  journal: Journal;
  score: number;
  matchedKeywords: string[];
}

const catalog: Journal[] = [
  {
    id: "tmlr",
    name: "Transactions on Machine Learning Research",
    quartile: "Q1",
    openAccess: true,
    apcUsd: 0,
    turnaroundDays: 42,
    scope: "Machine learning methods, efficient training, retrieval, representation learning, and multimodal systems.",
    topics: ["machine learning", "机器学习", "retrieval", "检索", "multimodal", "多模态", "representation learning"],
    note: "Strong fit for practical ML contributions with clear experiments."
  },
  {
    id: "kais",
    name: "Knowledge and Information Systems",
    quartile: "Q1",
    openAccess: false,
    apcUsd: 0,
    turnaroundDays: 75,
    scope: "Information retrieval, data mining, knowledge systems, ranking, and recommendation.",
    topics: ["information retrieval", "检索", "ranking", "排序", "recommendation", "推荐", "knowledge systems"],
    note: "Good when the work emphasizes retrieval quality, ranking, or system design."
  },
  {
    id: "jbi",
    name: "Journal of Biomedical Informatics",
    quartile: "Q1",
    openAccess: true,
    apcUsd: 2950,
    turnaroundDays: 38,
    scope: "Clinical NLP, biomedical text mining, healthcare AI, decision support, and translational informatics.",
    topics: ["clinical nlp", "临床nLP", "healthcare ai", "医疗", "biomedical text mining", "医学文本", "ehr"],
    note: "A strong target for clinically grounded NLP or real-world healthcare data studies."
  },
  {
    id: "jamia",
    name: "Journal of the American Medical Informatics Association",
    quartile: "Q1",
    openAccess: false,
    apcUsd: 0,
    turnaroundDays: 55,
    scope: "Clinical informatics, health NLP, digital health operations, and applied AI in medicine.",
    topics: ["clinical informatics", "临床信息学", "nlp", "自然语言处理", "medicine", "医学", "ehr"],
    note: "Best for papers with strong medical workflow relevance and deployment value."
  },
  {
    id: "eswa",
    name: "Expert Systems with Applications",
    quartile: "Q1",
    openAccess: true,
    apcUsd: 3200,
    turnaroundDays: 33,
    scope: "Applied AI systems, optimization, predictive modeling, multimodal analytics, and industry cases.",
    topics: ["applied ai", "应用ai", "multimodal", "多模态", "optimization", "优化", "analytics"],
    note: "Fits applied system papers with clear business or operational outcomes."
  },
  {
    id: "ipr",
    name: "Information Processing and Management",
    quartile: "Q1",
    openAccess: true,
    apcUsd: 2800,
    turnaroundDays: 46,
    scope: "Information science, retrieval, digital libraries, scientometrics, and human-information interaction.",
    topics: ["information science", "信息科学", "retrieval", "检索", "digital libraries", "数字图书馆", "scientometrics"],
    note: "Useful when the paper is retrieval-heavy and evaluation methodology is strong."
  }
];

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function extractKeywords(query: string): string[] {
  return normalize(query)
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function includesKeyword(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle));
}

function computeMatch(journal: Journal, query: string): JournalMatch {
  const keywords = extractKeywords(query);
  const haystacks = [journal.name, journal.scope, journal.note, journal.topics.join(" ")];
  const matchedKeywords = new Set<string>();
  let score = 0;

  for (const keyword of keywords) {
    for (const haystack of haystacks) {
      if (includesKeyword(haystack, keyword)) {
        matchedKeywords.add(keyword);
        score += 2;
        break;
      }
    }
  }

  for (const topic of journal.topics) {
    if (includesKeyword(query, topic)) {
      matchedKeywords.add(topic);
      score += 3;
    }
  }

  if (journal.openAccess) {
    score += 0.5;
  }

  if (journal.quartile === "Q1") {
    score += 0.5;
  }

  return {
    journal,
    score,
    matchedKeywords: Array.from(matchedKeywords)
  };
}

export function searchJournalCatalog(params: SearchJournalParams): JournalMatch[] {
  const quartile = params.quartile?.toUpperCase();
  const limit = Math.min(Math.max(params.limit ?? 3, 1), 5);

  return catalog
    .filter((journal) => !quartile || journal.quartile === quartile)
    .filter((journal) => !params.openAccessOnly || journal.openAccess)
    .filter((journal) => params.maxApcUsd === undefined || journal.apcUsd <= params.maxApcUsd)
    .filter(
      (journal) =>
        params.maxTurnaroundDays === undefined || journal.turnaroundDays <= params.maxTurnaroundDays
    )
    .map((journal) => computeMatch(journal, params.query))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score || left.journal.turnaroundDays - right.journal.turnaroundDays)
    .slice(0, limit);
}
